import {
  businessDays, calculatePayroll, compensationAt, fullMonthsBetween, getPack, labourRules, luandaDate, packOrLatest, SETTLEMENT_LABEL, settlementTotals,
  TERMINATION_REASONS, terminationProposal, type SettlementItem, type TerminationReason,
} from '@kianda/core';
import {
  absences, and, asc, auditLogs, companies, compensationChanges, contracts, desc, employees, eq, getDb, gte, inArray, lte, payrollLines, payrollRuns,
  payrollVariables, terminations, users, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const READERS = ['hr_admin', 'payroll', 'finance'] as const;
const ptDate = (d: string) => d.split('-').reverse().join('/');
const REASONS = Object.keys(TERMINATION_REASONS) as [TerminationReason, ...TerminationReason[]];
const CODES = Object.keys(SETTLEMENT_LABEL) as [SettlementItem['code'], ...SettlementItem['code'][]];

const itemBody = z.object({
  code: z.enum(CODES), label: z.string().trim().min(2).max(120), basis: z.string().trim().max(300).default(''),
  kind: z.enum(['earning', 'deduction']), amountMinor: z.number().int().min(0).max(1e13), inInss: z.boolean(), inIrt: z.boolean(),
});
const caseBody = z.object({
  employeeId: z.string(),
  reason: z.enum(REASONS),
  effectiveDate: z.iso.date(),
  noticeDate: z.iso.date().optional().nullable(),
  agreedCompensationMinor: z.number().int().min(0).max(1e13).optional().nullable(),
  items: z.array(itemBody).max(40).optional(),
  note: z.string().trim().max(1000).optional().nullable(),
}).refine((b) => !b.noticeDate || b.noticeDate <= b.effectiveDate, { message: 'A comunicação não pode ser posterior à data de efeito', path: ['noticeDate'] });

/** Tudo o que o motor precisa para propor o fecho de contas de um colaborador numa data. */
async function context(db: Db, companyId: string, employeeId: string, effectiveDate: string) {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)));
  if (!emp) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  const cs = await db.select().from(contracts).where(eq(contracts.employeeId, emp.id)).orderBy(asc(contracts.startDate));
  if (!cs.length) throw new DomainError('sem_contrato', 'O colaborador não tem contrato registado', 422);
  const hire = cs[0]!.startDate;
  const contract = [...cs].reverse().find((c) => c.startDate <= effectiveDate) ?? cs[cs.length - 1]!;
  if (effectiveDate < hire) throw new DomainError('data_invalida', 'A data de efeito é anterior à admissão', 400);
  const changes = await db.select().from(compensationChanges).where(eq(compensationChanges.employeeId, emp.id));
  const pay = compensationAt(changes, effectiveDate) ?? contract;
  const year = Number(effectiveDate.slice(0, 4));
  const pack = packOrLatest('AO', year);
  const rules = labourRules('AO', year);

  // Férias do ano: direito (proporcional no ano de admissão, até à data de efeito) − gozadas até à data de efeito.
  const yearStart = `${year}-01-01`;
  const entitlement = hire >= yearStart
    ? Math.min(pack.labour.vacationWorkingDays, fullMonthsBetween(hire, effectiveDate) * pack.leave.firstYearDaysPerMonth)
    : pack.labour.vacationWorkingDays + (year === Number(luandaDate(new Date()).slice(0, 4)) ? emp.vacationCarryOver : 0);
  const vac = await db.select().from(absences).where(and(eq(absences.employeeId, emp.id), eq(absences.type, 'vacation'), inArray(absences.status, ['approved', 'pending']), gte(absences.endDate, yearStart)));
  let taken = 0;
  const warnings: string[] = [];
  for (const a of vac) {
    if (a.status === 'approved' && a.startDate <= effectiveDate) {
      const from = a.startDate < yearStart ? yearStart : a.startDate;
      const to = a.endDate > effectiveDate ? effectiveDate : a.endDate;
      taken += businessDays(from, to, [rules]);
    }
    if (a.endDate > effectiveDate) warnings.push(`Há férias ${a.status === 'approved' ? 'aprovadas' : 'pedidas'} depois da data de efeito (${ptDate(a.startDate)} a ${ptDate(a.endDate)}): cancele-as.`);
  }
  // Subsídios já pagos em processamentos fechados do ano.
  const paidLines = await db.select({ breakdown: payrollLines.breakdown }).from(payrollLines).innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
    .where(and(eq(payrollLines.employeeId, emp.id), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, `${year}-01`), lte(payrollRuns.period, `${year}-12`)));
  const paid = (code: string) => paidLines.some((l) => (l.breakdown as { code: string; amountMinor: number }[]).some((x) => x.code === code && x.amountMinor > 0));
  const period = effectiveDate.slice(0, 7);
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period)));
  if (run?.status === 'closed') warnings.push(`O processamento de ${period.slice(5)}/${period.slice(0, 4)} já está fechado: o fecho de contas não pode entrar nesse mês.`);
  if (emp.status === 'terminated') warnings.push('O colaborador já está cessado.');
  return {
    emp, contract, hire, pay, pack, period, run, warnings,
    vacation: { entitlement, taken, unused: Math.max(0, entitlement - taken) },
    holidayPaid: paid('SUBFER'), christmasPaid: paid('SUBNAT'),
  };
}

function propose(ctx: Awaited<ReturnType<typeof context>>, b: Pick<z.infer<typeof caseBody>, 'reason' | 'effectiveDate' | 'noticeDate' | 'agreedCompensationMinor'>) {
  return terminationProposal({
    reason: b.reason, hireDate: ctx.hire, effectiveDate: b.effectiveDate, noticeDate: b.noticeDate ?? null, baseMinor: ctx.pay.baseMinor,
    vacationUnusedDays: ctx.vacation.unused, holidaySubsidyPaidThisYear: ctx.holidayPaid, christmasSubsidyPaidThisYear: ctx.christmasPaid,
    agreedCompensationMinor: b.agreedCompensationMinor ?? null, pack: ctx.pack,
  });
}

/** Recibo final estimado: mês incompleto + linhas do fecho de contas (sem horas extra nem faltas do mês). */
function finalPayslip(ctx: Awaited<ReturnType<typeof context>>, effectiveDate: string, items: SettlementItem[]) {
  const period = effectiveDate.slice(0, 7);
  const start = ctx.hire > `${period}-01` ? ctx.hire : `${period}-01`;
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const workedDays = start === `${period}-01` && effectiveDate === last ? undefined : Math.round((Date.parse(effectiveDate) - Date.parse(start)) / 86_400_000) + 1;
  try {
    return calculatePayroll({
      period, pack: getPack('AO', Number(period.slice(0, 4))), baseMinor: ctx.pay.baseMinor, mealMinor: ctx.pay.mealMinor, transportMinor: ctx.pay.transportMinor, workedDays,
      otherEarnings: items.filter((i) => i.kind === 'earning').map((i) => ({ code: i.code, name: i.label, amountMinor: i.amountMinor, inInss: i.inInss, inIrt: i.inIrt })),
      noticeDeductionMinor: items.filter((i) => i.code === 'AVISODESC').reduce((s, i) => s + i.amountMinor, 0),
      otherDeductionsMinor: items.filter((i) => i.kind === 'deduction' && i.code !== 'AVISODESC').reduce((s, i) => s + i.amountMinor, 0),
    });
  } catch {
    return null; // ano sem pacote fiscal ou líquido negativo: mostrado como indisponível
  }
}

export function terminationRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/terminations', requireCompany);
  app.use('/v1/terminations/*', requireCompany);

  app.get('/v1/terminations', requireRole(...READERS), async (c) => {
    const db = getDb();
    const rows = await db.select({ t: terminations, name: employees.name, number: employees.number }).from(terminations).innerJoin(employees, eq(employees.id, terminations.employeeId))
      .where(eq(terminations.companyId, c.get('actor').companyId)).orderBy(desc(terminations.createdAt));
    return c.json(rows.map(({ t, name, number }) => ({ ...t, employeeName: name, employeeNumber: number, reasonLabel: TERMINATION_REASONS[t.reason as TerminationReason]?.label })));
  });

  /** Proposta do fecho de contas (não grava). */
  app.post('/v1/terminations/preview', requireRole('hr_admin'), async (c) => {
    const b = caseBody.parse(await body(c));
    const ctx = await context(getDb(), c.get('actor').companyId, b.employeeId, b.effectiveDate);
    const proposal = propose(ctx, b);
    const items = b.items ?? proposal.items;
    return c.json({
      employee: { id: ctx.emp.id, name: ctx.emp.name, number: ctx.emp.number, jobTitle: ctx.emp.jobTitle }, hireDate: ctx.hire,
      contract: { type: ctx.contract.type, startDate: ctx.contract.startDate, endDate: ctx.contract.endDate }, pay: { baseMinor: ctx.pay.baseMinor, mealMinor: ctx.pay.mealMinor, transportMinor: ctx.pay.transportMinor },
      vacation: ctx.vacation, proposal, items, totals: settlementTotals(items), payslip: finalPayslip(ctx, b.effectiveDate, items), warnings: ctx.warnings,
    });
  });

  app.post('/v1/terminations', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = caseBody.parse(await body(c));
    const db = getDb();
    const [open] = await db.select({ id: terminations.id }).from(terminations).where(and(eq(terminations.employeeId, b.employeeId), inArray(terminations.status, ['draft', 'confirmed'])));
    if (open) throw new DomainError('cessacao_existente', 'Já existe uma cessação em curso ou confirmada para este colaborador');
    const ctx = await context(db, actor.companyId, b.employeeId, b.effectiveDate);
    if (ctx.emp.status === 'terminated') throw new DomainError('colaborador_cessado', 'O colaborador já está cessado');
    const proposal = propose(ctx, b);
    const [t] = await db.insert(terminations).values({
      companyId: actor.companyId, employeeId: ctx.emp.id, contractId: ctx.contract.id, reason: b.reason, noticeDate: b.noticeDate ?? null, effectiveDate: b.effectiveDate,
      period: ctx.period, agreedCompensationMinor: b.agreedCompensationMinor ?? null, items: b.items ?? proposal.items, proposal: { ...proposal, items: undefined, vacation: ctx.vacation },
      note: b.note ?? null, createdBy: actor.actorId,
    }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'termination', entityId: t!.id, after: t });
    return c.json(t, 201);
  });

  app.put('/v1/terminations/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = caseBody.parse(await body(c));
    const db = getDb();
    const [t] = await db.select().from(terminations).where(and(eq(terminations.id, c.req.param('id')), eq(terminations.companyId, actor.companyId)));
    if (!t) throw new DomainError('nao_encontrado', 'Cessação inexistente', 404);
    if (t.status !== 'draft') throw new DomainError('estado_invalido', 'Só se alteram cessações em rascunho');
    if (b.employeeId !== t.employeeId) throw new DomainError('dados_invalidos', 'Não se muda o colaborador de uma cessação', 400);
    const ctx = await context(db, actor.companyId, t.employeeId, b.effectiveDate);
    const proposal = propose(ctx, b);
    const [u] = await db.update(terminations).set({
      reason: b.reason, noticeDate: b.noticeDate ?? null, effectiveDate: b.effectiveDate, period: ctx.period, contractId: ctx.contract.id,
      agreedCompensationMinor: b.agreedCompensationMinor ?? null, items: b.items ?? proposal.items, proposal: { ...proposal, items: undefined, vacation: ctx.vacation }, note: b.note ?? null,
    }).where(eq(terminations.id, t.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'termination', entityId: t.id, before: t, after: u });
    return c.json(u);
  });

  app.get('/v1/terminations/:id', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [t] = await db.select().from(terminations).where(and(eq(terminations.id, c.req.param('id')), eq(terminations.companyId, actor.companyId)));
    if (!t) throw new DomainError('nao_encontrado', 'Cessação inexistente', 404);
    const ctx = await context(db, actor.companyId, t.employeeId, t.effectiveDate);
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const items = t.items as SettlementItem[];
    return c.json({
      ...t, reasonLabel: TERMINATION_REASONS[t.reason as TerminationReason]?.label, legal: TERMINATION_REASONS[t.reason as TerminationReason]?.legal,
      company: { name: co!.name, nif: co!.nif, address: co!.address },
      employee: { id: ctx.emp.id, name: ctx.emp.name, number: ctx.emp.number, jobTitle: ctx.emp.jobTitle, biNumber: ctx.emp.biNumber, nif: ctx.emp.nif, status: ctx.emp.status },
      hireDate: ctx.hire, contract: { type: ctx.contract.type, startDate: ctx.contract.startDate },
      pay: { baseMinor: ctx.pay.baseMinor, mealMinor: ctx.pay.mealMinor, transportMinor: ctx.pay.transportMinor },
      totals: settlementTotals(items), payslip: finalPayslip(ctx, t.effectiveDate, items), warnings: t.status === 'draft' ? ctx.warnings : [],
    });
  });

  /**
   * Confirmar: termina o contrato na data de efeito, marca a ficha como cessada, desactiva o acesso e põe o fecho de contas
   * no processamento do mês (variáveis geridas pela cessação).
   */
  app.post('/v1/terminations/:id/confirm', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [t] = await db.select().from(terminations).where(and(eq(terminations.id, c.req.param('id')), eq(terminations.companyId, actor.companyId)));
    if (!t) throw new DomainError('nao_encontrado', 'Cessação inexistente', 404);
    if (t.status !== 'draft') throw new DomainError('estado_invalido', 'A cessação não está em rascunho');
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, t.period)));
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', `O processamento de ${t.period} já está fechado: altere a data de efeito`);
    const items = t.items as SettlementItem[];
    const reason = TERMINATION_REASONS[t.reason as TerminationReason];
    const result = await db.transaction(async (tx) => {
      await tx.update(contracts).set({ terminatedAt: t.effectiveDate, terminationReason: reason.label }).where(eq(contracts.id, t.contractId));
      await tx.update(employees).set({ status: 'terminated' }).where(eq(employees.id, t.employeeId));
      await tx.update(users).set({ disabledAt: new Date() }).where(and(eq(users.employeeId, t.employeeId), eq(users.companyId, actor.companyId)));
      if (items.length) {
        await tx.insert(payrollVariables).values(items.filter((i) => i.amountMinor > 0).map((i) => ({
          companyId: actor.companyId, employeeId: t.employeeId, period: t.period,
          kind: i.kind === 'earning' ? 'other_earning' as const : 'other_deduction' as const,
          label: i.label, amountMinor: i.amountMinor, inInss: i.inInss, inIrt: i.inIrt, code: i.code, terminationId: t.id, note: i.basis || null, createdBy: actor.actorId,
        })));
      }
      const [u] = await tx.update(terminations).set({ status: 'confirmed', confirmedBy: actor.actorId, confirmedAt: new Date() }).where(eq(terminations.id, t.id)).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'confirm', entity: 'termination', entityId: t.id, after: u });
      return u!;
    });
    return c.json({ ...result, payrollDraftNeedsRefresh: Boolean(run) });
  });

  /** Anular: rascunho → anulada; confirmada → reverte (se o processamento do mês ainda não fechou). */
  app.post('/v1/terminations/:id/cancel', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo') }).parse(await body(c));
    const db = getDb();
    const [t] = await db.select().from(terminations).where(and(eq(terminations.id, c.req.param('id')), eq(terminations.companyId, actor.companyId)));
    if (!t) throw new DomainError('nao_encontrado', 'Cessação inexistente', 404);
    if (t.status === 'cancelled') throw new DomainError('estado_invalido', 'Já está anulada');
    if (t.status === 'confirmed') {
      const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, t.period)));
      if (run?.status === 'closed') throw new DomainError('processamento_fechado', `O fecho de contas já foi processado em ${t.period}: a cessação não pode ser anulada (readmita com nova ficha)`);
    }
    const u = await db.transaction(async (tx) => {
      if (t.status === 'confirmed') {
        await tx.delete(payrollVariables).where(eq(payrollVariables.terminationId, t.id));
        await tx.update(contracts).set({ terminatedAt: null, terminationReason: null }).where(eq(contracts.id, t.contractId));
        await tx.update(employees).set({ status: 'active' }).where(eq(employees.id, t.employeeId));
        await tx.update(users).set({ disabledAt: null }).where(and(eq(users.employeeId, t.employeeId), eq(users.companyId, actor.companyId)));
      }
      const [x] = await tx.update(terminations).set({ status: 'cancelled', cancelledBy: actor.actorId, cancelledAt: new Date(), cancelNote: note }).where(eq(terminations.id, t.id)).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'cancel', entity: 'termination', entityId: t.id, before: t, after: x });
      return x!;
    });
    return c.json(u);
  });

  return app;
}
