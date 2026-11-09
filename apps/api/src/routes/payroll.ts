import { ABSENCE_POLICIES, kz, labourRules, lastDayOfMonth, parseFxRate, TERMINATION_REASONS, workingDaysByYear, type AbsenceType, type TerminationReason } from '@kianda/core';
import { createHash, randomUUID } from 'node:crypto';
import {
  absences, and, asc, auditLogs, companies, contracts, departments, desc, employees, eq, getDb, inArray, gte, journalEntries, lte, payrollLines, terminations, payrollRuns, payrollVariables, sql, users, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { closePayroll, DomainError, draftPayroll, type SubsidyOverrides } from '../services/payroll.js';
import { payrollRoster } from '../services/payroll-roster.js';

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');
const READERS = ['payroll', 'finance', 'hr_admin'] as const;
const variableInput = z.object({
  employeeId: z.string().min(1), period: periodSchema,
  kind: z.enum(['bonus', 'other_earning', 'advance', 'other_deduction', 'salary_cut']),
  label: z.string().trim().min(2, 'Indique a descrição'),
  amount: z.number().positive('O valor tem de ser positivo').refine((v) => Number.isSafeInteger(Math.round(v * 100)) && Math.round(v * 100) > 0, 'Indique um valor de pelo menos 0,01 Kz e dentro do limite de cálculo'),
  inInss: z.boolean().default(true), inIrt: z.boolean().default(true),
  note: z.string().trim().max(300).optional().nullable(),
});
const variableBatch = variableInput.omit({ employeeId: true, amount: true }).extend({
  requestId: z.uuid(),
  label: variableInput.shape.label.max(160, 'Máximo de 160 caracteres na descrição do lote'),
  rows: z.array(variableInput.pick({ employeeId: true, amount: true }).extend({ employeeId: z.string().min(1).max(128) })).min(1, 'Seleccione pelo menos um colaborador').max(1000, 'Máximo de 1.000 colaboradores por lote'),
}).refine((b) => new Set(b.rows.map((r) => r.employeeId)).size === b.rows.length, { path: ['rows'], message: 'Um colaborador só pode aparecer uma vez no mesmo lote' });
const variableSnapshot = z.object({ kind: z.string(), label: z.string(), amountMinor: z.number().int(), code: z.string().nullable(), inInss: z.boolean(), inIrt: z.boolean(), note: z.string().nullable() });
const variableEdit = variableInput.omit({ employeeId: true, period: true }).extend({ expected: variableSnapshot }).strict();

function variableValues(actor: { companyId: string; actorId: string }, b: z.infer<typeof variableInput>): typeof payrollVariables.$inferInsert {
  const cut = b.kind === 'salary_cut', earning = b.kind === 'bonus' || b.kind === 'other_earning';
  return { companyId: actor.companyId, employeeId: b.employeeId, period: b.period, kind: b.kind === 'salary_cut' ? 'other_earning' : b.kind,
    label: b.label, amountMinor: cut ? -kz(b.amount) : kz(b.amount), code: cut ? 'CORTE' : null,
    inInss: earning ? b.inInss : true, inIrt: earning ? b.inIrt : true, note: b.note ?? null, createdBy: actor.actorId };
}

async function runDetail(db: Db, run: typeof payrollRuns.$inferSelect) {
  const lines = await db.select({ l: payrollLines, name: employees.name, number: employees.number, department: departments.name, iban: employees.iban })
    .from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, run.companyId));
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  return {
    ...run, preparedByName: who(run.preparedBy), closedByName: who(run.closedBy),
    lines: lines.map(({ l, name, number, department, iban }) => ({ ...l, employee: { id: l.employeeId, name, number, department, hasIban: !!iban } })),
  };
}

async function variablesFor(db: Db, companyId: string, period: string) {
  const rows = await db.select({ v: payrollVariables, name: employees.name, number: employees.number }).from(payrollVariables)
    .innerJoin(employees, eq(employees.id, payrollVariables.employeeId))
    .where(and(eq(payrollVariables.companyId, companyId), eq(payrollVariables.period, period))).orderBy(asc(employees.number));
  return rows.map(({ v, name, number }) => ({ ...v, employee: { id: v.employeeId, name, number } }));
}

/** Câmbio USD→Kz do dia (salários indexados): taxa com até 6 casas decimais, data e fonte. */
const fxSchema = z.object({
  rate: z.union([z.string(), z.number()]).transform((v, ctx) => { const r = parseFxRate(v); if (!r) ctx.addIssue({ code: 'custom', message: 'Câmbio inválido (ex.: 912,50)' }); return r ?? 0; }),
  date: z.iso.date('Data do câmbio inválida'),
  source: z.string().trim().max(80).optional().nullable(),
});

/** Colaboradores activos com salário indexado ao dólar no fim do período (para pedir o câmbio antes de preparar). */
async function indexedCount(db: Db, companyId: string, period: string) {
  const end = lastDayOfMonth(period);
  const rows = await db.execute(sql`select count(*)::int as n from (
    select distinct on (cc.employee_id) cc.salary_currency from compensation_changes cc join employees e on e.id = cc.employee_id
    where cc.company_id = ${companyId} and cc.effective_date <= ${end} and e.status in ('active', 'terminated')
    order by cc.employee_id, cc.effective_date desc) x where x.salary_currency = 'USD'`);
  return Number((rows.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export function payrollRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/payroll-runs', '/v1/payroll-runs/*', '/v1/journal', '/v1/payroll-variables', '/v1/payroll-variables/*', '/v1/payslips', '/v1/payslips/*', '/v1/company/*']) app.use(p, requireCompany);

  /** Lista de processamentos (ou o do período indicado). */
  app.get('/v1/payroll-runs', requireRole(...READERS), async (c) => {
    const { period } = z.object({ period: periodSchema.optional() }).parse(c.req.query());
    const conds = [eq(payrollRuns.companyId, c.get('actor').companyId)];
    if (period) conds.push(eq(payrollRuns.period, period));
    return c.json(await getDb().select().from(payrollRuns).where(and(...conds)).orderBy(desc(payrollRuns.period)));
  });

  app.post('/v1/payroll-runs', requireRole('payroll'), async (c) => {
    const { companyId, actorId } = c.get('actor');
    const { period, fx } = z.object({ period: z.string(), fx: fxSchema.optional() }).parse(await body(c));
    return c.json(await draftPayroll(getDb(), companyId, period, actorId, fx), 201);
  });

  // Apagar um processamento em rascunho para recomeçar. As variáveis do mês ficam guardadas.
  app.delete('/v1/payroll-runs/:id', requireRole('payroll'), async (c) => {
    const { companyId, actorId } = c.get('actor');
    const db = getDb();
    await db.transaction(async (tx) => {
      const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, c.req.param('id')), eq(payrollRuns.companyId, companyId))).for('update');
      if (!run) throw new DomainError('nao_encontrado', 'Processamento não encontrado', 404);
      if (run.status === 'closed') throw new DomainError('processamento_fechado', 'Um processamento fechado não pode ser apagado.', 409);
      await tx.delete(payrollLines).where(eq(payrollLines.runId, run.id));
      await tx.delete(payrollRuns).where(eq(payrollRuns.id, run.id));
      await tx.insert(auditLogs).values({ companyId, actorId, action: 'delete', entity: 'payroll_run', entityId: run.id, before: { period: run.period, status: run.status } });
    });
    return c.json({ ok: true });
  });

  /** Calcula salários da selecção; os lotes acumulam-se na mesma folha mensal. */
  app.post('/v1/payroll-runs/batch', requireRole('payroll'), async c => {
    const b = z.object({ period: periodSchema, employeeIds: z.array(z.string().min(1).max(128)).min(1).max(1000), fx: fxSchema.optional() })
      .refine(b => new Set(b.employeeIds).size === b.employeeIds.length, 'O lote contém colaboradores repetidos').parse(await body(c));
    const actor = c.get('actor');
    return c.json(await draftPayroll(getDb(), actor.companyId, b.period, actor.actorId, b.fx, b.employeeIds), 201);
  });

  /** Folha e variáveis com uma só validação de sessão e licença. */
  app.get('/v1/payroll-runs/opening', requireRole(...READERS), async (c) => {
    const { period, people: includePeople, batch } = z.object({ period: periodSchema, people: z.literal('1').optional(), batch: z.literal('1').optional() }).parse(c.req.query());
    const { companyId, role } = c.get('actor');
    const db = getDb();
    const [runs, variables] = await Promise.all([
      db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period))).limit(1),
      variablesFor(db, companyId, period),
    ]);
    // Salários indexados: só interessa enquanto o mês pode ser (re)calculado; omitido quando não há nenhum.
    const editable = runs[0]?.status !== 'closed';
    const [indexed, people, payrollPeople] = await Promise.all([
      editable ? indexedCount(db, companyId, period) : 0,
      includePeople && editable && (role === 'owner' || role === 'payroll')
        ? db.select({ id: employees.id, name: employees.name }).from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.status, 'active'))).orderBy(asc(employees.number))
        : undefined,
      batch && editable && (role === 'owner' || role === 'payroll') ? payrollRoster(db, companyId, period) : undefined,
    ]);
    return c.json({ run: runs[0] ? await runDetail(db, runs[0]) : null, variables, ...(indexed ? { indexedEmployees: indexed } : {}), ...(people ? { people } : {}), ...(payrollPeople ? { payrollPeople } : {}) });
  });

  app.get('/v1/payroll-runs/:id', requireRole(...READERS), async (c) => {
    const { id } = c.req.param();
    const db = getDb();
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, c.get('actor').companyId)));
    if (!run) return c.json({ error: 'nao_encontrado', message: 'Processamento inexistente' }, 404);
    return c.json(await runDetail(db, run));
  });

  app.post('/v1/payroll-runs/:id/close', requireRole('finance'), async (c) => {
    const { companyId, actorId, role } = c.get('actor');
    const body = z.object({ manualReview: z.string().trim().max(2000).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await closePayroll(getDb(), companyId, c.req.param('id'), actorId, role, body));
  });

  /** Decisão manual de subsídio para um colaborador (forçar, excluir ou voltar à regra automática) e recálculo. */
  app.post('/v1/payroll-runs/:id/subsidies', requireRole('payroll'), async (c) => {
    const { companyId, actorId } = c.get('actor');
    const b = z.object({ employeeId: z.string(), holiday: z.boolean().nullable().optional(), christmas: z.boolean().nullable().optional() }).parse(await body(c));
    const db = getDb();
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, c.req.param('id')), eq(payrollRuns.companyId, companyId)));
    if (!run) return c.json({ error: 'nao_encontrado', message: 'Processamento inexistente' }, 404);
    if (run.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento já está fechado');
    const overrides = { ...(run.subsidyOverrides as SubsidyOverrides) };
    const cur = { ...(overrides[b.employeeId] ?? {}) };
    for (const k of ['holiday', 'christmas'] as const) {
      if (b[k] === null) delete cur[k];
      else if (b[k] !== undefined) cur[k] = b[k]!;
    }
    if (Object.keys(cur).length) overrides[b.employeeId] = cur; else delete overrides[b.employeeId];
    await db.update(payrollRuns).set({ subsidyOverrides: overrides }).where(eq(payrollRuns.id, run.id));
    await db.insert(auditLogs).values({ companyId, actorId, action: 'subsidy_override', entity: 'payroll_run', entityId: run.id, before: run.subsidyOverrides as object, after: overrides });
    return c.json(await draftPayroll(db, companyId, run.period, actorId));
  });

  app.get('/v1/journal', requireRole('finance', 'payroll'), async (c) => {
    return c.json(await getDb().query.journalEntries.findMany({ where: eq(journalEntries.companyId, c.get('actor').companyId), with: { lines: true }, orderBy: (j, { desc }) => [desc(j.date)] }));
  });

  // ───────────────────────── Variáveis do mês ─────────────────────────

  app.get('/v1/payroll-variables', requireRole(...READERS), async (c) => {
    const { period } = z.object({ period: periodSchema }).parse(c.req.query());
    return c.json(await variablesFor(getDb(), c.get('actor').companyId, period));
  });

  app.post('/v1/payroll-variables', requireRole('payroll'), async (c) => {
    const actor = c.get('actor');
    const b = variableInput.parse(await body(c));
    const db = getDb();
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
    if (!emp) return c.json({ error: 'colaborador_inexistente', message: 'Colaborador inexistente' }, 404);
    const [run] = await db.select({ status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, b.period))).for('update');
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', `O processamento de ${b.period} já está fechado: lance no mês seguinte.`);
    // Desconto na remuneração (cálculo manual: maternidade, suspensões…): abono negativo que reduz as bases de INSS e IRT.
    const [v] = await db.insert(payrollVariables).values(variableValues(actor, b)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'payroll_variable', entityId: v!.id, after: { ...v } });
    return c.json(v, 201);
  });

  /** Variáveis de vários colaboradores do mesmo mês: grava tudo ou nada e uma repetição não duplica os valores. */
  app.post('/v1/payroll-variables/batch', requireRole('payroll'), async (c) => {
    const actor = c.get('actor');
    const b = variableBatch.parse(await body(c));
    const rows = b.rows.map((r) => ({ ...variableValues(actor, { ...b, ...r }), id: randomUUID() }));
    const totalMinor = rows.reduce((s, r) => s + r.amountMinor!, 0);
    if (!Number.isSafeInteger(totalMinor)) throw new DomainError('lote_valores_invalidos', 'O total do lote excede o limite de cálculo', 400);
    const normalised = rows.map(({ id: _id, createdBy: _createdBy, ...v }) => v).sort((a, d) => a.employeeId.localeCompare(d.employeeId));
    const payloadHash = createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
    const result = await getDb().transaction(async (tx) => {
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
      // A PK reserva este pedido na mesma transacção: pedidos concorrentes esperam pela gravação/rollback.
      // O registo de auditoria só fica visível quando todas as variáveis tiverem sido gravadas.
      const summary = { period: b.period, count: rows.length, totalMinor, variableIds: rows.map((r) => r.id), payloadHash };
      const reserved = await tx.insert(auditLogs).values({ id: b.requestId, companyId: actor.companyId, actorId: actor.actorId,
        action: 'create_batch', entity: 'payroll_variables_batch', entityId: b.requestId, after: summary }).onConflictDoNothing().returning({ id: auditLogs.id });
      if (!reserved.length) {
        const [existing] = await tx.select({ after: auditLogs.after }).from(auditLogs)
          .where(and(eq(auditLogs.id, b.requestId), eq(auditLogs.companyId, actor.companyId), eq(auditLogs.entity, 'payroll_variables_batch')));
        const saved = existing?.after as typeof summary | undefined;
        if (!saved || saved.payloadHash !== payloadHash) throw new DomainError('lote_reutilizado', 'O identificador deste lote já foi usado. Inicie um novo lote para valores diferentes.');
        return { batchId: b.requestId, count: saved.count, totalMinor: saved.totalMinor, variableIds: saved.variableIds, replayed: true };
      }
      const [run] = await tx.select({ status: payrollRuns.status }).from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, b.period))).for('update');
      if (run?.status === 'closed') throw new DomainError('processamento_fechado', `O processamento de ${b.period} já está fechado. O lote não foi gravado.`);
      const staff = await tx.selectDistinctOn([employees.id], { id: employees.id, name: employees.name, status: employees.status, start: contracts.startDate, end: contracts.endDate, terminated: contracts.terminatedAt })
        .from(employees).leftJoin(contracts, and(eq(contracts.employeeId, employees.id), lte(contracts.startDate, lastDayOfMonth(b.period))))
        .where(and(eq(employees.companyId, actor.companyId), inArray(employees.id, b.rows.map((r) => r.employeeId))))
        .orderBy(employees.id, desc(contracts.startDate));
      const eligible = new Set(staff.filter((e) => (e.status === 'active' || e.status === 'terminated') && e.start && (!(e.terminated ?? e.end) || (e.terminated ?? e.end)! >= `${b.period}-01`)).map((e) => e.id));
      const invalid = b.rows.filter((r) => !eligible.has(r.employeeId));
      if (invalid.length) {
        const names = invalid.slice(0, 8).map((r) => staff.find((e) => e.id === r.employeeId)?.name ?? 'colaborador indisponível');
        throw new DomainError('lote_colaboradores_invalidos', `Lote não gravado. Reveja os contratos e a situação de: ${names.join(', ')}${invalid.length > 8 ? ` e mais ${invalid.length - 8}` : ''}.`, 400);
      }
      const inserted = await tx.insert(payrollVariables).values(rows).returning();
      await tx.insert(auditLogs).values(inserted.map((v) => ({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'payroll_variable', entityId: v.id, after: { ...v, batchId: b.requestId } })));
      return { batchId: b.requestId, count: summary.count, totalMinor: summary.totalMinor, variableIds: summary.variableIds, replayed: false };
    });
    return c.json(result, result.replayed ? 200 : 201);
  });

  app.patch('/v1/payroll-variables/:id', requireRole('payroll'), async c => {
    const actor = c.get('actor'), b = variableEdit.parse(await body(c)), db = getDb();
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const [before] = await db.select().from(payrollVariables).where(and(eq(payrollVariables.id, c.req.param('id')), eq(payrollVariables.companyId, actor.companyId))).for('update');
    if (!before) throw new DomainError('nao_encontrado', 'Alteração mensal inexistente', 404);
    if (before.terminationId) throw new DomainError('gerida_pela_cessacao', 'Esta linha faz parte de um fecho de contas: altere-a na cessação do contrato');
    if (before.advanceId) throw new DomainError('gerida_pelo_adiantamento', 'Esta prestação é gerida na página Adiantamentos');
    const [run] = await db.select({ status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, before.period))).for('update');
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento deste mês já está fechado');
    const current = variableSnapshot.parse(before);
    if (Object.entries(b.expected).some(([key, value]) => current[key as keyof typeof current] !== value)) throw new DomainError('alteracao_actualizada', 'Este lançamento foi alterado entretanto. Actualize o ecrã antes de guardar.', 409);
    const { companyId: _company, employeeId: _employee, period: _period, createdBy: _created, ...values } = variableValues(actor, { ...b, employeeId: before.employeeId, period: before.period });
    const [after] = await db.update(payrollVariables).set(values).where(eq(payrollVariables.id, before.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'payroll_variable', entityId: before.id, before: { ...before }, after: { ...after } });
    return c.json(after);
  });

  app.delete('/v1/payroll-variables/:id', requireRole('payroll'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const [v] = await db.select().from(payrollVariables).where(and(eq(payrollVariables.id, c.req.param('id')), eq(payrollVariables.companyId, actor.companyId)));
    if (!v) return c.json({ error: 'nao_encontrado', message: 'Variável inexistente' }, 404);
    if (v.terminationId) throw new DomainError('gerida_pela_cessacao', 'Esta linha faz parte de um fecho de contas: altere-a na cessação do contrato');
    if (v.advanceId) throw new DomainError('gerida_pelo_adiantamento', 'Esta linha é uma prestação de um adiantamento salarial: gerida na página Adiantamentos');
    const [run] = await db.select({ status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, v.period))).for('update');
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento deste mês já está fechado');
    await db.delete(payrollVariables).where(eq(payrollVariables.id, v.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'delete', entity: 'payroll_variable', entityId: v.id, before: { ...v } });
    return c.body(null, 204);
  });

  // ───────────────────────── Recibos de vencimento ─────────────────────────

  /** Recibos disponíveis: o colaborador vê os seus (só de processamentos fechados). */
  app.get('/v1/payslips', async (c) => {
    const actor = c.get('actor');
    const { employeeId } = z.object({ employeeId: z.string().optional() }).parse(c.req.query());
    const staff = ['owner', ...READERS].includes(actor.role);
    const target = staff && employeeId ? employeeId : actor.employeeId;
    if (!target) return c.json([]);
    const rows = await getDb().select({ id: payrollLines.id, period: payrollRuns.period, netMinor: payrollLines.netMinor, grossMinor: payrollLines.grossMinor, closedAt: payrollRuns.closedAt })
      .from(payrollLines).innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
      .where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollLines.employeeId, target), eq(payrollRuns.status, 'closed')))
      .orderBy(desc(payrollRuns.period));
    return c.json(rows);
  });

  app.get('/v1/payslips/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [row] = await db.select({ l: payrollLines, run: payrollRuns, e: employees, department: departments.name }).from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(payrollLines.id, c.req.param('id')), eq(payrollRuns.companyId, actor.companyId)));
    if (!row) return c.json({ error: 'nao_encontrado', message: 'Recibo inexistente' }, 404);
    const staff = ['owner', ...READERS].includes(actor.role);
    if (!staff && (row.e.id !== actor.employeeId || row.run.status !== 'closed')) return c.json({ error: 'nao_encontrado', message: 'Recibo inexistente' }, 404);
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    // Ocorrências do mês: ausências aprovadas (férias, doença…) dentro do período, e o fecho de contas se houver.
    const from = `${row.run.period}-01`, to = lastDayOfMonth(row.run.period);
    const leave = (await db.select().from(absences).where(and(eq(absences.companyId, actor.companyId), eq(absences.employeeId, row.e.id), eq(absences.status, 'approved'), lte(absences.startDate, to), gte(absences.endDate, from))).orderBy(asc(absences.startDate)))
      .map((a) => {
        const start = a.startDate < from ? from : a.startDate, end = a.endDate > to ? to : a.endDate;
        const days = Object.values(workingDaysByYear(start, end, (y) => labourRules('AO', y))).reduce((x, d) => x + d, 0);
        return { type: a.type, label: ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type, startDate: start, endDate: end, workingDays: days };
      });
    const [term] = await db.select().from(terminations).where(and(eq(terminations.companyId, actor.companyId), eq(terminations.employeeId, row.e.id), eq(terminations.period, row.run.period), eq(terminations.status, 'confirmed')));
    const [termContract] = term ? await db.select({ startDate: contracts.startDate }).from(contracts).where(eq(contracts.id, term.contractId)) : [];
    const proposal = (term?.proposal ?? {}) as { seniority?: { label?: string } };
    return c.json({
      leave,
      termination: term ? { reasonLabel: TERMINATION_REASONS[term.reason as TerminationReason]?.label ?? term.reason, hireDate: termContract?.startDate ?? null, noticeDate: term.noticeDate, effectiveDate: term.effectiveDate, seniority: proposal.seniority?.label ?? null } : null,
      id: row.l.id, period: row.run.period, status: row.run.status, packVersion: row.run.packVersion, closedAt: row.run.closedAt,
      company: { name: co!.name, nif: co!.nif, inssNumber: co!.inssNumber, address: co!.address },
      employee: { name: row.e.name, number: row.e.number, jobTitle: row.e.jobTitle, department: row.department, nif: row.e.nif ?? row.e.biNumber, inssNumber: row.e.inssNumber, iban: row.e.iban, bank: row.e.bank },
      lines: row.l.breakdown, grossMinor: row.l.grossMinor, inssEmployeeMinor: row.l.inssEmployeeMinor, irtMinor: row.l.irtMinor, netMinor: row.l.netMinor,
      inssEmployerMinor: row.l.inssEmployerMinor, irtBracket: row.l.irtBracket, overtimeHours: Number(row.l.overtimeHours), absenceDays: row.l.absenceDays,
      hash: row.l.calculationHash,
    });
  });

  // ───────────────────────── Definições da empresa (processamento) ─────────────────────────

  app.get('/v1/company/settings', async (c) => {
    const [co] = await getDb().select().from(companies).where(eq(companies.id, c.get('actor').companyId));
    return c.json({ name: co!.name, nif: co!.nif, inssNumber: co!.inssNumber, address: co!.address, workdayMinutes: co!.workdayMinutes, christmasSubsidyMonth: co!.christmasSubsidyMonth, holidaySubsidyMonth: co!.holidaySubsidyMonth, perDiemNationalMinor: co!.perDiemNationalMinor, perDiemInternationalMinor: co!.perDiemInternationalMinor, autoIssueDeclarations: co!.autoIssueDeclarations, allowancesOnVacation: co!.allowancesOnVacation, allowancesOnAbsence: co!.allowancesOnAbsence, province: co!.province, municipality: co!.municipality, bankFileProfile: co!.bankFileProfile });
  });

  app.patch('/v1/company/settings', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      inssNumber: z.string().trim().max(30).nullable().optional(),
      address: z.string().trim().max(200).nullable().optional(),
      workdayMinutes: z.number().int().min(240).max(600).optional(),
      christmasSubsidyMonth: z.number().int().min(1).max(12).optional(),
      holidaySubsidyMonth: z.number().int().min(1).max(12).nullable().optional(),
      perDiemNationalMinor: z.number().int().positive().max(1e11).nullable().optional(),
      perDiemInternationalMinor: z.number().int().positive().max(1e11).nullable().optional(),
      autoIssueDeclarations: z.boolean().optional(),
      allowancesOnVacation: z.boolean().optional(),
      allowancesOnAbsence: z.boolean().optional(),
      province: z.string().trim().max(40).nullable().optional(),
      municipality: z.string().trim().max(60).nullable().optional(),
      bankFileProfile: z.enum(['nib', 'generic', 'bfa', 'bai']).optional(),
    }).parse(await body(c));
    const db = getDb();
    const [before] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const [after] = await db.update(companies).set(b).where(eq(companies.id, actor.companyId)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'company', entityId: actor.companyId, before: before as object, after: after as object });
    return c.json(after);
  });

  return app;
}
