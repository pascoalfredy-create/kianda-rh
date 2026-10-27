/**
 * Orçamento de pessoal: projecção a partir do quadro actual e de hipóteses, edição por mês/departamento, aprovação
 * e comparação com o real (processamentos fechados). Custo com pessoal = ilíquido + INSS da entidade empregadora.
 */
import {
  budgetProjection, budgetVsActual, compensationAt, getPack, luandaDate, type BudgetAssumptions, type BudgetCell, type BudgetEmployee, type CountryPack,
} from '@kianda/core';
import {
  allowanceTypes, and, asc, auditLogs, companies, compensationChanges, contracts, departments, employeeAllowances, employees, eq, getDb, inArray,
  payrollLines, payrollRuns, personnelBudgetLines, personnelBudgets, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { xlsx, xlsxResponse } from '../lib/xlsx.js';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM');
const assumptionsSchema = z.object({
  year: z.number().int().min(2024).max(2100),
  increaseBps: z.number().int().min(-5000).max(10_000).default(0),
  increaseFrom: period,
  holidayMonth: z.number().int().min(1).max(12),
  christmasMonth: z.number().int().min(1).max(12),
  hires: z.array(z.object({
    departmentId: z.string().nullable(), from: period, count: z.number().int().min(1).max(500),
    baseMinor: z.number().int().min(0).max(1e12), mealMinor: z.number().int().min(0).max(1e11).default(0), transportMinor: z.number().int().min(0).max(1e11).default(0),
    label: z.string().trim().max(80).optional(),
  })).max(100).default([]),
}).refine((a) => a.increaseFrom.startsWith(`${a.year}-`), { message: 'O mês do aumento tem de ser do ano do orçamento', path: ['increaseFrom'] })
  .refine((a) => a.hires.every((h) => h.from.startsWith(`${a.year}-`)), { message: 'As admissões têm de ser no ano do orçamento', path: ['hires'] });

/** Pacote do ano ou, se ainda não publicado (OGE), o mais recente — taxas de INSS e subsídios. */
function packFor(year: number): CountryPack {
  for (let y = year; y >= 2024; y--) { try { return getPack('AO', y); } catch { /* ano sem pacote */ } }
  throw new DomainError('sem_pacote', 'Sem pacote de regras para este ano', 422);
}

async function currentStaff(db: Db, companyId: string): Promise<BudgetEmployee[]> {
  const emps = await db.select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.status, 'active')));
  if (!emps.length) return [];
  const ids = emps.map((e) => e.id);
  const cons = await db.select().from(contracts).where(inArray(contracts.employeeId, ids)).orderBy(asc(contracts.startDate));
  const changes = await db.select().from(compensationChanges).where(inArray(compensationChanges.employeeId, ids));
  const allow = await db.select({ a: employeeAllowances, t: allowanceTypes }).from(employeeAllowances).innerJoin(allowanceTypes, eq(allowanceTypes.id, employeeAllowances.typeId))
    .where(and(eq(employeeAllowances.companyId, companyId), eq(allowanceTypes.active, true)));
  const today = luandaDate(new Date());
  const out: BudgetEmployee[] = [];
  for (const e of emps) {
    const mine = cons.filter((c) => c.employeeId === e.id && !c.terminatedAt);
    const c = mine[mine.length - 1];
    if (!c) continue;
    const pay = compensationAt(changes.filter((x) => x.employeeId === e.id), today) ?? c;
    const first = cons.find((x) => x.employeeId === e.id)!;
    out.push({
      id: e.id, departmentId: e.departmentId, baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor, otherMinor: c.otherMinor,
      startDate: first.startDate, endDate: c.endDate,
      allowances: allow.filter((x) => x.a.employeeId === e.id).map(({ a, t }) => ({
        calc: t.calc as 'fixed' | 'base_pct' | 'per_day', valueMinor: a.valueMinor ?? t.valueMinor, bps: a.bps ?? t.bps, inInss: t.inInss, startDate: a.startDate, endDate: a.endDate,
      })),
    });
  }
  return out;
}

async function project(db: Db, companyId: string, a: BudgetAssumptions) {
  const pack = packFor(a.year);
  const staff = await currentStaff(db, companyId);
  const cells = budgetProjection(staff, a, {
    holidayBps: pack.labour.holidaySubsidyBps, christmasBps: pack.labour.christmasSubsidyBps, employerInssBps: pack.inss.employerBps,
    holidayInInss: pack.inss.holidaySubsidyInBase, christmasInInss: pack.inss.christmasSubsidyInBase, dailyRateDivisor: pack.labour.dailyRateDivisor,
  });
  return { cells, packVersion: pack.version, staff: staff.length };
}

async function actualCells(db: Db, companyId: string, year: number) {
  const runs = await db.select({ id: payrollRuns.id, period: payrollRuns.period }).from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed')));
  const ofYear = runs.filter((r) => r.period.startsWith(`${year}-`));
  if (!ofYear.length) return { closed: [] as string[], cells: [] as { period: string; departmentId: string | null; costMinor: number; headcount: number }[] };
  const per = new Map(ofYear.map((r) => [r.id, r.period]));
  const lines = await db.select({ runId: payrollLines.runId, gross: payrollLines.grossMinor, employer: payrollLines.inssEmployerMinor, dept: employees.departmentId })
    .from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(inArray(payrollLines.runId, ofYear.map((r) => r.id)));
  const m = new Map<string, { period: string; departmentId: string | null; costMinor: number; headcount: number }>();
  for (const l of lines) {
    const p = per.get(l.runId)!;
    const k = `${p}|${l.dept ?? ''}`;
    const c = m.get(k) ?? { period: p, departmentId: l.dept, costMinor: 0, headcount: 0 };
    c.costMinor += l.gross + l.employer;
    c.headcount += 1;
    m.set(k, c);
  }
  return { closed: ofYear.map((r) => r.period), cells: [...m.values()] };
}

async function budgetOf(db: Db, actor: Actor, id: string) {
  const [b] = await db.select().from(personnelBudgets).where(and(eq(personnelBudgets.id, id), eq(personnelBudgets.companyId, actor.companyId)));
  if (!b) throw new DomainError('nao_encontrado', 'Orçamento inexistente', 404);
  return b;
}
const draftOnly = (b: { status: string }) => { if (b.status !== 'draft') throw new DomainError('aprovado', 'O orçamento está aprovado — reabra-o para alterar', 409); };

async function saveCells(db: Db, budgetId: string, companyId: string, cells: BudgetCell[]) {
  await db.delete(personnelBudgetLines).where(eq(personnelBudgetLines.budgetId, budgetId));
  if (cells.length) {
    await db.insert(personnelBudgetLines).values(cells.map((c) => ({ budgetId, companyId, departmentId: c.departmentId, period: c.period, headcount: String(c.headcount), grossMinor: c.grossMinor, costMinor: c.costMinor })));
  }
}

const toCell = (l: typeof personnelBudgetLines.$inferSelect): BudgetCell => ({ period: l.period, departmentId: l.departmentId, headcount: Number(l.headcount), grossMinor: l.grossMinor, costMinor: l.costMinor });

export function budgetRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/budgets', requireCompany);
  app.use('/v1/budgets/*', requireCompany);
  const EDIT = ['hr_admin', 'finance'] as const;

  /** Orçamento do ano (ou nada), comparação com o real e hipóteses por omissão. */
  app.get('/v1/budgets', requireRole('hr_admin', 'finance', 'payroll'), async (c) => {
    const actor = c.get('actor');
    const year = z.coerce.number().int().min(2024).max(2100).default(Number(luandaDate(new Date()).slice(0, 4))).parse(c.req.query('year') || undefined);
    const db = getDb();
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const deps = await db.select({ id: departments.id, name: departments.name, costCenter: departments.costCenter }).from(departments).where(eq(departments.companyId, actor.companyId)).orderBy(asc(departments.name));
    const [b] = await db.select().from(personnelBudgets).where(and(eq(personnelBudgets.companyId, actor.companyId), eq(personnelBudgets.year, year)));
    const years = (await db.select({ year: personnelBudgets.year }).from(personnelBudgets).where(eq(personnelBudgets.companyId, actor.companyId))).map((x) => x.year);
    const defaults: BudgetAssumptions = { year, increaseBps: 0, increaseFrom: `${year}-01`, holidayMonth: co?.holidaySubsidyMonth ?? 12, christmasMonth: co?.christmasSubsidyMonth ?? 12, hires: [] };
    const actual = await actualCells(db, actor.companyId, year);
    if (!b) return c.json({ year, budget: null, departments: deps, defaults, years, closed: actual.closed });
    const lines = (await db.select().from(personnelBudgetLines).where(eq(personnelBudgetLines.budgetId, b.id))).map(toCell);
    return c.json({
      year, budget: b, lines, departments: deps, defaults, years, closed: actual.closed,
      comparison: budgetVsActual(lines, actual.cells, actual.closed, year),
    });
  });

  /** Simulação (não grava): impacto das hipóteses no custo do ano. */
  app.post('/v1/budgets/simulate', requireRole(...EDIT), async (c) => {
    const a = assumptionsSchema.parse(await body(c)) as BudgetAssumptions;
    const { cells, packVersion, staff } = await project(getDb(), c.get('actor').companyId, a);
    const months = Array.from({ length: 12 }, (_, i) => `${a.year}-${String(i + 1).padStart(2, '0')}`).map((p) => {
      const m = cells.filter((x) => x.period === p);
      return { period: p, costMinor: m.reduce((s, x) => s + x.costMinor, 0), headcount: Math.round(m.reduce((s, x) => s + x.headcount, 0) * 10) / 10 };
    });
    return c.json({ cells, months, totalMinor: months.reduce((s, m) => s + m.costMinor, 0), packVersion, staff });
  });

  app.post('/v1/budgets', requireRole(...EDIT), async (c) => {
    const actor = c.get('actor');
    const raw = await body(c) as { notes?: string };
    const a = assumptionsSchema.parse(raw) as BudgetAssumptions;
    const db = getDb();
    const [exists] = await db.select({ id: personnelBudgets.id }).from(personnelBudgets).where(and(eq(personnelBudgets.companyId, actor.companyId), eq(personnelBudgets.year, a.year)));
    if (exists) throw new DomainError('ja_existe', `Já existe orçamento para ${a.year}`, 409);
    const { cells } = await project(db, actor.companyId, a);
    const [b] = await db.insert(personnelBudgets).values({ companyId: actor.companyId, year: a.year, assumptions: a, notes: z.string().trim().max(500).nullish().parse(raw.notes) ?? null, createdBy: actor.actorId }).returning();
    await saveCells(db, b!.id, actor.companyId, cells);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'personnel_budget', entityId: b!.id, after: { year: a.year, total: cells.reduce((s, x) => s + x.costMinor, 0) } });
    return c.json(b, 201);
  });

  /** Recalcula com novas hipóteses (substitui os ajustes manuais). */
  app.post('/v1/budgets/:id/regenerate', requireRole(...EDIT), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    draftOnly(b);
    const a = assumptionsSchema.parse({ ...(await body(c) as object), year: b.year }) as BudgetAssumptions;
    const { cells } = await project(db, actor.companyId, a);
    await saveCells(db, b.id, actor.companyId, cells);
    await db.update(personnelBudgets).set({ assumptions: a, updatedAt: new Date() }).where(eq(personnelBudgets.id, b.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'regenerate', entity: 'personnel_budget', entityId: b.id, after: { total: cells.reduce((s, x) => s + x.costMinor, 0) } });
    return c.json({ ok: true });
  });

  /** Ajuste manual de células (custo e efectivo por mês e departamento). */
  app.put('/v1/budgets/:id/lines', requireRole(...EDIT), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    draftOnly(b);
    const { lines } = z.object({ lines: z.array(z.object({ departmentId: z.string().nullable(), period, costMinor: z.number().int().min(0).max(1e13), headcount: z.number().min(0).max(100_000).optional() })).max(2000) }).parse(await body(c));
    if (lines.some((l) => !l.period.startsWith(`${b.year}-`))) throw new DomainError('periodo', 'Meses fora do ano do orçamento', 400);
    const current = (await db.select().from(personnelBudgetLines).where(eq(personnelBudgetLines.budgetId, b.id))).map(toCell);
    const key = (x: { period: string; departmentId: string | null }) => `${x.period}|${x.departmentId ?? ''}`;
    const map = new Map(current.map((x) => [key(x), x]));
    for (const l of lines) {
      const prev = map.get(key(l));
      map.set(key(l), { period: l.period, departmentId: l.departmentId, costMinor: l.costMinor, headcount: l.headcount ?? prev?.headcount ?? 0, grossMinor: prev?.grossMinor ?? 0 });
    }
    await saveCells(db, b.id, actor.companyId, [...map.values()]);
    await db.update(personnelBudgets).set({ updatedAt: new Date() }).where(eq(personnelBudgets.id, b.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'adjust', entity: 'personnel_budget', entityId: b.id, after: { cells: lines.length } });
    return c.json({ ok: true });
  });

  /** Aprovação pelo proprietário (fixa o orçamento de referência do ano). */
  app.post('/v1/budgets/:id/approve', requireRole(), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    draftOnly(b);
    await db.update(personnelBudgets).set({ status: 'approved', approvedBy: actor.actorId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(personnelBudgets.id, b.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'approve', entity: 'personnel_budget', entityId: b.id });
    return c.json({ ok: true });
  });

  app.post('/v1/budgets/:id/reopen', requireRole(), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    if (b.status !== 'approved') throw new DomainError('estado', 'O orçamento já está em rascunho', 409);
    await db.update(personnelBudgets).set({ status: 'draft', approvedBy: null, approvedAt: null, updatedAt: new Date() }).where(eq(personnelBudgets.id, b.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'reopen', entity: 'personnel_budget', entityId: b.id });
    return c.json({ ok: true });
  });

  app.delete('/v1/budgets/:id', requireRole(...EDIT), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    draftOnly(b);
    await db.delete(personnelBudgets).where(eq(personnelBudgets.id, b.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'delete', entity: 'personnel_budget', entityId: b.id, before: { year: b.year } });
    return c.json({ ok: true });
  });

  /** Excel: orçado vs real por mês e por departamento, e a grelha do orçamento. */
  app.get('/v1/budgets/:id/export', requireRole('hr_admin', 'finance', 'payroll'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const b = await budgetOf(db, actor, c.req.param('id'));
    const lines = (await db.select().from(personnelBudgetLines).where(eq(personnelBudgetLines.budgetId, b.id))).map(toCell);
    const actual = await actualCells(db, actor.companyId, b.year);
    const cmp = budgetVsActual(lines, actual.cells, actual.closed, b.year);
    const deps = await db.select().from(departments).where(eq(departments.companyId, actor.companyId));
    const dname = (id: string | null) => deps.find((d) => d.id === id)?.name ?? 'Sem departamento';
    const kz = (m: number | null) => (m === null ? '' : Math.round(m) / 100);
    const months = cmp.months.map((m) => m.period);
    const deptIds = [...new Set(lines.map((l) => l.departmentId))];
    return xlsxResponse(xlsx([
      {
        name: 'Orçado vs real', header: true, widths: [12, 18, 18, 16, 10, 12, 12],
        rows: [
          ['Mês', 'Orçado', 'Real', 'Desvio', 'Desvio %', 'Efectivo orç.', 'Efectivo real'],
          ...cmp.months.map((m) => [m.period, kz(m.budgetMinor), kz(m.actualMinor), kz(m.varianceMinor), m.variancePct ?? '', m.budgetHeadcount, m.actualHeadcount ?? '']),
          ['Ano', kz(cmp.totals.budgetYearMinor), kz(cmp.totals.actualToDateMinor), kz(cmp.totals.varianceMinor), cmp.totals.variancePct ?? '', '', ''],
          ['Previsão de fecho', kz(cmp.totals.forecastMinor)],
        ],
      },
      {
        name: 'Departamentos', header: true, widths: [28, 18, 20, 18, 16, 10],
        rows: [
          ['Departamento', 'Orçado ano', 'Orçado meses fechados', 'Real meses fechados', 'Desvio', 'Desvio %'],
          ...cmp.departments.map((d) => [dname(d.departmentId), kz(d.budgetYearMinor), kz(d.budgetToDateMinor), kz(d.actualToDateMinor), kz(d.varianceMinor), d.variancePct ?? '']),
        ],
      },
      {
        name: 'Orçamento', header: true, widths: [28, ...months.map(() => 14), 16],
        rows: [
          ['Departamento', ...months, 'Total'],
          ...deptIds.map((id) => {
            const row = months.map((p) => lines.filter((l) => l.departmentId === id && l.period === p).reduce((s, l) => s + l.costMinor, 0));
            return [dname(id), ...row.map((v) => kz(v)), kz(row.reduce((s, v) => s + v, 0))];
          }),
        ],
      },
    ]), `orcamento-pessoal-${b.year}.xlsx`);
  });

  return app;
}
