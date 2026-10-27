/**
 * Relatórios de gestão de pessoas (custos, efectivo, rotatividade, absentismo, horas extra) a partir dos
 * processamentos fechados. Funções puras: a API junta os dados; aqui só se calcula.
 *
 * Definições (para o relatório ser comparável mês a mês):
 * - Custo com pessoal = remuneração ilíquida + INSS da entidade empregadora (8%). Não inclui despesas/ajudas de custo.
 * - Efectivo do mês = trabalhadores com recibo no processamento do mês.
 * - Rotatividade = saídas no período / efectivo médio.
 * - Absentismo = dias de ausência (faltas injustificadas + ausências aprovadas que não são férias, maternidade ou
 *   paternidade) / (efectivo × dias úteis do mês).
 */
import { angolaHolidays } from './holidays.js';
import type { Minor } from './money.js';

export type CostGroup = 'base' | 'allowances' | 'annual' | 'variable' | 'exit';
export const COST_GROUP_LABEL: Record<CostGroup, string> = {
  base: 'Vencimento base (líquido de faltas)',
  allowances: 'Subsídios e abonos mensais',
  annual: 'Subsídios de férias e de Natal',
  variable: 'Horas extra e prémios',
  exit: 'Cessações (compensações e férias)',
};

const BASE = new Set(['BASE', 'FALTAS', 'LICNR', 'SUSP', 'CORTE']);
const ANNUAL = new Set(['SUBFER', 'SUBFERPROP', 'SUBNAT']);
const VARIABLE = new Set(['HE', 'HEDESC', 'FERTRAB']);
const EXIT = new Set(['COMP', 'COMPEXC', 'AVISO', 'FERNG', 'FERPROP']);
export function costGroup(code: string): CostGroup {
  if (BASE.has(code)) return 'base';
  if (ANNUAL.has(code)) return 'annual';
  if (VARIABLE.has(code) || code.startsWith('BONUS')) return 'variable';
  if (EXIT.has(code)) return 'exit';
  return 'allowances';
}

/** Dias úteis do mês (segunda a sexta, sem feriados nacionais). */
export function workingDaysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const holidays = new Set(angolaHolidays(y).map((h) => h.date));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(date)) n++;
  }
  return n;
}

/** Tipos de ausência que contam para o absentismo (não contam férias nem licenças parentais). */
export const ABSENTEEISM_TYPES = new Set(['sick', 'justified', 'unjustified', 'marriage', 'bereavement', 'training']);

export interface ReportLine {
  period: string; employeeId: string; grossMinor: Minor; inssEmployerMinor: Minor; overtimeHours: number; absenceDays: number;
  breakdown: { code: string; kind: string; amountMinor: number }[];
}
export interface ReportInput {
  periods: string[];
  lines: ReportLine[];
  employees: { id: string; departmentId: string | null; hireDate: string | null; exitDate: string | null }[];
  departments: { id: string; name: string; costCenter: string }[];
  /** Dias úteis de ausência (aprovada, tipos de ABSENTEEISM_TYPES) por mês e trabalhador, já repartidos pelo mês. */
  leaveDays: { period: string; employeeId: string; days: number }[];
}

export interface MonthReport {
  period: string; headcount: number; hires: number; exits: number;
  grossMinor: Minor; employerInssMinor: Minor; costMinor: Minor; groups: Record<CostGroup, Minor>;
  overtimeHours: number; overtimeMinor: Minor; absenceDays: number; workingDays: number; absenteeismPct: number;
}
export interface DepartmentReport {
  id: string | null; name: string; costCenter: string; headcount: number; costMinor: Minor; avgMonthlyCostMinor: Minor;
  overtimeMinor: Minor; absenceDays: number; sharePct: number;
}
export interface PeopleReport {
  from: string; to: string; months: MonthReport[]; departments: DepartmentReport[];
  totals: {
    costMinor: Minor; grossMinor: Minor; employerInssMinor: Minor; groups: Record<CostGroup, Minor>;
    headcountEnd: number; avgHeadcount: number; hires: number; exits: number; turnoverPct: number;
    avgMonthlyCostPerHeadMinor: Minor; overtimeHours: number; overtimeMinor: Minor; overtimeSharePct: number; absenteeismPct: number;
  };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 100 : 0);
const emptyGroups = (): Record<CostGroup, Minor> => ({ base: 0, allowances: 0, annual: 0, variable: 0, exit: 0 });

export function peopleReport(input: ReportInput): PeopleReport {
  const periods = [...input.periods].sort();
  const deptOf = new Map(input.employees.map((e) => [e.id, e.departmentId]));
  const months: MonthReport[] = periods.map((period) => {
    const lines = input.lines.filter((l) => l.period === period);
    const groups = emptyGroups();
    let overtimeMinor = 0;
    for (const l of lines) for (const b of l.breakdown) {
      if (b.kind !== 'earning') continue;
      const g = costGroup(b.code);
      groups[g] += b.amountMinor;
      if (g === 'variable' && !b.code.startsWith('BONUS')) overtimeMinor += b.amountMinor;
    }
    const grossMinor = lines.reduce((s, l) => s + l.grossMinor, 0);
    const employerInssMinor = lines.reduce((s, l) => s + l.inssEmployerMinor, 0);
    const headcount = new Set(lines.map((l) => l.employeeId)).size;
    const workingDays = workingDaysInMonth(period);
    const absenceDays = lines.reduce((s, l) => s + l.absenceDays, 0) + input.leaveDays.filter((d) => d.period === period).reduce((s, d) => s + d.days, 0);
    return {
      period, headcount, grossMinor, employerInssMinor, costMinor: grossMinor + employerInssMinor, groups,
      hires: input.employees.filter((e) => e.hireDate?.startsWith(period)).length,
      exits: input.employees.filter((e) => e.exitDate?.startsWith(period)).length,
      overtimeHours: Math.round(lines.reduce((s, l) => s + l.overtimeHours, 0) * 100) / 100, overtimeMinor,
      absenceDays: Math.round(absenceDays * 10) / 10, workingDays, absenteeismPct: pct(absenceDays, headcount * workingDays),
    };
  });

  const sum = <K extends keyof MonthReport>(k: K) => months.reduce((s, m) => s + (m[k] as number), 0);
  const costMinor = sum('costMinor');
  const headMonths = sum('headcount');
  const avgHeadcount = months.length ? Math.round((headMonths / months.length) * 10) / 10 : 0;
  const lastPeriod = periods[periods.length - 1];
  const groups = emptyGroups();
  for (const m of months) for (const g of Object.keys(groups) as CostGroup[]) groups[g] += m.groups[g];

  // Por departamento (departamento actual da ficha).
  const deptRows = new Map<string | null, { cost: number; headMonths: number; head: Set<string>; overtime: number; absence: number }>();
  const row = (id: string | null) => deptRows.get(id) ?? (deptRows.set(id, { cost: 0, headMonths: 0, head: new Set(), overtime: 0, absence: 0 }), deptRows.get(id)!);
  for (const l of input.lines) {
    if (!periods.includes(l.period)) continue;
    const r = row(deptOf.get(l.employeeId) ?? null);
    r.cost += l.grossMinor + l.inssEmployerMinor;
    r.headMonths += 1;
    if (l.period === lastPeriod) r.head.add(l.employeeId);
    r.overtime += l.breakdown.filter((b) => b.kind === 'earning' && VARIABLE.has(b.code)).reduce((s, b) => s + b.amountMinor, 0);
    r.absence += l.absenceDays;
  }
  for (const d of input.leaveDays) if (periods.includes(d.period)) row(deptOf.get(d.employeeId) ?? null).absence += d.days;
  const departments: DepartmentReport[] = [...deptRows.entries()].map(([id, r]) => {
    const dep = input.departments.find((d) => d.id === id);
    return {
      id, name: dep?.name ?? 'Sem departamento', costCenter: dep?.costCenter ?? '—', headcount: r.head.size, costMinor: r.cost,
      avgMonthlyCostMinor: r.headMonths ? Math.round(r.cost / r.headMonths) : 0, overtimeMinor: r.overtime,
      absenceDays: Math.round(r.absence * 10) / 10, sharePct: pct(r.cost, costMinor),
    };
  }).sort((a, b) => b.costMinor - a.costMinor);

  const overtimeMinor = sum('overtimeMinor');
  const grossMinor = sum('grossMinor');
  const exits = sum('exits');
  return {
    from: periods[0] ?? '', to: lastPeriod ?? '', months, departments,
    totals: {
      costMinor, grossMinor, employerInssMinor: sum('employerInssMinor'), groups,
      headcountEnd: months[months.length - 1]?.headcount ?? 0, avgHeadcount, hires: sum('hires'), exits,
      turnoverPct: pct(exits, avgHeadcount), avgMonthlyCostPerHeadMinor: headMonths ? Math.round(costMinor / headMonths) : 0,
      overtimeHours: Math.round(sum('overtimeHours') * 100) / 100, overtimeMinor, overtimeSharePct: pct(overtimeMinor, grossMinor),
      absenteeismPct: pct(sum('absenceDays'), months.reduce((s, m) => s + m.headcount * m.workingDays, 0)),
    },
  };
}

/** Reparte uma ausência pelos meses, em proporção dos dias de calendário (os dias úteis já vêm contados na ausência). */
export function splitAbsenceByMonth(a: { startDate: string; endDate: string; workingDays: number }): { period: string; days: number }[] {
  const start = Date.parse(`${a.startDate}T00:00:00Z`);
  const end = Date.parse(`${a.endDate}T00:00:00Z`);
  const total = Math.round((end - start) / 86_400_000) + 1;
  if (total <= 0 || !a.workingDays) return [];
  const byMonth = new Map<string, number>();
  for (let t = start; t <= end; t += 86_400_000) {
    const p = new Date(t).toISOString().slice(0, 7);
    byMonth.set(p, (byMonth.get(p) ?? 0) + 1);
  }
  return [...byMonth.entries()].map(([period, days]) => ({ period, days: Math.round((a.workingDays * days / total) * 10) / 10 }));
}
