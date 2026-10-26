import { kz } from '@kianda/core';
import {
  and, asc, auditLogs, companies, departments, desc, employees, eq, getDb, journalEntries, payrollLines, payrollRuns, payrollVariables, users,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { closePayroll, DomainError, draftPayroll, type SubsidyOverrides } from '../services/payroll.js';

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');
const READERS = ['payroll', 'finance', 'hr_admin'] as const;

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
    const { period } = z.object({ period: z.string() }).parse(await body(c));
    return c.json(await draftPayroll(getDb(), companyId, period, actorId), 201);
  });

  app.get('/v1/payroll-runs/:id', requireRole(...READERS), async (c) => {
    const { id } = c.req.param();
    const db = getDb();
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, c.get('actor').companyId)));
    if (!run) return c.json({ error: 'nao_encontrado', message: 'Processamento inexistente' }, 404);
    const lines = await db.select({ l: payrollLines, name: employees.name, number: employees.number, department: departments.name, iban: employees.iban })
      .from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payrollLines.runId, id)).orderBy(asc(employees.number));
    const people = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, run.companyId));
    const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
    return c.json({
      ...run, preparedByName: who(run.preparedBy), closedByName: who(run.closedBy),
      lines: lines.map(({ l, name, number, department, iban }) => ({ ...l, employee: { id: l.employeeId, name, number, department, hasIban: !!iban } })),
    });
  });

  app.post('/v1/payroll-runs/:id/close', requireRole('finance'), async (c) => {
    const { companyId, actorId, role } = c.get('actor');
    return c.json(await closePayroll(getDb(), companyId, c.req.param('id'), actorId, role));
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
    const rows = await getDb().select({ v: payrollVariables, name: employees.name, number: employees.number }).from(payrollVariables)
      .innerJoin(employees, eq(employees.id, payrollVariables.employeeId))
      .where(and(eq(payrollVariables.companyId, c.get('actor').companyId), eq(payrollVariables.period, period))).orderBy(asc(employees.number));
    return c.json(rows.map(({ v, name, number }) => ({ ...v, employee: { id: v.employeeId, name, number } })));
  });

  app.post('/v1/payroll-variables', requireRole('payroll'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      employeeId: z.string(), period: periodSchema,
      kind: z.enum(['bonus', 'other_earning', 'advance', 'other_deduction']),
      label: z.string().trim().min(2, 'Indique a descrição'),
      amount: z.number().positive('O valor tem de ser positivo'),
      inInss: z.boolean().default(true), inIrt: z.boolean().default(true),
      note: z.string().trim().max(300).optional().nullable(),
    }).parse(await body(c));
    const db = getDb();
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
    if (!emp) return c.json({ error: 'colaborador_inexistente', message: 'Colaborador inexistente' }, 404);
    const [run] = await db.select({ status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, b.period)));
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', `O processamento de ${b.period} já está fechado: lance no mês seguinte.`);
    const isEarning = b.kind === 'bonus' || b.kind === 'other_earning';
    const [v] = await db.insert(payrollVariables).values({
      companyId: actor.companyId, employeeId: b.employeeId, period: b.period, kind: b.kind, label: b.label, amountMinor: kz(b.amount),
      inInss: isEarning ? b.inInss : true, inIrt: isEarning ? b.inIrt : true, note: b.note ?? null, createdBy: actor.actorId,
    }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'payroll_variable', entityId: v!.id, after: { ...v } });
    return c.json(v, 201);
  });

  app.delete('/v1/payroll-variables/:id', requireRole('payroll'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [v] = await db.select().from(payrollVariables).where(and(eq(payrollVariables.id, c.req.param('id')), eq(payrollVariables.companyId, actor.companyId)));
    if (!v) return c.json({ error: 'nao_encontrado', message: 'Variável inexistente' }, 404);
    if (v.terminationId) throw new DomainError('gerida_pela_cessacao', 'Esta linha faz parte de um fecho de contas: altere-a na cessação do contrato');
    const [run] = await db.select({ status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, v.period)));
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
    return c.json({
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
    return c.json({ name: co!.name, nif: co!.nif, inssNumber: co!.inssNumber, address: co!.address, workdayMinutes: co!.workdayMinutes, christmasSubsidyMonth: co!.christmasSubsidyMonth, holidaySubsidyMonth: co!.holidaySubsidyMonth, perDiemNationalMinor: co!.perDiemNationalMinor, perDiemInternationalMinor: co!.perDiemInternationalMinor });
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
    }).parse(await body(c));
    const db = getDb();
    const [before] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const [after] = await db.update(companies).set(b).where(eq(companies.id, actor.companyId)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'company', entityId: actor.companyId, before: before as object, after: after as object });
    return c.json(after);
  });

  return app;
}
