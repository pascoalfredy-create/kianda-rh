import {
  buildOrgTree, compensationAt, compensationHistory, complianceAlerts, contractAlerts, createsCycle, documentAlerts, getPack,
  angolanIbanProblem, isValidAngolanBI, kz, luandaDate, normalizeIban, packOrLatest, PackNotFoundError, type CompensationChange, type CountryPack, type DocumentType,
} from '@kianda/core';
import {
  candidates, candidateEvents, auditLogs, companies, compensationChanges, contracts, departments, employeeDocuments, employees, files, getDb, jobOpenings, payrollRuns, recruitmentOffers, users, type Db,
} from '@kianda/db';
import { and, asc, desc, eq, gte, inArray, or, sql } from '@kianda/db';
import { removeFiles } from '../services/storage.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { queueCandidateStage } from '../services/recruitment-mail.js';
import { ensureEmployeeCapacity, licenceOf } from '../services/licence.js';
import { startChecklist } from '../services/checklists.js';
import { requestsForNewEmployee } from '../services/acknowledgements.js';
import { optionalText, optionalDate, moneyFields, usdCheck, usdMessage, salaryCols, contractBody, personal, createBody, assertMinimumWage } from '../services/employee-input.js';
import { commitEmployeeImport, employeeImportBody, employeeImportCommitBody, employeeImportTemplate, previewEmployeeImport } from '../services/employee-import.js';
import { xlsxResponse } from '../lib/xlsx.js';

const STAFF = ['hr_admin', 'payroll', 'finance', 'manager'] as const;
const today = () => luandaDate(new Date());
/** Para alertas informativos com a data de hoje: nunca falha num ano sem pacote publicado (usa o mais recente). */
const alertPack = (date: string) => packOrLatest('AO', Number(date.slice(0, 4)));

const patchBody = z.object({ ...personal, status: z.enum(['active', 'suspended']), vacationCarryOver: z.coerce.number().int().min(0, 'Dias transitados não podem ser negativos').max(44, 'Máximo de 44 dias transitados') }).partial();

const compensationBody = moneyFields.extend({ effectiveDate: z.iso.date(), reason: z.string().trim().min(3, 'Indique o motivo da alteração') }).refine(usdCheck, usdMessage);
const compensationSnapshot = z.object({
  effectiveDate: z.iso.date(), reason: z.string(),
  baseMinor: z.number().int().nonnegative(), mealMinor: z.number().int().nonnegative(), transportMinor: z.number().int().nonnegative(),
  salaryCurrency: z.enum(['AOA', 'USD']), baseForeignMinor: z.number().int().positive().nullable(),
});
const correctionBody = moneyFields.extend({
  reason: z.string().trim().min(3, 'Justifique a correcção').max(300),
  expected: compensationSnapshot,
}).strict().refine(usdCheck, usdMessage);

const documentBody = z.object({
  type: z.enum(['bi', 'passport', 'residence_card', 'work_visa', 'driving_licence', 'professional_card', 'other']),
  number: z.string().trim().toUpperCase().min(2),
  issueDate: optionalDate,
  expiryDate: optionalDate,
  issuer: optionalText,
  notes: optionalText,
}).refine((d) => d.type !== 'bi' || isValidAngolanBI(d.number), { message: 'BI com formato inválido (ex.: 004512398LA041)', path: ['number'] })
  .refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate > d.issueDate, { message: 'A validade tem de ser posterior à emissão', path: ['expiryDate'] });

// ───────────────────────── Regras partilhadas ─────────────────────────

async function assertDepartment(db: Db, companyId: string, departmentId: string | null | undefined) {
  if (!departmentId) return;
  const [d] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)));
  if (!d) throw new DomainError('departamento_invalido', 'Departamento inexistente nesta empresa', 400);
}

async function assertManager(db: Db, companyId: string, employeeId: string | null, managerId: string | null | undefined) {
  if (!managerId) return;
  const nodes = await db.select({ id: employees.id, managerId: employees.managerId, status: employees.status }).from(employees).where(eq(employees.companyId, companyId));
  const m = nodes.find((n) => n.id === managerId);
  if (!m) throw new DomainError('chefia_invalida', 'A chefia indicada não existe nesta empresa', 400);
  if (m.status === 'terminated') throw new DomainError('chefia_invalida', 'A chefia indicada já não está na empresa', 400);
  if (employeeId && createsCycle(nodes, employeeId, managerId)) throw new DomainError('ciclo_hierarquia', 'Esta chefia criaria um ciclo na hierarquia (a pessoa já está abaixo deste colaborador)', 400);
}

/** Alterações salariais não podem cair em meses já fechados: o acerto faz-se no processamento seguinte. */
async function assertPeriodOpen(db: Db, companyId: string, effectiveDate: string) {
  const [closed] = await db.select({ period: payrollRuns.period }).from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, effectiveDate.slice(0, 7))))
    .orderBy(desc(payrollRuns.period)).limit(1);
  if (closed) throw new DomainError('periodo_fechado', `O processamento de ${closed.period} já está fechado. Use uma data de efeito posterior e registe o retroactivo como acerto.`);
}

async function loadEmployee(db: Db, req: Actor, id: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, req.companyId)));
  if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  return e;
}

const audit = (db: Db, req: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) =>
  db.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action, entity, entityId, before: before as object, after: after as object });

// ───────────────────────── Rotas ─────────────────────────

export function employeeRoutes() {
  const app = new Hono<AppEnv>();
  for (const path of ['/v1/departments', '/v1/employees', '/v1/employees/*', '/v1/org-chart']) app.use(path, requireCompany);
  app.use('/v1/employees/import/*', bodyLimit({ maxSize: 6 * 1024 * 1024, onError: c => c.json({ error: 'ficheiro_excessivo', message: 'Os dados seleccionados excedem 6 MB. Divida o ficheiro em lotes menores.' }, 413) }));
  app.get('/v1/employees/import/template', requireRole('hr_admin'), () => xlsxResponse(employeeImportTemplate(), 'kianda-modelo-importacao-colaboradores.xlsx'));
  app.post('/v1/employees/import/preview', requireRole('hr_admin'), async c => {
    const input = employeeImportBody.parse(await body(c));
    return c.json(await previewEmployeeImport(getDb(), c.get('actor'), input));
  });
  app.post('/v1/employees/import/commit', requireRole('hr_admin'), async c => {
    const input = employeeImportCommitBody.parse(await body(c));
    const result = await commitEmployeeImport(getDb(), c.get('actor'), input);
    return c.json(result, result.replayed ? 200 : 201);
  });


  app.get('/v1/departments', requireRole(...STAFF), async (ctx) => {
    const req = ctx.get('actor');
    return ctx.json(await getDb().select().from(departments).where(eq(departments.companyId, req.companyId)).orderBy(asc(departments.name)));
  });

  app.post('/v1/departments', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const b = z.object({ name: z.string().trim().min(2), costCenter: z.string().trim().min(2).toUpperCase() }).parse(await body(ctx));
    const [d] = await getDb().insert(departments).values({ companyId: req.companyId, ...b }).returning();
    await audit(getDb(), req, 'create', 'department', d!.id, null, d);
    return ctx.json(d, 201);
  });

  app.get('/v1/employees', requireRole(...STAFF), async (ctx) => {
    const req = ctx.get('actor');
    const db = getDb();
    const latest = db.selectDistinctOn([contracts.employeeId], { employeeId: contracts.employeeId, type: contracts.type, startDate: contracts.startDate, endDate: contracts.endDate, baseMinor: contracts.baseMinor }).from(contracts)
      .innerJoin(employees, eq(employees.id, contracts.employeeId)).where(eq(employees.companyId, req.companyId)).orderBy(contracts.employeeId, desc(contracts.startDate)).as('latest_contract');
    const comp = db.select({ employeeId: compensationChanges.employeeId,
      changes: sql<CompensationChange[]>`jsonb_agg(jsonb_build_object('effectiveDate', ${compensationChanges.effectiveDate}, 'baseMinor', ${compensationChanges.baseMinor}, 'mealMinor', ${compensationChanges.mealMinor}, 'transportMinor', ${compensationChanges.transportMinor}))`.as('changes'),
    }).from(compensationChanges).where(eq(compensationChanges.companyId, req.companyId)).groupBy(compensationChanges.employeeId).as('compensation_by_employee');
    const docs = db.select({ employeeId: employeeDocuments.employeeId,
      documents: sql<{ type: DocumentType; number: string; expiryDate: string | null }[]>`jsonb_agg(jsonb_build_object('type', ${employeeDocuments.type}, 'number', ${employeeDocuments.number}, 'expiryDate', ${employeeDocuments.expiryDate}))`.as('documents'),
    }).from(employeeDocuments).where(eq(employeeDocuments.companyId, req.companyId)).groupBy(employeeDocuments.employeeId).as('documents_by_employee');
    const rows = await db.select({ e: employees, c: { employeeId: latest.employeeId, type: latest.type, startDate: latest.startDate, endDate: latest.endDate, baseMinor: latest.baseMinor }, dept: departments.name, comp: comp.changes, docs: docs.documents }).from(employees)
      .leftJoin(latest, eq(latest.employeeId, employees.id)).leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(comp, eq(comp.employeeId, employees.id)).leftJoin(docs, eq(docs.employeeId, employees.id))
      .where(eq(employees.companyId, req.companyId)).orderBy(employees.number);
    const t = today();
    const pack = alertPack(t);
    return ctx.json(rows.map(({ e, c, dept, comp, docs }) => {
      const current = compensationAt(comp ?? [], t);
      const baseMinor = current?.baseMinor ?? c?.baseMinor ?? 0;
      return {
        id: e.id, number: e.number, name: e.name, jobTitle: e.jobTitle, status: e.status, managerId: e.managerId,
        department: dept, province: e.province, nif: e.nif,
        contract: c ? { type: c.type, startDate: c.startDate, endDate: c.endDate, baseMinor } : null,
        alerts: c
          ? [
              ...contractAlerts({ startDate: c.startDate, endDate: c.endDate, type: c.type === 'fixed_term' ? 'fixed-term' : c.type }, t, pack).map((a) => a.message),
              ...complianceAlerts({ baseMinor, internship: c.type === 'internship' }, pack),
              ...documentAlerts(docs ?? [], t).map((a) => a.message),
            ]
          : ['Sem contrato registado'],
      };
    }));
  });

  app.post('/v1/employees', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const b = createBody.parse(await body(ctx));
    const db = getDb();
    await assertDepartment(db, req.companyId, b.departmentId);
    await assertManager(db, req.companyId, null, b.managerId);
    assertMinimumWage(kz(b.contract.base), b.contract.type, b.contract.startDate);
    const { contract, candidateId, ...data } = b;
    const [cand] = candidateId ? await db.select().from(candidates).where(and(eq(candidates.id, candidateId), eq(candidates.companyId, req.companyId))) : [];
    if (candidateId && !cand) throw new DomainError('nao_encontrado', 'Candidato inexistente', 404);
    if (cand && cand.stage !== 'offer') throw new DomainError('etapa_invalida', 'Só se admite um candidato na etapa de proposta', 409);
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, req.companyId)).for('update');
      const cap = await ensureEmployeeCapacity(tx as unknown as Db, req.companyId, 1, req.actorId);
      if (!cap.ok) throw new DomainError('limite_colaboradores', 'A licença permite ' + cap.limit + ' colaboradores activos. Mude para a faixa seguinte em Módulos e licenças.', 402);
      if (cand) {
        const [o] = await tx.select({ status: jobOpenings.status }).from(jobOpenings).where(and(eq(jobOpenings.id, cand.openingId), eq(jobOpenings.companyId, req.companyId))).for('update');
        if (!o || o.status === 'closed') throw new DomainError('vaga_fechada', 'Reabra a vaga antes de admitir o candidato', 409);
        const [current] = await tx.select({ stage: candidates.stage, employeeId: candidates.employeeId }).from(candidates).where(and(eq(candidates.id, cand.id), eq(candidates.companyId, req.companyId))).for('update');
        if (!current || current.stage !== 'offer' || current.employeeId) throw new DomainError('candidatura_alterada', 'A candidatura mudou entretanto. Actualize o ecrã antes de admitir.', 409);
        const [offer] = await tx.select().from(recruitmentOffers).where(eq(recruitmentOffers.candidateId, cand.id)).orderBy(desc(recruitmentOffers.version)).limit(1);
        if (offer && offer.status !== 'accepted') throw new DomainError('acordo_pendente', 'Registe a aceitação da proposta pelo candidato antes da admissão.', 409);
        if (offer && (contract.currency !== 'AOA' || kz(contract.base) !== offer.baseMinor || kz(contract.meal) !== offer.mealMinor || kz(contract.transport) !== offer.transportMinor)) throw new DomainError('salario_divergente', 'A remuneração da admissão deve coincidir com a proposta aceite. Prepare um novo acordo se os termos mudaram.', 409);
      }
      const [e] = await tx.insert(employees).values({ companyId: req.companyId, ...data, biNumber: data.biNumber ?? null }).returning();
      const [c] = await tx.insert(contracts).values({
        employeeId: e!.id, type: contract.type, startDate: contract.startDate, endDate: contract.endDate, termJustification: contract.termJustification,
        baseMinor: kz(contract.base), mealMinor: kz(contract.meal), transportMinor: kz(contract.transport), ...salaryCols(contract),
      }).returning();
      await tx.insert(compensationChanges).values({
        companyId: req.companyId, employeeId: e!.id, contractId: c!.id, effectiveDate: contract.startDate,
        baseMinor: c!.baseMinor, mealMinor: c!.mealMinor, transportMinor: c!.transportMinor, ...salaryCols(contract), reason: 'Admissão', createdBy: req.actorId,
      });
      await tx.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'employee', entityId: e!.id, after: { employee: e, contract: c } });
      // Acolhimento: a lista de tarefas começa na admissão (se o modelo da empresa o prevê).
      await startChecklist(tx as unknown as Db, { companyId: req.companyId, employeeId: e!.id, kind: 'onboarding', referenceDate: contract.startDate, actorId: req.actorId, automatic: true });
      // Documentos publicados para todos (ou para o seu departamento) ficam para ler e aceitar.
      await requestsForNewEmployee(tx as unknown as Db, req.companyId, { id: e!.id, departmentId: e!.departmentId });
      if (cand) {
        // Recrutamento: o candidato passa a contratado e fica ligado à ficha.
        await tx.update(candidates).set({ stage: 'hired', employeeId: e!.id, hiredAt: new Date(), updatedAt: new Date() }).where(eq(candidates.id, cand.id));
        const [ev] = await tx.insert(candidateEvents).values({ candidateId: cand.id, kind: 'stage', fromStage: cand.stage, toStage: 'hired', text: `Admitido com o n.º ${e!.number}`, actorId: req.actorId, actorName: req.session.name ?? null }).returning();
        const [job] = await tx.select({ title: jobOpenings.title }).from(jobOpenings).where(eq(jobOpenings.id, cand.openingId));
        await queueCandidateStage(tx as unknown as Db, cand, job!.title, 'hired', ev!.id);
      }
      return { ...e!, contract: c };
    });
    return ctx.json(result, 201);
  });

  /** Ficha completa. O próprio colaborador vê a sua; os perfis de gestão vêem todas. */
  app.get('/v1/employees/:id', async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const privileged = ['owner', ...STAFF].includes(req.role);
    if (!privileged && req.employeeId !== id) return ctx.json({ error: 'sem_permissao', message: 'Só pode consultar a sua própria ficha.' }, 403);
    const db = getDb();
    const e = await db.query.employees.findFirst({
      where: and(eq(employees.id, id), eq(employees.companyId, req.companyId)),
      with: { department: true, contracts: { orderBy: desc(contracts.startDate) }, compensation: true, documents: { orderBy: asc(employeeDocuments.type) } },
    });
    if (!e) return ctx.json({ error: 'nao_encontrado', message: 'Colaborador inexistente' }, 404);
    const [manager] = e.managerId
      ? await db.select({ id: employees.id, name: employees.name, jobTitle: employees.jobTitle }).from(employees).where(and(eq(employees.id, e.managerId), eq(employees.companyId, req.companyId)))
      : [];
    const reports = await db.select({ id: employees.id, name: employees.name, jobTitle: employees.jobTitle, number: employees.number }).from(employees)
      .where(and(eq(employees.companyId, req.companyId), eq(employees.managerId, e.id))).orderBy(employees.name);
    const [account] = await db.select({ email: users.email, role: users.role }).from(users).where(and(eq(users.companyId, req.companyId), eq(users.employeeId, e.id)));
    const t = today();
    const pack = alertPack(t);
    const current = compensationAt(e.compensation, t);
    const contract = e.contracts[0] ?? null;
    const { compensation, documents, contracts: allContracts, ...rest } = e;
    return ctx.json({
      ...rest,
      manager: manager ?? null,
      reports,
      account: account ?? null,
      contract,
      contracts: allContracts,
      compensation: { current, upcoming: compensation.filter((c) => c.effectiveDate > t).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)), history: compensationHistory(compensation).reverse() },
      documents,
      alerts: [
        ...(contract ? contractAlerts({ startDate: contract.startDate, endDate: contract.endDate, type: contract.type === 'fixed_term' ? 'fixed-term' : contract.type }, t, pack).map((a) => a.message) : ['Sem contrato registado']),
        ...(current && contract ? complianceAlerts({ baseMinor: current.baseMinor, internship: contract.type === 'internship' }, pack) : []),
        ...documentAlerts(documents as { id: string; type: DocumentType; number: string; expiryDate: string | null }[], t).map((a) => a.message),
        ...(!e.biNumber && !documents.some((d) => d.type === 'bi' || d.type === 'passport') ? ['Sem documento de identificação registado'] : []),
        ...(!e.iban ? ['Sem IBAN: o salário não pode ser incluído no ficheiro de transferência'] : []),
        ...(!e.inssNumber ? ['Sem número de segurança social (INSS)'] : []),
      ],
    });
  });

  app.patch('/v1/employees/:id', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const b = patchBody.parse(await body(ctx));
    const db = getDb();
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, req.companyId)).for('update');
    const before = await loadEmployee(db, req, id);
    if (before.status === 'terminated') throw new DomainError('colaborador_cessado', 'A ficha de um colaborador cessado não pode ser alterada');
    if (b.status === 'active' && before.status !== 'active') {
      const cap = await ensureEmployeeCapacity(db, req.companyId, 1, req.actorId);
      if (!cap.ok) throw new DomainError('limite_colaboradores', 'A licença atingiu o limite de colaboradores activos.', 402);
    }
    if ('departmentId' in b) await assertDepartment(db, req.companyId, b.departmentId);
    if ('managerId' in b) await assertManager(db, req.companyId, id, b.managerId);
    const changes = Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && (before as Record<string, unknown>)[k] !== v));
    if (!Object.keys(changes).length) return ctx.json(before);
    const [after] = await db.update(employees).set({ ...changes, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
    await audit(db, req, 'update', 'employee', id, Object.fromEntries(Object.keys(changes).map((k) => [k, (before as Record<string, unknown>)[k]])), changes);
    return ctx.json(after);
  });

  /** Novo contrato (renovação, conversão a indeterminado, promoção com novo vínculo). Encerra o anterior na véspera. */
  app.post('/v1/employees/:id/contracts', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const b = contractBody.parse(await body(ctx));
    const db = getDb();
    const e = await loadEmployee(db, req, id);
    if (e.status === 'terminated') throw new DomainError('colaborador_cessado', 'Colaborador cessado: readmita-o com uma nova ficha');
    const [prev] = await db.select().from(contracts).where(eq(contracts.employeeId, id)).orderBy(desc(contracts.startDate)).limit(1);
    if (prev && b.startDate <= prev.startDate) throw new DomainError('data_invalida', `O novo contrato tem de começar depois de ${prev.startDate} (início do contrato actual)`, 400);
    assertMinimumWage(kz(b.base), b.type, b.startDate);
    await assertPeriodOpen(db, req.companyId, b.startDate);
    const result = await db.transaction(async (tx) => {
      if (prev && !prev.terminatedAt) {
        const eve = new Date(Date.parse(`${b.startDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await tx.update(contracts).set({ terminatedAt: eve, terminationReason: 'Substituído por novo contrato', endDate: prev.endDate && prev.endDate < eve ? prev.endDate : eve }).where(eq(contracts.id, prev.id));
      }
      const [c] = await tx.insert(contracts).values({
        employeeId: id, type: b.type, startDate: b.startDate, endDate: b.endDate, termJustification: b.termJustification,
        baseMinor: kz(b.base), mealMinor: kz(b.meal), transportMinor: kz(b.transport), ...salaryCols(b),
      }).returning();
      await tx.insert(compensationChanges).values({
        companyId: req.companyId, employeeId: id, contractId: c!.id, effectiveDate: b.startDate,
        baseMinor: c!.baseMinor, mealMinor: c!.mealMinor, transportMinor: c!.transportMinor, ...salaryCols(b), reason: 'Novo contrato', createdBy: req.actorId,
      }).onConflictDoUpdate({ target: [compensationChanges.employeeId, compensationChanges.effectiveDate], set: { baseMinor: c!.baseMinor, mealMinor: c!.mealMinor, transportMinor: c!.transportMinor, ...salaryCols(b), reason: 'Novo contrato', contractId: c!.id } });
      await tx.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'contract', entityId: c!.id, before: prev ?? null, after: c });
      return c;
    });
    return ctx.json(result, 201);
  });

  /** Nova remuneração com data de efeito (actualização anual, promoção, ajuste). */
  app.post('/v1/employees/:id/compensation', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const b = compensationBody.parse(await body(ctx));
    const db = getDb();
    const e = await loadEmployee(db, req, id);
    if (e.status === 'terminated') throw new DomainError('colaborador_cessado', 'Colaborador cessado');
    const [c] = await db.select().from(contracts).where(eq(contracts.employeeId, id)).orderBy(desc(contracts.startDate)).limit(1);
    if (!c) throw new DomainError('sem_contrato', 'Registe primeiro um contrato');
    if (b.effectiveDate < c.startDate) throw new DomainError('data_invalida', `A data de efeito não pode ser anterior ao início do contrato (${c.startDate})`, 400);
    assertMinimumWage(kz(b.base), c.type, b.effectiveDate);
    await assertPeriodOpen(db, req.companyId, b.effectiveDate);
    const history = await db.select().from(compensationChanges).where(eq(compensationChanges.employeeId, id));
    const existing = history.find((h) => h.effectiveDate === b.effectiveDate);
    if (existing) throw new DomainError('duplicado', `Já existe uma alteração com efeito em ${b.effectiveDate}`);
    const [row] = await db.insert(compensationChanges).values({
      companyId: req.companyId, employeeId: id, contractId: c.id, effectiveDate: b.effectiveDate,
      baseMinor: kz(b.base), mealMinor: kz(b.meal), transportMinor: kz(b.transport), ...salaryCols(b), reason: b.reason, createdBy: req.actorId,
    }).returning();
    await audit(db, req, 'create', 'compensation', row!.id, compensationAt(history, b.effectiveDate), row);
    return ctx.json(row, 201);
  });

  /** Corrige um erro de registo sem criar um aumento/redução nem deslocar a data de efeito. */
  app.patch('/v1/employees/:id/compensation/:changeId', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id, changeId } = ctx.req.param();
    const b = correctionBody.parse(await body(ctx));
    const result = await getDb().transaction(async (tx) => {
      const e = await loadEmployee(tx, req, id);
      if (e.status === 'terminated') throw new DomainError('colaborador_cessado', 'Colaborador cessado');
      const [before] = await tx.select().from(compensationChanges)
        .where(and(eq(compensationChanges.id, changeId), eq(compensationChanges.employeeId, id), eq(compensationChanges.companyId, req.companyId))).for('update');
      if (!before) throw new DomainError('nao_encontrado', 'Registo de remuneração inexistente', 404);
      if ((Object.keys(b.expected) as (keyof typeof b.expected)[]).some((key) => b.expected[key] !== before[key]))
        throw new DomainError('registo_alterado', 'Este registo foi alterado por outra operação. Actualize a ficha antes de corrigir.');
      const [contract] = before.contractId ? await tx.select().from(contracts)
        .where(and(eq(contracts.id, before.contractId), eq(contracts.employeeId, id))) : [];
      if (!contract) throw new DomainError('sem_contrato', 'O registo não tem um contrato associado');
      assertMinimumWage(kz(b.base), contract.type, before.effectiveDate);
      await assertPeriodOpen(tx, req.companyId, before.effectiveDate);
      const values = { baseMinor: kz(b.base), mealMinor: kz(b.meal), transportMinor: kz(b.transport), ...salaryCols(b) };
      if ((Object.keys(values) as (keyof typeof values)[]).every((key) => values[key] === before[key]))
        throw new DomainError('sem_alteracao', 'Os valores indicados são iguais aos já registados', 400);
      const [after] = await tx.update(compensationChanges).set(values).where(eq(compensationChanges.id, before.id)).returning();
      // O contrato mantém coerência com a sua remuneração inicial, sem transformar ajustes posteriores no valor da admissão.
      if (contract.startDate === before.effectiveDate) await tx.update(contracts).set(values).where(eq(contracts.id, contract.id));
      await audit(tx, req, 'correct', 'compensation', before.id, before, { ...after, correctionReason: b.reason });
      const drafts = await tx.select({ period: payrollRuns.period }).from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, req.companyId), eq(payrollRuns.status, 'draft'), gte(payrollRuns.period, before.effectiveDate.slice(0, 7))))
        .orderBy(asc(payrollRuns.period));
      return { ...after!, draftPeriods: drafts.map((r) => r.period) };
    });
    return ctx.json(result);
  });

  app.post('/v1/employees/:id/documents', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const b = documentBody.parse(await body(ctx));
    const db = getDb();
    await loadEmployee(db, req, id);
    const [d] = await db.insert(employeeDocuments).values({ companyId: req.companyId, employeeId: id, ...b }).returning();
    if (b.type === 'bi') await db.update(employees).set({ biNumber: b.number, updatedAt: new Date() }).where(eq(employees.id, id));
    await audit(db, req, 'create', 'employee_document', d!.id, null, d);
    return ctx.json(d, 201);
  });

  app.delete('/v1/employees/:id/documents/:docId', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id, docId } = z.object({ id: z.string(), docId: z.string() }).parse(ctx.req.param());
    const db = getDb();
    const [d] = await db.delete(employeeDocuments).where(and(eq(employeeDocuments.id, docId), eq(employeeDocuments.employeeId, id), eq(employeeDocuments.companyId, req.companyId))).returning();
    if (!d) return ctx.json({ error: 'nao_encontrado', message: 'Documento inexistente' }, 404);
    await removeFiles(db, await db.select().from(files).where(and(eq(files.companyId, req.companyId), eq(files.entity, 'employee_document'), eq(files.entityId, d.id))));
    await audit(db, req, 'delete', 'employee_document', d.id, d, null);
    return ctx.body(null, 204);
  });

  /** Histórico de alterações da ficha (auditoria): quem mudou o quê e quando. */
  app.get('/v1/employees/:id/history', requireRole('hr_admin'), async (ctx) => {
    const req = ctx.get('actor');
    const { id } = z.object({ id: z.string() }).parse(ctx.req.param());
    const db = getDb();
    await loadEmployee(db, req, id);
    // Inclui registos de entidades já apagadas (ex.: documentos) através do employeeId guardado no antes/depois.
    const all = await db.select({ l: auditLogs, actor: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.companyId, req.companyId), or(
        eq(auditLogs.entityId, id),
        sql`${auditLogs.after}->>'employeeId' = ${id}`,
        sql`${auditLogs.before}->>'employeeId' = ${id}`,
      )))
      .orderBy(desc(auditLogs.at)).limit(200);
    return ctx.json(all.map(({ l, actor }) => ({ ...l, actorName: actor ?? 'Sistema' })));
  });

  app.get('/v1/org-chart', requireRole(...STAFF), async (ctx) => {
    const req = ctx.get('actor');
    const rows = await getDb().select({ id: employees.id, managerId: employees.managerId, name: employees.name, jobTitle: employees.jobTitle, number: employees.number, department: departments.name })
      .from(employees).leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(employees.companyId, req.companyId), inArray(employees.status, ['active', 'suspended'])));
    return ctx.json(buildOrgTree(rows, (n) => n.name));
  });

  return app;
}
