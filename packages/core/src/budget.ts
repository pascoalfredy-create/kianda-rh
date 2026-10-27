/**
 * Orçamento de pessoal: projecção do custo com pessoal (ilíquido + INSS da entidade empregadora) por mês e departamento,
 * a partir do quadro actual e de hipóteses (aumento salarial, admissões, meses dos subsídios), e comparação com o real.
 *
 * Simplificações assumidas (explicadas no ecrã): meses completos para quem está activo (proporcional só no mês de
 * entrada/saída, por dias/30); subsídios por dia = valor × dias úteis do mês; IRT não entra (é do trabalhador).
 */
import { applyBps, type Minor } from './money.js';
import { workingDaysInMonth } from './reports.js';

export interface BudgetAllowance { calc: 'fixed' | 'base_pct' | 'per_day'; valueMinor: Minor | null; bps: number | null; inInss: boolean; startDate: string; endDate: string | null }
export interface BudgetEmployee {
  id: string; departmentId: string | null; baseMinor: Minor; mealMinor: Minor; transportMinor: Minor; otherMinor: Minor;
  startDate: string; endDate: string | null; allowances: BudgetAllowance[];
}
export interface BudgetHire { departmentId: string | null; from: string; count: number; baseMinor: Minor; mealMinor: Minor; transportMinor: Minor; label?: string }
export interface BudgetAssumptions {
  year: number;
  /** Aumento do salário base (pontos base: 500 = 5%) a partir do mês indicado. */
  increaseBps: number; increaseFrom: string;
  hires: BudgetHire[];
  /** Mês (1–12) do subsídio de férias e do de Natal. */
  holidayMonth: number; christmasMonth: number;
}
export interface BudgetRules { holidayBps: number; christmasBps: number; employerInssBps: number; holidayInInss: boolean; christmasInInss: boolean; dailyRateDivisor: number }

export interface BudgetCell { period: string; departmentId: string | null; headcount: number; grossMinor: Minor; costMinor: Minor }

const periodsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const monthEnd = (p: string) => { const [y, m] = p.split('-').map(Number) as [number, number]; return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

/** Fracção do mês trabalhada (dias/30) para entradas e saídas a meio do mês. */
function activeFraction(p: string, start: string, end: string | null, divisor: number): number {
  const ms = `${p}-01`, me = monthEnd(p);
  if (start > me || (end && end < ms)) return 0;
  const from = start > ms ? Number(start.slice(8)) : 1;
  const to = end && end < me ? Number(end.slice(8)) : Number(me.slice(8));
  if (from === 1 && to === Number(me.slice(8))) return 1;
  return Math.min(divisor, to - from + 1) / divisor;
}
/** Meses completos de serviço no ano até ao fim do mês do subsídio (proporcional, art. 238.º). */
function subsidyFraction(year: number, month: number, start: string, end: string | null): number {
  const yStart = `${year}-01-01`;
  const s = start > yStart ? start : yStart;
  const pay = `${year}-${String(month).padStart(2, '0')}`;
  if (s > monthEnd(pay) || (end && end < `${pay}-01`)) return 0;
  if (s === yStart) return 1;
  const sm = Number(s.slice(5, 7)) + (s.slice(8) === '01' ? 0 : 1);
  return Math.max(0, Math.min(12, 13 - sm)) / 12;
}

export function budgetProjection(employees: BudgetEmployee[], a: BudgetAssumptions, r: BudgetRules): BudgetCell[] {
  const cells = new Map<string, BudgetCell>();
  const add = (period: string, departmentId: string | null, headcount: number, gross: number, inssBase: number) => {
    const k = `${period}|${departmentId ?? ''}`;
    const c = cells.get(k) ?? { period, departmentId, headcount: 0, grossMinor: 0, costMinor: 0 };
    c.headcount = Math.round((c.headcount + headcount) * 10) / 10;
    c.grossMinor += Math.round(gross);
    c.costMinor += Math.round(gross + applyBps(Math.max(0, Math.round(inssBase)), r.employerInssBps));
    cells.set(k, c);
  };
  const person = (e: BudgetEmployee, count: number, raise: boolean) => {
    for (const p of periodsOf(a.year)) {
      const f = activeFraction(p, e.startDate, e.endDate, r.dailyRateDivisor);
      if (!f) continue;
      const base = raise && p >= a.increaseFrom ? e.baseMinor + applyBps(e.baseMinor, a.increaseBps) : e.baseMinor;
      let gross = (base + e.mealMinor + e.transportMinor + e.otherMinor) * f;
      let inss = (base + e.otherMinor) * f;
      for (const al of e.allowances) {
        if (al.startDate > monthEnd(p) || (al.endDate && al.endDate < `${p}-01`)) continue;
        const v = al.calc === 'fixed' ? (al.valueMinor ?? 0) * f : al.calc === 'base_pct' ? applyBps(base, al.bps ?? 0) * f : (al.valueMinor ?? 0) * Math.round(workingDaysInMonth(p) * f);
        gross += v;
        if (al.inInss) inss += v;
      }
      const month = Number(p.slice(5));
      if (month === a.holidayMonth) {
        const v = applyBps(base, r.holidayBps) * subsidyFraction(a.year, month, e.startDate, e.endDate);
        gross += v; if (r.holidayInInss) inss += v;
      }
      if (month === a.christmasMonth) {
        const v = applyBps(base, r.christmasBps) * subsidyFraction(a.year, month, e.startDate, e.endDate);
        gross += v; if (r.christmasInInss) inss += v;
      }
      add(p, e.departmentId, f * count, gross * count, inss * count);
    }
  };
  for (const e of employees) person(e, 1, true);
  // Admissões: entram com o salário indicado na hipótese (sem o aumento geral).
  for (const h of a.hires) {
    if (h.count > 0) person({ id: 'hire', departmentId: h.departmentId, baseMinor: h.baseMinor, mealMinor: h.mealMinor, transportMinor: h.transportMinor, otherMinor: 0, startDate: `${h.from}-01`, endDate: null, allowances: [] }, h.count, false);
  }
  return [...cells.values()].sort((x, y) => (x.period === y.period ? (x.departmentId ?? '').localeCompare(y.departmentId ?? '') : x.period.localeCompare(y.period)));
}

// ───────────────────────── Orçado vs real ─────────────────────────

export interface ActualCell { period: string; departmentId: string | null; costMinor: Minor; headcount: number }
export interface BudgetComparison {
  months: { period: string; budgetMinor: Minor; actualMinor: Minor | null; varianceMinor: Minor | null; variancePct: number | null; budgetHeadcount: number; actualHeadcount: number | null }[];
  departments: { departmentId: string | null; budgetYearMinor: Minor; budgetToDateMinor: Minor; actualToDateMinor: Minor; varianceMinor: Minor; variancePct: number | null }[];
  totals: {
    budgetYearMinor: Minor; budgetToDateMinor: Minor; actualToDateMinor: Minor; varianceMinor: Minor; variancePct: number | null;
    /** Previsão de fecho: real dos meses fechados + orçado dos restantes. */
    forecastMinor: Minor; closedMonths: number;
  };
}

const vpct = (variance: number, budget: number) => (budget ? Math.round((variance / budget) * 10_000) / 100 : null);

/** Desvio = real − orçado (positivo = gastou mais do que o previsto). Só os meses com processamento fechado contam como real. */
export function budgetVsActual(budget: BudgetCell[], actual: ActualCell[], closedPeriods: string[], year: number): BudgetComparison {
  const closed = new Set(closedPeriods.filter((p) => p.startsWith(`${year}-`)));
  const months = periodsOf(year).map((period) => {
    const b = budget.filter((c) => c.period === period);
    const act = actual.filter((c) => c.period === period);
    const budgetMinor = b.reduce((s, c) => s + c.costMinor, 0);
    const isClosed = closed.has(period);
    const actualMinor = isClosed ? act.reduce((s, c) => s + c.costMinor, 0) : null;
    const varianceMinor = actualMinor === null ? null : actualMinor - budgetMinor;
    return {
      period, budgetMinor, actualMinor, varianceMinor, variancePct: varianceMinor === null ? null : vpct(varianceMinor, budgetMinor),
      budgetHeadcount: Math.round(b.reduce((s, c) => s + c.headcount, 0) * 10) / 10, actualHeadcount: isClosed ? act.reduce((s, c) => s + c.headcount, 0) : null,
    };
  });
  const deptIds = [...new Set([...budget.map((c) => c.departmentId), ...actual.filter((c) => closed.has(c.period)).map((c) => c.departmentId)])];
  const departments = deptIds.map((departmentId) => {
    const mine = (c: { departmentId: string | null }) => c.departmentId === departmentId;
    const budgetYearMinor = budget.filter(mine).reduce((s, c) => s + c.costMinor, 0);
    const budgetToDateMinor = budget.filter((c) => mine(c) && closed.has(c.period)).reduce((s, c) => s + c.costMinor, 0);
    const actualToDateMinor = actual.filter((c) => mine(c) && closed.has(c.period)).reduce((s, c) => s + c.costMinor, 0);
    return { departmentId, budgetYearMinor, budgetToDateMinor, actualToDateMinor, varianceMinor: actualToDateMinor - budgetToDateMinor, variancePct: vpct(actualToDateMinor - budgetToDateMinor, budgetToDateMinor) };
  }).sort((x, y) => y.budgetYearMinor - x.budgetYearMinor);
  const budgetYearMinor = months.reduce((s, m) => s + m.budgetMinor, 0);
  const budgetToDateMinor = months.filter((m) => m.actualMinor !== null).reduce((s, m) => s + m.budgetMinor, 0);
  const actualToDateMinor = months.reduce((s, m) => s + (m.actualMinor ?? 0), 0);
  const remaining = months.filter((m) => m.actualMinor === null).reduce((s, m) => s + m.budgetMinor, 0);
  return {
    months, departments,
    totals: {
      budgetYearMinor, budgetToDateMinor, actualToDateMinor, varianceMinor: actualToDateMinor - budgetToDateMinor,
      variancePct: vpct(actualToDateMinor - budgetToDateMinor, budgetToDateMinor), forecastMinor: actualToDateMinor + remaining, closedMonths: closed.size,
    },
  };
}
