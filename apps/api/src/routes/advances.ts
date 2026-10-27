import {
  addMonths, advancePlan, calculatePayroll, checkAdvance, compensationAt, luandaDate, packOrLatest, paymentJournal,
} from '@kianda/core';
import {
  and, auditLogs, bankAccounts, compensationChanges, contracts, desc, eq, employees, getDb, inArray, journalEntries, journalLines, like, payrollRuns,
  payrollVariables, salaryAdvances, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { companyAccounts, DomainError } from '../services/payroll.js';

/**
 * Adiantamentos salariais (LGT, art. 248.º): pedido escrito do colaborador → aprovação com plano de prestações →
 * pagamento (lançamento 36.3 / banco) → reembolso automático no processamento, dentro dos limites legais
 * (até 3 salários base em dívida; descontos a crédito até 25% do líquido por mês).
 */
const DECIDE = ['owner', 'hr_admin', 'payroll'];
const PAY = ['owner', 'finance', 'payroll'];
const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisPeriod = () => luandaDate(new Date()).slice(0, 7);
const toMinor = (v: number) => Math.round(v * 100);

type Advance = typeof salaryAdvances.$inferSelect;

async function loadEmployee(db: Db, actor: Actor, id: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, actor.companyId)));
  if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  return e;
}

/** Remuneração em vigor e líquido mensal estimado (sem adiantamentos). */
async function payOf(db: Db, employeeId: string, period: string) {
  const end = `${period}-28`;
  const cs = await db.select().from(contracts).where(eq(contracts.employeeId, employeeId)).orderBy(desc(contracts.startDate));
  const contract = cs.find((c) => c.startDate <= end) ?? cs[0];
  if (!contract) throw new DomainError('sem_contrato', 'O colaborador não tem contrato registado', 400);
  const change = compensationAt(await db.select().from(compensationChanges).where(eq(compensationChanges.employeeId, employeeId)), end);
  const pay = change ?? contract;
  const pack = packOrLatest('AO', Number(period.slice(0, 4)));
  const r = calculatePayroll({ period: `${pack.year}-${period.slice(5)}`, pack, baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor });
  return { baseMinor: pay.baseMinor, netMinor: r.netMinor, pack };
}

/** Prestações já planeadas por mês (outros adiantamentos pagos ou aprovados) e valor em dívida. */
async function exposure(db: Db, employeeId: string, excludeId?: string) {
  const list = (await db.select().from(salaryAdvances).where(and(eq(salaryAdvances.employeeId, employeeId), inArray(salaryAdvances.status, ['pending', 'approved', 'paid']))))
    .filter((a) => a.id !== excludeId);
  const closed = new Set((await db.select({ p: payrollRuns.period }).from(payrollRuns).innerJoin(employees, eq(employees.companyId, payrollRuns.companyId))
    .where(and(eq(employees.id, employeeId), eq(payrollRuns.status, 'closed')))).map((r) => r.p));
  const perPeriod = new Map<string, number>();
  let outstanding = 0;
  for (const a of list) {
    for (const i of advancePlan(a.amountMinor, a.installments, a.firstPeriod)) {
      if (a.status === 'paid' && closed.has(i.period)) continue; // já descontado
      outstanding += i.amountMinor;
      if (a.status !== 'pending') perPeriod.set(i.period, (perPeriod.get(i.period) ?? 0) + i.amountMinor);
    }
  }
  return { outstanding, perPeriod };
}

async function evaluate(db: Db, employeeId: string, amountMinor: number, installments: number, firstPeriod: string, excludeId?: string) {
  const pay = await payOf(db, employeeId, firstPeriod);
  const exp = await exposure(db, employeeId, excludeId);
  const plan = advancePlan(amountMinor, installments, firstPeriod);
  const other = Math.max(0, ...plan.map((p) => exp.perPeriod.get(p.period) ?? 0));
  const check = checkAdvance({ amountMinor, installments, baseMinor: pay.baseMinor, netMinor: pay.netMinor, outstandingMinor: exp.outstanding, otherMonthlyDeductionsMinor: other, pack: pay.pack });
  return { ...check, plan, baseMinor: pay.baseMinor, netMinor: pay.netMinor, outstandingMinor: exp.outstanding };
}

async function nextNumber(db: Db, companyId: string) {
  const year = luandaDate(new Date()).slice(0, 4);
  const rows = await db.select({ n: salaryAdvances.number }).from(salaryAdvances).where(and(eq(salaryAdvances.companyId, companyId), like(salaryAdvances.number, `AD-${year}-%`)));
  return `AD-${year}-${String(rows.length + 1).padStart(4, '0')}`;
}

const canSee = (actor: Actor, a: Advance) => DECIDE.includes(actor.role) || PAY.includes(actor.role) || a.employeeId === actor.employeeId;

export function advanceRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/advances', requireCompany);
  app.use('/v1/advances/*', requireCompany);

  /** Lista: o colaborador vê os seus; RH, processamento e finanças vêem todos. */
  app.get('/v1/advances', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const staff = DECIDE.includes(actor.role) || PAY.includes(actor.role);
    if (!staff && !actor.employeeId) return c.json([]);
    const rows = await db.select({ a: salaryAdvances, name: employees.name, number: employees.number }).from(salaryAdvances)
      .innerJoin(employees, eq(employees.id, salaryAdvances.employeeId))
      .where(staff ? eq(salaryAdvances.companyId, actor.companyId) : eq(salaryAdvances.employeeId, actor.employeeId!))
      .orderBy(desc(salaryAdvances.createdAt)).limit(300);
    const closed = new Set((await db.select({ p: payrollRuns.period }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.status, 'closed')))).map((r) => r.p));
    return c.json(rows.map(({ a, name, number }) => {
      const plan = advancePlan(a.amountMinor, a.installments, a.firstPeriod).map((p) => ({ ...p, deducted: a.status === 'paid' && closed.has(p.period) }));
      const repaid = plan.filter((p) => p.deducted).reduce((s, p) => s + p.amountMinor, 0);
      return { ...a, employee: { id: a.employeeId, name, number }, plan, repaidMinor: repaid, outstandingMinor: a.status === 'paid' ? a.amountMinor - repaid : 0 };
    }));
  });

  /** Simulação: limites legais para um valor e número de prestações. */
  app.get('/v1/advances/simulate', async (c) => {
    const actor = c.get('actor');
    const q = z.object({ employeeId: z.string().optional(), amount: z.coerce.number().positive().max(1e9), installments: z.coerce.number().int().min(1).max(24), firstPeriod: z.string().regex(periodRe).optional() }).parse(c.req.query());
    const employeeId = q.employeeId ?? actor.employeeId;
    if (!employeeId) throw new DomainError('sem_ficha', 'Indique o colaborador', 400);
    if (employeeId !== actor.employeeId && !DECIDE.includes(actor.role)) throw new DomainError('sem_permissao', 'Sem acesso a este colaborador', 403);
    const db = getDb();
    await loadEmployee(db, actor, employeeId);
    return c.json(await evaluate(db, employeeId, toMinor(q.amount), q.installments, q.firstPeriod ?? addMonths(thisPeriod(), 1)));
  });

  /** Pedido escrito (art. 248.º, n.º 6): o próprio colaborador, ou o RH com o pedido escrito em arquivo. */
  app.post('/v1/advances', async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      employeeId: z.string().optional(),
      amount: z.number().positive().max(1e9),
      installments: z.number().int().min(1).max(24),
      firstPeriod: z.string().regex(periodRe).optional(),
      reason: z.string().trim().max(500).optional().nullable(),
      confirm: z.literal(true, { message: 'Confirme o pedido escrito de adiantamento e a autorização de desconto no salário' }),
    }).parse(await body(c));
    const employeeId = b.employeeId ?? actor.employeeId;
    if (!employeeId) throw new DomainError('sem_ficha', 'O seu utilizador não tem ficha de colaborador', 400);
    if (employeeId !== actor.employeeId && !DECIDE.includes(actor.role)) throw new DomainError('sem_permissao', 'Só o próprio colaborador pede um adiantamento (ou o RH, com o pedido escrito em arquivo)', 403);
    const db = getDb();
    const e = await loadEmployee(db, actor, employeeId);
    if (e.status !== 'active') throw new DomainError('inactivo', 'Só colaboradores activos podem pedir adiantamentos');
    const firstPeriod = b.firstPeriod ?? addMonths(thisPeriod(), 1);
    if (firstPeriod < thisPeriod()) throw new DomainError('periodo_passado', 'O primeiro desconto não pode ser num mês passado', 400);
    const amountMinor = toMinor(b.amount);
    const ev = await evaluate(db, e.id, amountMinor, b.installments, firstPeriod);
    if (ev.problems.length) throw new DomainError('limite_legal', ev.problems.join(' · '), 422);
    const [row] = await db.insert(salaryAdvances).values({
      companyId: actor.companyId, employeeId: e.id, number: await nextNumber(db, actor.companyId), amountMinor, installments: b.installments, firstPeriod,
      reason: b.reason ?? null, requestedBy: actor.actorId, writtenRequestAt: new Date(),
    }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'request', entity: 'salary_advance', entityId: row!.id, after: row });
    return c.json(row, 201);
  });

  /** Decisão (RH/processamento): aprovar com o plano (pode ajustar prestações e primeiro mês) ou recusar com motivo. */
  app.post('/v1/advances/:id/decide', async (c) => {
    const actor = c.get('actor');
    if (!DECIDE.includes(actor.role)) throw new DomainError('sem_permissao', 'Só o RH ou o processamento salarial decidem adiantamentos', 403);
    const b = z.object({
      approve: z.boolean(), installments: z.number().int().min(1).max(24).optional(), firstPeriod: z.string().regex(periodRe).optional(),
      note: z.string().trim().max(500).optional().nullable(),
    }).refine((x) => x.approve || (x.note && x.note.length >= 3), { message: 'Indique o motivo da recusa', path: ['note'] }).parse(await body(c));
    const db = getDb();
    const [a] = await db.select().from(salaryAdvances).where(and(eq(salaryAdvances.id, c.req.param('id')), eq(salaryAdvances.companyId, actor.companyId)));
    if (!a) throw new DomainError('nao_encontrado', 'Pedido inexistente', 404);
    if (a.status !== 'pending') throw new DomainError('estado_invalido', 'Este pedido já foi decidido');
    if (actor.employeeId && actor.employeeId === a.employeeId && actor.role !== 'owner') throw new DomainError('proprio', 'Ninguém decide o próprio adiantamento', 403);
    let values: Partial<Advance> = { status: 'rejected' };
    if (b.approve) {
      const installments = b.installments ?? a.installments;
      const firstPeriod = b.firstPeriod ?? a.firstPeriod;
      if (firstPeriod < thisPeriod()) throw new DomainError('periodo_passado', 'O primeiro desconto não pode ser num mês passado', 400);
      const ev = await evaluate(db, a.employeeId, a.amountMinor, installments, firstPeriod, a.id);
      if (ev.problems.length) throw new DomainError('limite_legal', ev.problems.join(' · '), 422);
      values = { status: 'approved', installments, firstPeriod };
    }
    const [u] = await db.update(salaryAdvances).set({ ...values, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: b.note ?? null }).where(eq(salaryAdvances.id, a.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: b.approve ? 'approve' : 'reject', entity: 'salary_advance', entityId: a.id, before: a, after: u });
    return c.json(u);
  });

  /** Pagamento (finanças/processamento): lançamento 36.3 / banco e prestações no processamento dos meses seguintes. */
  app.post('/v1/advances/:id/pay', async (c) => {
    const actor = c.get('actor');
    if (!PAY.includes(actor.role)) throw new DomainError('sem_permissao', 'Só as finanças ou o processamento registam o pagamento', 403);
    const b = z.object({ paidOn: z.iso.date(), bankAccountId: z.string().optional().nullable() }).parse(await body(c));
    const db = getDb();
    const [a] = await db.select({ a: salaryAdvances, name: employees.name }).from(salaryAdvances).innerJoin(employees, eq(employees.id, salaryAdvances.employeeId))
      .where(and(eq(salaryAdvances.id, c.req.param('id')), eq(salaryAdvances.companyId, actor.companyId)));
    if (!a) throw new DomainError('nao_encontrado', 'Pedido inexistente', 404);
    if (a.a.status !== 'approved') throw new DomainError('estado_invalido', a.a.status === 'paid' ? 'Já foi pago' : 'Só se pagam adiantamentos aprovados');
    if (b.paidOn > luandaDate(new Date())) throw new DomainError('data_futura', 'A data de pagamento não pode ser futura', 400);
    const plan = advancePlan(a.a.amountMinor, a.a.installments, a.a.firstPeriod);
    const closed = await db.select({ p: payrollRuns.period }).from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.status, 'closed'), inArray(payrollRuns.period, plan.map((p) => p.period))));
    if (closed.length) throw new DomainError('periodo_fechado', `O processamento de ${closed[0]!.p} já está fechado: aprove de novo com um primeiro mês por fechar`);
    const acc = await companyAccounts(db, actor.companyId);
    let bankAccountId = b.bankAccountId ?? null;
    const [ba] = bankAccountId
      ? await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, actor.companyId)))
      : await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, actor.companyId), eq(bankAccounts.active, true))).limit(1);
    if (bankAccountId && !ba) throw new DomainError('conta_inexistente', 'Conta bancária inexistente', 404);
    if (ba) { acc.bank = ba.ledgerAccount; bankAccountId = ba.id; }
    const entry = paymentJournal(b.paidOn, a.a.number, `Adiantamento salarial ${a.a.number} — ${a.name}`, acc.advances, a.a.amountMinor, acc);
    const [je] = await db.insert(journalEntries).values({ companyId: actor.companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'salary_advance' }).returning();
    await db.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
    await db.insert(payrollVariables).values(plan.map((p, i) => ({
      companyId: actor.companyId, employeeId: a.a.employeeId, period: p.period, kind: 'advance' as const, label: `Adiantamento ${a.a.number} (${i + 1}/${plan.length})`,
      amountMinor: p.amountMinor, inInss: false, inIrt: false, advanceId: a.a.id, createdBy: actor.actorId,
    })));
    const [u] = await db.update(salaryAdvances).set({ status: 'paid', paidOn: b.paidOn, paidBy: actor.actorId, bankAccountId, journalEntryId: je!.id }).where(eq(salaryAdvances.id, a.a.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'pay', entity: 'salary_advance', entityId: a.a.id, after: { ...u, journal: entry.reference, plan } });
    return c.json(u);
  });

  /** Cancelar: o próprio enquanto pendente; o RH enquanto pendente ou aprovado (antes do pagamento). */
  app.post('/v1/advances/:id/cancel', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [a] = await db.select().from(salaryAdvances).where(and(eq(salaryAdvances.id, c.req.param('id')), eq(salaryAdvances.companyId, actor.companyId)));
    if (!a || !canSee(actor, a)) throw new DomainError('nao_encontrado', 'Pedido inexistente', 404);
    const own = a.employeeId === actor.employeeId;
    const allowed = (a.status === 'pending' && (own || DECIDE.includes(actor.role))) || (a.status === 'approved' && DECIDE.includes(actor.role));
    if (!allowed) throw new DomainError('estado_invalido', a.status === 'paid' ? 'Já foi pago: o reembolso segue no processamento' : 'Este pedido já não pode ser cancelado');
    const [u] = await db.update(salaryAdvances).set({ status: 'cancelled' }).where(eq(salaryAdvances.id, a.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'cancel', entity: 'salary_advance', entityId: a.id, before: a, after: u });
    return c.json(u);
  });

  return app;
}
