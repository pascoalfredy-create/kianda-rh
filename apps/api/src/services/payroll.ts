import { groupBy } from '../lib/group-by.js';
import { createHash } from 'node:crypto';
import {
  allowanceAmount,
  convertUsdMinor,
  indexedBaseLabel,
  businessDays,
  calculatePayroll,
  fullMonthsBetween,
  monthlyDeductionCap,
  scheduledDays,
  scheduledMinutes,
  scheduleStats,
  type Schedule,
  compensationAt,
  DEFAULT_PGC_ACCOUNTS,
  getPack,
  labourRules,
  lastDayOfMonth,
  NegativeNetError,
  overtimeHoursFromMinutes,
  payrollJournal,
  yearServiceFraction,
  type EarningInput,
  type PayrollResult,
  type PayrollTotals,
  type PgcAccountMap,
} from '@kianda/core';
import {
  absences,
  accountMappings,
  allowanceTypes,
  and,
  asc,
  employeeAllowances,
  isNull,
  or,
  shiftAssignments,
  workSchedules,
  attendanceEntries,
  attendanceMonths,
  auditLogs,
  companies,
  compensationChanges,
  contracts,
  departments,
  employees,
  eq,
  gte,
  inArray,
  sql,
  journalEntries,
  journalLines,
  lte,
  ne,
  payrollLines,
  payrollRuns,
  payrollVariables,
  type Db,
} from '@kianda/db';
import { notifyEmployees } from './push.js';
import { eligiblePayrollStaff } from './payroll-roster.js';
import { payslipContexts } from './payslip-context.js';

/** Meses de doença pagos pela empresa (LGT, art. 226.º, n.º 1). */
export const SICK_PAID_MONTHS = 6;
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d!, last));
  return t.toISOString().slice(0, 10);
}
/** Ausências por doença seguidas (sem dias de intervalo) contam como um só período para o limite de 6 meses. */
export function sickChains(rows: { startDate: string; endDate: string }[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const r of [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const last = out.at(-1);
    const next = last ? new Date(Date.parse(`${last.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : '';
    if (last && r.startDate <= next) {
      if (r.endDate > last.to) last.to = r.endDate;
    } else out.push({ from: r.startDate, to: r.endDate });
  }
  return out;
}

/** Minutos de trabalho de um turno publicado (atravessa a meia-noite quando o fim é anterior ao início), sem o intervalo. */
export function shiftMinutes(start: string, end: string, breakMinutes = 0): number {
  const m = (t: string) => {
    const [h, mm] = t.split(':').map(Number);
    return h! * 60 + (mm ?? 0);
  };
  const span = m(end) - m(start);
  return Math.max(0, (span <= 0 ? span + 1440 : span) - breakMinutes);
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PayrollWarning {
  employeeId?: string;
  message: string;
}
export type SubsidyOverrides = Record<string, { holiday?: boolean; christmas?: boolean }>;

type Line = { code: string; kind: string; amountMinor: number };
const linesOf = (l: { breakdown: unknown }) => l.breakdown as Line[];
/** Rubrica do fecho de contas com o pressuposto do cálculo (ex.: «Férias não gozadas — 12 dia(s) úteis × base/22»). */
const withBasis = (v: { label: string }) => v.label;
const amountOf = (l: { breakdown: unknown }, code: string) =>
  linesOf(l)
    .filter(x => x.code === code)
    .reduce((s, x) => s + x.amountMinor, 0);

/**
 * Cria (ou recalcula) o processamento em rascunho do período para todos os colaboradores activos.
 * Inclui: remuneração em vigor no fim do mês, horas extra aprovadas, faltas injustificadas, variáveis do mês,
 * subsídios de férias e de Natal (automáticos, proporcionais no ano de admissão, nunca em duplicado).
 */
/** Câmbio USD→Kz do dia do processamento (salários indexados ao dólar). */
export interface PayrollFx {
  rate: number;
  date: string;
  source?: string | null;
}

type DraftStaff = Awaited<ReturnType<typeof eligiblePayrollStaff>>[number];
type DraftEmployee = DraftStaff['e'];
type DraftContext = Awaited<ReturnType<typeof loadDraftContext>>;
type WorkPattern = ReturnType<typeof workPattern>;
type Warn = (message: string) => void;
type AllowanceCut = { fraction: number; days: number };
type Range = { from: string; to: string };

/** Corta um intervalo ao mês do processamento. */
const clip = (ctx: DraftContext, from: string, to: string): Range => ({
  from: from < ctx.periodStart ? ctx.periodStart : from,
  to: to > ctx.periodEnd ? ctx.periodEnd : to,
});
const calendarDaysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Bloqueia e cria (ou reabre) o processamento do período, aplicando o câmbio do dia quando indicado. */
async function openDraftRun(
  tx: Db,
  companyId: string,
  period: string,
  actorId: string,
  packVersion: string,
  selected: Set<string> | null,
  fx?: PayrollFx,
) {
  // Também protege dois primeiros lotes concorrentes para um mês ainda sem folha.
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
  let [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period)))
    .for('update');
  if (run?.status === 'closed')
    throw new DomainError('processamento_fechado', 'O processamento deste período já está fechado');
  let preserves = false;
  if (run && selected) {
    const existing = await tx
      .select({ employeeId: payrollLines.employeeId })
      .from(payrollLines)
      .where(eq(payrollLines.runId, run.id));
    preserves = existing.some(l => !selected.has(l.employeeId));
    const fxChanged = fx && (Number(run.fxRate ?? 0) !== fx.rate || run.fxDate !== fx.date);
    if (preserves && (run.packVersion !== packVersion || fxChanged))
      throw new DomainError(
        'lote_requer_recalculo_total',
        'A alteração do câmbio ou das regras exige Recalcular toda a folha, para manter os colaboradores no mesmo enquadramento.',
        409,
      );
  }
  run ??= (
    await tx.insert(payrollRuns).values({ companyId, period, packVersion, preparedBy: actorId }).returning()
  )[0]!;
  if (fx)
    run = (
      await tx
        .update(payrollRuns)
        .set({ fxRate: String(fx.rate), fxDate: fx.date, fxSource: fx.source?.trim() || null })
        .where(eq(payrollRuns.id, run.id))
        .returning()
    )[0]!;
  return { run, preserves };
}

/** Ausências aprovadas da empresa de um tipo, que se sobrepõem a um intervalo. */
function approvedAbsences(
  tx: Db,
  companyId: string,
  types: (typeof absences.$inferSelect)['type'][],
  overlapFrom: string,
  overlapTo: string,
) {
  return tx
    .select()
    .from(absences)
    .where(
      and(
        eq(absences.companyId, companyId),
        inArray(absences.type, types),
        eq(absences.status, 'approved'),
        lte(absences.startDate, overlapTo),
        gte(absences.endDate, overlapFrom),
      ),
    );
}

/** Escala publicada do mês: quando existe, manda nos dias de trabalho (faltas e subsídios por dia); sem ela, vale o regime. */
async function publishedRoster(tx: Db, companyId: string, periodStart: string, periodEnd: string) {
  const byEmployee = new Map<string, Map<string, number>>();
  const rows = await tx
    .select({
      employeeId: shiftAssignments.employeeId,
      workDate: shiftAssignments.workDate,
      kind: shiftAssignments.pubKind,
      start: shiftAssignments.pubStartTime,
      end: shiftAssignments.pubEndTime,
      breakMinutes: shiftAssignments.pubBreakMinutes,
    })
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.companyId, companyId),
        gte(shiftAssignments.workDate, periodStart),
        lte(shiftAssignments.workDate, periodEnd),
        sql`${shiftAssignments.pubKind} is not null`,
      ),
    );
  for (const a of rows) {
    const days = byEmployee.get(a.employeeId) ?? new Map<string, number>();
    days.set(
      a.workDate,
      a.kind === 'shift' && a.start && a.end ? shiftMinutes(a.start, a.end, a.breakMinutes ?? 0) : 0,
    );
    byEmployee.set(a.employeeId, days);
  }
  return byEmployee;
}

/** Tudo o que o processamento do mês precisa de ler, agrupado por colaborador. */
async function loadDraftContext(tx: Db, companyId: string, period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const pack = getPack('AO', year);
  const periodStart = `${period}-01`;
  const periodEnd = lastDayOfMonth(period);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  const eligible = await eligiblePayrollStaff(tx, companyId, period);
  const publishedByEmployee = await publishedRoster(tx, companyId, periodStart, periodEnd);
  const costCenterOf = new Map(
    (
      await tx
        .select({ id: departments.id, cc: departments.costCenter })
        .from(departments)
        .where(eq(departments.companyId, companyId))
    ).map(d => [d.id, d.cc]),
  );
  const firstContract = new Map<string, string>();
  for (const r of await tx
    .select({ id: contracts.employeeId, d: contracts.startDate })
    .from(contracts)
    .innerJoin(employees, eq(employees.id, contracts.employeeId))
    .where(eq(employees.companyId, companyId))
    .orderBy(asc(contracts.startDate))) {
    if (!firstContract.has(r.id)) firstContract.set(r.id, r.d);
  }
  const comp = await tx.select().from(compensationChanges).where(eq(compensationChanges.companyId, companyId));
  const approvedMonths = await tx
    .select()
    .from(attendanceMonths)
    .where(and(eq(attendanceMonths.companyId, companyId), eq(attendanceMonths.period, period)));
  const unjustified = await approvedAbsences(tx, companyId, ['unjustified'], periodStart, periodEnd);
  const vacations = (await approvedAbsences(tx, companyId, ['vacation'], yearStart, '9999-12-31')).filter(
    a => a.startDate >= yearStart && a.startDate <= yearEnd,
  );
  // Licenças no mês: paternidade complementar, férias (alimentação/transporte), maternidade e licença sem remuneração.
  const monthLeaves = await approvedAbsences(
    tx,
    companyId,
    ['paternity', 'vacation', 'maternity', 'unpaid_leave'],
    periodStart,
    periodEnd,
  );
  // Doença: paga pela empresa até 6 meses seguidos; depois o contrato fica suspenso sem salário.
  const sickFrom = new Date(Date.parse(`${periodStart}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
  const sickLeaves = await approvedAbsences(tx, companyId, ['sick'], sickFrom, periodEnd);
  const maternityYear = new Set(
    (await approvedAbsences(tx, companyId, ['maternity'], yearStart, yearEnd)).map(r => r.employeeId),
  );
  const unjustifiedYear = await approvedAbsences(tx, companyId, ['unjustified'], yearStart, periodEnd);
  const withPunches = new Set(
    (
      await tx
        .select({ id: attendanceEntries.employeeId })
        .from(attendanceEntries)
        .where(
          and(
            eq(attendanceEntries.companyId, companyId),
            gte(attendanceEntries.workDate, periodStart),
            lte(attendanceEntries.workDate, periodEnd),
          ),
        )
    ).map(r => r.id),
  );
  const variables = await tx
    .select()
    .from(payrollVariables)
    .where(and(eq(payrollVariables.companyId, companyId), eq(payrollVariables.period, period)));
  // Regimes de horário e subsídios recorrentes em vigor no mês.
  const schedules = new Map(
    (await tx.select().from(workSchedules).where(eq(workSchedules.companyId, companyId))).map(s => [s.id, s]),
  );
  const assigned = await tx
    .select({ a: employeeAllowances, t: allowanceTypes })
    .from(employeeAllowances)
    .innerJoin(allowanceTypes, eq(allowanceTypes.id, employeeAllowances.typeId))
    .where(
      and(
        eq(employeeAllowances.companyId, companyId),
        lte(employeeAllowances.startDate, periodEnd),
        or(isNull(employeeAllowances.endDate), gte(employeeAllowances.endDate, periodStart)),
      ),
    )
    .orderBy(asc(allowanceTypes.code));
  // Subsídios já pagos noutros processamentos FECHADOS do mesmo ano.
  const paidThisYear = await tx
    .select({ employeeId: payrollLines.employeeId, breakdown: payrollLines.breakdown })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
    .where(
      and(
        eq(payrollRuns.companyId, companyId),
        eq(payrollRuns.status, 'closed'),
        gte(payrollRuns.period, `${year}-01`),
        lte(payrollRuns.period, `${year}-12`),
        ne(payrollRuns.period, period),
      ),
    );
  const paidByEmployee = groupBy(paidThisYear, x => x.employeeId);
  const companyWeek: Schedule = { kind: 'weekly', pattern: [...Array(5).fill(company?.workdayMinutes ?? 480), 0, 0] };
  return {
    companyId,
    period,
    year,
    month,
    pack,
    company,
    periodStart,
    periodEnd,
    eligible,
    publishedByEmployee,
    costCenterOf,
    firstContract,
    compByEmployee: groupBy(comp, x => x.employeeId),
    attendanceByEmployee: new Map(approvedMonths.map(a => [a.employeeId, a])),
    absencesByEmployee: groupBy(unjustified, x => x.employeeId),
    unjustifiedYearByEmployee: groupBy(unjustifiedYear, a => a.employeeId),
    leavesByEmployee: groupBy(monthLeaves, x => x.employeeId),
    vacationsByEmployee: groupBy(vacations, x => x.employeeId),
    sickByEmployee: groupBy(sickLeaves, x => x.employeeId),
    variablesByEmployee: groupBy(variables, x => x.employeeId),
    allowancesByEmployee: groupBy(assigned, x => x.a.employeeId),
    maternityYear,
    withPunches,
    schedules,
    companyWeek,
    holidaySet: new Set(labourRules('AO', year).holidays.map(h => h.date)),
    paid: (employeeId: string, code: string) => (paidByEmployee.get(employeeId) ?? []).some(p => amountOf(p, code) > 0),
  };
}

/** Regime de trabalho do colaborador (turnos publicados, ciclo ou horário da empresa) e contagens de dias e minutos. */
function workPattern(ctx: DraftContext, e: DraftEmployee) {
  const sched = e.scheduleId ? ctx.schedules.get(e.scheduleId) : undefined;
  const regime: Schedule = sched
    ? { kind: sched.kind as Schedule['kind'], pattern: sched.pattern, anchorDate: sched.anchorDate }
    : ctx.companyWeek;
  const weeklyMinutes = scheduleStats(regime, ctx.pack.labour.weeklyHours).avgWeeklyMinutes;
  const anchor = e.scheduleAnchor ?? sched?.anchorDate ?? null;
  const roster = ctx.publishedByEmployee.get(e.id);
  const minutesOn = (d: string) => (roster?.has(d) ? roster.get(d)! : scheduledMinutes(regime, d, anchor));
  const eachDay = function* (from: string, to: string) {
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) yield new Date(t).toISOString().slice(0, 10);
  };
  const daysIn = (from: string, to: string, exclude?: ReadonlySet<string>) => {
    if (!roster) return scheduledDays(regime, from, to, anchor, exclude);
    let n = 0;
    for (const d of eachDay(from, to)) if (!exclude?.has(d) && minutesOn(d) > 0) n++;
    return n;
  };
  /** Minutos de trabalho previstos no intervalo, sem feriados. */
  const minutesIn = (from: string, to: string) => {
    let m = 0;
    for (const d of eachDay(from, to)) if (!ctx.holidaySet.has(d)) m += minutesOn(d);
    return m;
  };
  const planned = !!sched || !!roster;
  /** Dias de trabalho no intervalo: pelo regime/escala quando existe, senão dias úteis. */
  const dayCount = (from: string, to: string) =>
    planned ? daysIn(from, to, ctx.holidaySet) : businessDays(from, to, [labourRules('AO', ctx.year)]);
  return {
    sched,
    anchor,
    normalWeeklyHours: weeklyMinutes > 0 ? weeklyMinutes / 60 : undefined,
    daysIn,
    minutesIn,
    dayCount,
  };
}

/** Horas extra, descanso, feriados e atrasos da assiduidade aprovada do mês. */
function attendanceFigures(ctx: DraftContext, e: DraftEmployee, warn: Warn) {
  const att = ctx.attendanceByEmployee.get(e.id);
  if (!att && ctx.withPunches.has(e.id))
    warn(`${e.name}: assiduidade de ${ctx.period} por aprovar — horas extra não incluídas`);
  if (!att) return { att, overtimeHours: 0, restDayHours: 0, holidayWorkDays: 0, latenessHours: 0 };
  // Extra em dias normais; descanso semanal e feriados à parte.
  const latenessHours =
    ctx.company?.discountLateness !== false && att.shortfallMinutes > 0
      ? Math.round((att.shortfallMinutes / 60) * 100) / 100
      : 0;
  return {
    att,
    overtimeHours: overtimeHoursFromMinutes(Math.max(0, att.approvedOvertimeMinutes - att.restHolidayOvertimeMinutes)),
    restDayHours: overtimeHoursFromMinutes(att.restDayPaidMinutes),
    holidayWorkDays: att.holidayWorkDays ?? 0,
    // Atrasos e saídas antecipadas aprovados no fecho do ponto: faltas em horas (regra da empresa).
    latenessHours,
  };
}

/** Faltas injustificadas do mês (dias e horas pelo regime) e aviso disciplinar. */
function unjustifiedFigures(ctx: DraftContext, e: DraftEmployee, wp: WorkPattern, warn: Warn) {
  const ranges = (ctx.absencesByEmployee.get(e.id) ?? []).map(a => clip(ctx, a.startDate, a.endDate));
  const absenceDays = sum(ranges.map(a => wp.dayCount(a.from, a.to)));
  const absenceHours = sum(ranges.map(a => wp.minutesIn(a.from, a.to))) / 60;
  const rules = [labourRules('AO', ctx.year)];
  const yearStart = `${ctx.year}-01-01`;
  const thisYear = sum(
    (ctx.unjustifiedYearByEmployee.get(e.id) ?? []).map(a =>
      businessDays(
        a.startDate < yearStart ? yearStart : a.startDate,
        a.endDate > ctx.periodEnd ? ctx.periodEnd : a.endDate,
        rules,
      ),
    ),
  );
  const disc = ctx.pack.labour.unjustifiedDisciplinary;
  if (absenceDays > disc.perMonth || thisYear > disc.perYear)
    warn(
      `${e.name}: ${absenceDays > disc.perMonth ? `${absenceDays} faltas injustificadas no mês` : `${thisYear} faltas injustificadas no ano`} — constitui infracção disciplinar`,
    );
  return { ranges, absenceDays, absenceHours };
}

/** Licenças do mês: paternidade não paga, doença além de 6 meses, licença sem remuneração e maternidade. */
function leaveFigures(ctx: DraftContext, e: DraftEmployee, wp: WorkPattern, warn: Warn) {
  const leaves = ctx.leavesByEmployee.get(e.id) ?? [];
  const ofType = (type: string) => leaves.filter(x => x.type === type);
  // Paternidade: 1 dia pago e o restante não remunerado.
  let paternityHours = 0;
  for (const a of ofType('paternity')) {
    const r = clip(ctx, a.startDate, a.endDate);
    let mins = wp.minutesIn(r.from, r.to);
    if (a.startDate >= ctx.periodStart)
      mins -= Math.min(mins, ctx.pack.leave.paternityPaidDays * ctx.pack.labour.dailyHours * 60); // dia pago
    paternityHours += mins / 60;
  }
  // Licença sem remuneração: os dias de calendário saem dos dias pagos (vencimento e subsídios proporcionais).
  let licenceDays = 0;
  for (const a of ofType('unpaid_leave')) {
    const r = clip(ctx, a.startDate, a.endDate);
    if (r.to >= r.from) licenceDays += calendarDaysIn(r.from, r.to);
  }
  let sickUnpaidHours = 0;
  for (const chain of sickChains(ctx.sickByEmployee.get(e.id) ?? [])) {
    const unpaidFrom = addMonths(chain.from, SICK_PAID_MONTHS);
    const from = unpaidFrom > ctx.periodStart ? unpaidFrom : ctx.periodStart;
    const to = chain.to < ctx.periodEnd ? chain.to : ctx.periodEnd;
    if (from > to) continue;
    sickUnpaidHours += wp.minutesIn(from, to) / 60;
    warn(
      `${e.name}: doença desde ${chain.from.split('-').reverse().join('/')} — passados 6 meses o contrato fica suspenso sem salário; os dias desde ${unpaidFrom.split('-').reverse().join('/')} foram descontados. O subsídio passa a ser pago pela segurança social.`,
    );
  }
  const unpaidLeaveHours = Math.round((paternityHours + sickUnpaidHours) * 100) / 100;
  const label = [
    unpaidLeaveHours - sickUnpaidHours > 0.001 ? 'licença de paternidade não remunerada' : '',
    sickUnpaidHours ? 'doença além de 6 meses (contrato suspenso)' : '',
  ]
    .filter(Boolean)
    .join(' e ');
  // Licença de maternidade: só se contam os dias (cálculo manual).
  const maternityDays = sum(
    ofType('maternity').map(a => {
      const r = clip(ctx, a.startDate, a.endDate);
      return calendarDaysIn(r.from, r.to);
    }),
  );
  return {
    unpaidLeaveHours,
    unpaidLeaveLabel: unpaidLeaveHours
      ? `${label.charAt(0).toUpperCase()}${label.slice(1)} (${unpaidLeaveHours} h)`
      : undefined,
    licenceDays,
    maternityDays,
  };
}

/** Alimentação e transporte não devidos nos dias de férias e (por regra da empresa) nos dias de falta. */
function allowanceCuts(ctx: DraftContext, e: DraftEmployee, wp: WorkPattern, absenceDays: number) {
  const monthDays = wp.dayCount(ctx.periodStart, ctx.periodEnd);
  let vacationAllowanceCut: AllowanceCut | undefined;
  let absenceAllowanceCut: AllowanceCut | undefined;
  if (!ctx.company?.allowancesOnVacation) {
    const vacDays = sum(
      (ctx.leavesByEmployee.get(e.id) ?? [])
        .filter(x => x.type === 'vacation')
        .map(a => {
          const r = clip(ctx, a.startDate, a.endDate);
          return wp.dayCount(r.from, r.to);
        }),
    );
    if (vacDays > 0 && monthDays > 0)
      vacationAllowanceCut = { fraction: Math.min(1, vacDays / monthDays), days: vacDays };
  }
  if (!ctx.company?.allowancesOnAbsence && absenceDays > 0 && monthDays > 0)
    absenceAllowanceCut = { fraction: Math.min(1, absenceDays / monthDays), days: absenceDays };
  return { vacationAllowanceCut, absenceAllowanceCut };
}

/** Variáveis do mês: prémios e outros abonos, adiantamentos e descontos (cada um com a sua rubrica). */
function monthVariables(ctx: DraftContext, e: DraftEmployee) {
  const mine = ctx.variablesByEmployee.get(e.id) ?? [];
  const deductions = mine.filter(v => v.kind === 'other_deduction' && v.code !== 'AVISODESC');
  const variableEarnings: EarningInput[] = mine
    .filter(v => v.kind === 'bonus' || v.kind === 'other_earning')
    .map(v => ({
      code: v.code ?? (v.kind === 'bonus' ? 'BONUS' : 'OUTABON'),
      name: withBasis(v),
      amountMinor: v.amountMinor,
      inInss: v.inInss,
      inIrt: v.inIrt,
    }));
  return {
    variableEarnings,
    otherDeductions: deductions.map(v => ({ name: withBasis(v), amountMinor: v.amountMinor })),
    advancesMinor: sum(mine.filter(v => v.kind === 'advance').map(v => v.amountMinor)),
    otherDeductionsMinor: sum(deductions.map(v => v.amountMinor)),
    noticeDeductionMinor: sum(
      mine.filter(v => v.kind === 'other_deduction' && v.code === 'AVISODESC').map(v => v.amountMinor),
    ),
    // Fecho de contas: os subsídios do ano vêm da cessação (já calculados), não do automático.
    settling: mine.some(v => v.terminationId),
  };
}

/** Mês incompleto (admissão ou cessação a meio do mês, licença sem remuneração): dias pagos. */
function workedPeriod(ctx: DraftContext, hire: string, ended: string | null, licenceDays: number) {
  const from = hire > ctx.periodStart ? hire : ctx.periodStart;
  const to = ended && ended < ctx.periodEnd ? ended : ctx.periodEnd;
  const fullMonth = from === ctx.periodStart && to === ctx.periodEnd;
  const calendarDays = Math.max(0, calendarDaysIn(from, to));
  const workedDays =
    fullMonth && !licenceDays
      ? undefined
      : Math.max(0, Math.min(calendarDays, fullMonth ? ctx.pack.labour.dailyRateDivisor : calendarDays) - licenceDays);
  return { from, to, workedDays };
}

/** Subsídios recorrentes: vigência ∩ contrato no mês; por dia = dias de escala menos faltas injustificadas. */
function recurringAllowances(
  ctx: DraftContext,
  e: DraftEmployee,
  wp: WorkPattern,
  span: Range,
  absenceRanges: Range[],
  baseMinor: number,
) {
  const out: EarningInput[] = [];
  for (const { a, t } of ctx.allowancesByEmployee.get(e.id) ?? []) {
    const aFrom = a.startDate > span.from ? a.startDate : span.from;
    const aTo = a.endDate && a.endDate < span.to ? a.endDate : span.to;
    if (aFrom > aTo) continue;
    let days = 0;
    if (t.calc === 'per_day') {
      days = wp.daysIn(aFrom, aTo);
      for (const ab of absenceRanges) {
        const f = ab.from > aFrom ? ab.from : aFrom;
        const l = ab.to < aTo ? ab.to : aTo;
        if (f <= l) days -= wp.daysIn(f, l, ctx.holidaySet);
      }
    }
    const full = aFrom === ctx.periodStart && aTo === ctx.periodEnd;
    const amount = allowanceAmount({
      calc: t.calc as 'fixed' | 'base_pct' | 'per_day',
      valueMinor: a.valueMinor ?? t.valueMinor,
      bps: a.bps ?? t.bps,
      baseMinor,
      activeDays: full ? undefined : calendarDaysIn(aFrom, aTo),
      scheduledDays: Math.max(0, days),
      dailyRateDivisor: ctx.pack.labour.dailyRateDivisor,
    });
    if (amount > 0)
      out.push({
        code: t.code,
        name: t.calc === 'per_day' ? `${t.label} (${days} dia(s))` : t.label,
        amountMinor: amount,
        inInss: t.inInss,
        inIrt: t.inIrt,
      });
  }
  return out;
}

/** Subsídios de férias e de Natal do mês: automáticos ou forçados, proporcionais, nunca em duplicado. */
function annualSubsidies(
  ctx: DraftContext,
  e: DraftEmployee,
  hire: string,
  ended: string | null,
  settling: boolean,
  override: { holiday?: boolean; christmas?: boolean },
  warn: Warn,
) {
  let holidaySubsidy: number | false = false;
  let christmasSubsidy: number | false = false;
  if (settling) return { holidaySubsidy, christmasSubsidy };
  // Férias: mês fixo da empresa, ou o mês das primeiras férias aprovadas do ano (Dezembro como último recurso).
  const firstVacation = (ctx.vacationsByEmployee.get(e.id) ?? []).map(v => v.startDate).sort()[0];
  const holidayAuto = ctx.company?.holidaySubsidyMonth
    ? ctx.month === ctx.company.holidaySubsidyMonth
    : (firstVacation ? firstVacation.slice(0, 7) === ctx.period : false) || ctx.month === 12;
  if (override.holiday ?? holidayAuto) {
    if (ctx.paid(e.id, 'SUBFER')) {
      if (override.holiday) warn(`${e.name}: subsídio de férias de ${ctx.year} já foi pago — não incluído`);
    } else {
      // Sem um ano de serviço, proporcional aos meses completos trabalhados (até ao pagamento).
      holidaySubsidy = Math.min(12, fullMonthsBetween(hire, ctx.periodEnd)) / 12 || false;
    }
  }
  // Natal: mês definido pela empresa; proporcional ao tempo de serviço no ano.
  if (override.christmas ?? ctx.month === (ctx.company?.christmasSubsidyMonth ?? 12)) {
    if (ctx.paid(e.id, 'SUBNAT')) {
      if (override.christmas) warn(`${e.name}: subsídio de Natal de ${ctx.year} já foi pago — não incluído`);
    } else {
      christmasSubsidy = yearServiceFraction(ctx.year, hire, ended) || false;
    }
  }
  return { holidaySubsidy, christmasSubsidy };
}

/** Casos sem regra fechada: o motor não calcula, avisa para lançamento manual nas variáveis. */
function manualCaseWarnings(
  ctx: DraftContext,
  e: DraftEmployee,
  facts: {
    maternityDays: number;
    holidayWorkDays: number;
    hasAttendance: boolean;
    cycle: boolean;
    subsidyPaid: boolean;
    net: number;
    credit: number;
    notice: number;
  },
  warn: Warn,
) {
  if (facts.maternityDays)
    warn(
      `${e.name}: ${facts.maternityDays} dia(s) de licença de maternidade em ${ctx.period} — CÁLCULO MANUAL: o salário está suspenso e o motor pagou o mês por inteiro; lance "Desconto na remuneração" com o valor a retirar (base, alimentação, transporte). Apure separadamente o subsídio de maternidade e o reembolso ao abrigo do regime aplicável à licença (DP n.º 95/26 para as licenças abrangidas pelo novo regime).`,
    );
  if (facts.holidayWorkDays)
    warn(
      `${e.name}: ${facts.holidayWorkDays} feriado(s) trabalhado(s) — CÁLCULO MANUAL do acréscimo por feriado trabalhado ("mais um dia de salário normal"): lance em "Outro abono"`,
    );
  if (ctx.period.endsWith('-12') && facts.hasAttendance && !facts.cycle)
    warn(
      `${e.name}: 24 e 31 de Dezembro com paragem às 12h30 — CÁLCULO MANUAL: horas trabalhadas depois das 12h30 não entram como extraordinárias; lance-as em "Outro abono" se forem devidas`,
    );
  if (ctx.maternityYear.has(e.id) && facts.subsidyPaid)
    warn(
      `${e.name}: subsídio pago num ano com licença de maternidade — a lei manda pagar proporcional aos meses completos de serviço efectivo; CÁLCULO MANUAL: confirme e ajuste o valor`,
    );
  // Descontos a crédito (adiantamentos e outros) até 25% do líquido.
  const cap = monthlyDeductionCap(facts.net + facts.credit + facts.notice, ctx.pack);
  if (facts.credit > cap)
    warn(
      `${e.name}: adiantamentos e outros descontos (${(facts.credit / 100).toLocaleString('pt-PT')} Kz) acima de 25% do salário líquido (${(cap / 100).toLocaleString('pt-PT')} Kz)`,
    );
}

type DraftRun = Awaited<ReturnType<typeof openDraftRun>>['run'];
type Pay = { baseMinor: number; mealMinor: number; transportMinor: number };

/** Calcula a linha de um colaborador: junta assiduidade, faltas, licenças, variáveis e subsídios e chama o motor. */
function draftEmployeeLine(
  ctx: DraftContext,
  run: DraftRun,
  item: { e: DraftEmployee; c: DraftStaff['c']; ended: string | null; pay: Pay; indexed: number | null },
  override: { holiday?: boolean; christmas?: boolean },
  warn: Warn,
) {
  const { e, c, ended, pay, indexed } = item;
  const fxRate = Number(run.fxRate);
  const hire = ctx.firstContract.get(e.id) ?? c.startDate;
  const attendance = attendanceFigures(ctx, e, warn);
  const wp = workPattern(ctx, e);
  if (wp.sched?.kind === 'cycle' && !wp.anchor)
    warn(
      `${e.name}: regime "${wp.sched.name}" sem data de início do ciclo — faltas e subsídios por dia não calculados`,
    );
  const absence = unjustifiedFigures(ctx, e, wp, warn);
  const leave = leaveFigures(ctx, e, wp, warn);
  const cuts = allowanceCuts(ctx, e, wp, absence.absenceDays);
  const vars = monthVariables(ctx, e);
  const worked = workedPeriod(ctx, hire, ended, leave.licenceDays);
  const allowances = recurringAllowances(ctx, e, wp, worked, absence.ranges, pay.baseMinor);
  const subsidies = annualSubsidies(ctx, e, hire, ended, vars.settling, override, warn);
  let r: PayrollResult;
  try {
    r = calculatePayroll({
      period: ctx.period,
      pack: ctx.pack,
      normalWeeklyHours: wp.normalWeeklyHours,
      baseMinor: pay.baseMinor,
      baseLabel: indexed ? indexedBaseLabel(indexed, fxRate) : undefined,
      mealMinor: pay.mealMinor,
      transportMinor: pay.transportMinor,
      overtimeHours: attendance.overtimeHours,
      absenceDays: absence.absenceDays,
      absenceHours: absence.absenceHours,
      otherEarnings: [...allowances, ...vars.variableEarnings],
      advancesMinor: vars.advancesMinor,
      otherDeductionsMinor: vars.otherDeductionsMinor,
      otherDeductions: vars.otherDeductions,
      noticeDeductionMinor: vars.noticeDeductionMinor,
      holidaySubsidy: subsidies.holidaySubsidy,
      christmasSubsidy: subsidies.christmasSubsidy,
      workedDays: worked.workedDays,
      restDayHours: attendance.restDayHours,
      unpaidLeaveHours: leave.unpaidLeaveHours,
      unpaidLeaveLabel: leave.unpaidLeaveLabel,
      vacationAllowanceCut: cuts.vacationAllowanceCut,
      absenceAllowanceCut: cuts.absenceAllowanceCut,
      latenessHours: attendance.latenessHours,
    });
  } catch (err) {
    if (err instanceof NegativeNetError)
      throw new DomainError(
        'liquido_negativo',
        `${e.name}: os descontos (adiantamentos e outros) excedem o ilíquido do mês. Reduza ou reparta pelos meses seguintes.`,
        422,
      );
    throw err;
  }
  manualCaseWarnings(
    ctx,
    e,
    {
      maternityDays: leave.maternityDays,
      holidayWorkDays: attendance.holidayWorkDays,
      hasAttendance: !!attendance.att,
      cycle: wp.sched?.kind === 'cycle',
      subsidyPaid: !!(subsidies.holidaySubsidy || subsidies.christmasSubsidy),
      net: r.netMinor,
      credit: vars.advancesMinor + vars.otherDeductionsMinor,
      notice: vars.noticeDeductionMinor,
    },
    warn,
  );
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        company: ctx.companyId,
        period: ctx.period,
        packVersion: r.packVersion,
        employee: e.id,
        contract: c.id,
        department: e.departmentId,
        pay: {
          base: pay.baseMinor,
          meal: pay.mealMinor,
          transport: pay.transportMinor,
          ...(indexed ? { usd: indexed, fx: run.fxRate, fxDate: run.fxDate } : {}),
        },
        lines: r.lines,
        net: r.netMinor,
      }),
    )
    .digest('hex');
  const line = {
    runId: run.id,
    employeeId: e.id,
    overtimeHours: String(attendance.overtimeHours),
    absenceDays: absence.absenceDays,
    bonusMinor: sum(vars.variableEarnings.map(x => x.amountMinor)),
    advancesMinor: vars.advancesMinor,
    grossMinor: r.grossMinor,
    inssBaseMinor: r.inssBaseMinor,
    irtTaxableMinor: r.irtTaxableMinor,
    inssEmployeeMinor: r.inssEmployeeMinor,
    irtMinor: r.irtMinor,
    netMinor: r.netMinor,
    inssEmployerMinor: r.inssEmployerMinor,
    irtBracket: r.irtBracket,
    breakdown: r.lines,
    calculationHash: hash,
    departmentId: e.departmentId,
    costCenter: e.departmentId ? (ctx.costCenterOf.get(e.departmentId) ?? null) : null,
  } satisfies typeof payrollLines.$inferInsert;
  return { line, r };
}

/** Grava as linhas (até 200 por escrita), preservando os IDs dos recibos no recálculo. */
async function writeDraftLines(tx: Db, lines: (typeof payrollLines.$inferInsert)[]) {
  for (let i = 0; i < lines.length; i += 200) {
    await tx
      .insert(payrollLines)
      .values(lines.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [payrollLines.runId, payrollLines.employeeId],
        set: {
          overtimeHours: sql`excluded.overtime_hours`,
          absenceDays: sql`excluded.absence_days`,
          bonusMinor: sql`excluded.bonus_minor`,
          advancesMinor: sql`excluded.advances_minor`,
          grossMinor: sql`excluded.gross_minor`,
          inssBaseMinor: sql`excluded.inss_base_minor`,
          irtTaxableMinor: sql`excluded.irt_taxable_minor`,
          inssEmployeeMinor: sql`excluded.inss_employee_minor`,
          irtMinor: sql`excluded.irt_minor`,
          netMinor: sql`excluded.net_minor`,
          inssEmployerMinor: sql`excluded.inss_employer_minor`,
          irtBracket: sql`excluded.irt_bracket`,
          breakdown: sql`excluded.breakdown`,
          calculationHash: sql`excluded.calculation_hash`,
          departmentId: sql`excluded.department_id`,
          costCenter: sql`excluded.cost_center`,
        },
      });
  }
}

/** Regra de retenção (IRT Grupo A) registada no processamento, para reprodução futura. */
function withholdingRuleOf(pack: DraftContext['pack']) {
  return {
    tax: 'IRT' as const,
    group: 'A' as const,
    packVersion: pack.version,
    allowanceExemptionMinor: pack.irt.allowanceExemptionMinor,
    brackets: pack.irt.brackets.map(([upper, fixed, rateBps, excessFrom]): [number | null, number, number, number] => [
      Number.isFinite(upper) ? upper : null,
      fixed,
      rateBps,
      excessFrom,
    ]),
  };
}

export async function draftPayroll(
  db: Db,
  companyId: string,
  period: string,
  actorId: string,
  fx?: PayrollFx,
  employeeIds?: string[],
) {
  if (!periodRe.test(period)) throw new DomainError('periodo_invalido', 'Período inválido (AAAA-MM)', 400);
  const pack = getPack('AO', Number(period.slice(0, 4)));
  if (
    employeeIds &&
    (!employeeIds.length || employeeIds.length > 1000 || new Set(employeeIds).size !== employeeIds.length)
  )
    throw new DomainError('lote_invalido', 'Seleccione entre 1 e 1.000 colaboradores, sem duplicados.', 400);
  const selected = employeeIds ? new Set(employeeIds) : null;
  return db.transaction(async tx => {
    const opened = await openDraftRun(tx as unknown as Db, companyId, period, actorId, pack.version, selected, fx);
    let run = opened.run;
    const ctx = await loadDraftContext(tx as unknown as Db, companyId, period);
    if (selected && employeeIds!.some(id => !ctx.eligible.some(s => s.e.id === id)))
      throw new DomainError(
        'lote_colaboradores_invalidos',
        'O lote contém colaboradores de outra empresa, sem contrato elegível ou fora do mês. Nenhum salário foi processado.',
        400,
      );
    const staff = selected ? ctx.eligible.filter(s => selected.has(s.e.id)) : ctx.eligible;
    const fxRate = run.fxRate ? Number(run.fxRate) : null;
    const overrides = (run.subsidyOverrides ?? {}) as SubsidyOverrides;
    const warnings: PayrollWarning[] = [];
    const missingFx: string[] = [];
    const seen = new Set<string>();
    const results: { employeeId: string; r: PayrollResult }[] = [];
    const pendingLines: (typeof payrollLines.$inferInsert)[] = [];
    for (const { e, c } of staff) {
      if (seen.has(e.id)) continue;
      if (c.startDate > ctx.periodEnd) continue; // contrato futuro: usa o contrato anterior (se existir)
      seen.add(e.id);
      const ended = c.terminatedAt ?? c.endDate;
      if (ended && ended < ctx.periodStart) continue;
      const current = compensationAt(ctx.compByEmployee.get(e.id) ?? [], ctx.periodEnd) ?? c;
      // Salário indexado ao dólar: base em USD convertida ao câmbio do dia do processamento.
      const indexed = current.salaryCurrency === 'USD' && current.baseForeignMinor ? current.baseForeignMinor : null;
      if (indexed && !fxRate) {
        missingFx.push(e.name);
        continue;
      }
      const pay = indexed ? { ...current, baseMinor: convertUsdMinor(indexed, fxRate!) } : current;
      const warn: Warn = message => warnings.push({ employeeId: e.id, message });
      const { line, r } = draftEmployeeLine(ctx, run, { e, c, ended, pay, indexed }, overrides[e.id] ?? {}, warn);
      pendingLines.push(line);
      results.push({ employeeId: e.id, r });
    }
    if (missingFx.length)
      throw new DomainError(
        'cambio_em_falta',
        `Indique o câmbio USD→Kz do dia do processamento: ${missingFx.length} colaborador(es) com salário indexado ao dólar (${missingFx.slice(0, 5).join(', ')}${missingFx.length > 5 ? '…' : ''}).`,
        422,
      );
    await writeDraftLines(tx as unknown as Db, pendingLines);
    // Colaboradores que já não entram (cessados, suspensos) saem do rascunho.
    const stale = await tx
      .select({ id: payrollLines.id, employeeId: payrollLines.employeeId })
      .from(payrollLines)
      .where(eq(payrollLines.runId, run.id));
    const keepIds = new Set(results.map(x => x.employeeId));
    const remove = stale
      .filter(l => !keepIds.has(l.employeeId) && (!selected || selected.has(l.employeeId)))
      .map(l => l.id);
    if (remove.length) await tx.delete(payrollLines).where(inArray(payrollLines.id, remove));
    const allWarnings = selected
      ? [...(run.warnings as PayrollWarning[]).filter(w => !w.employeeId || !selected.has(w.employeeId)), ...warnings]
      : warnings;
    const withholdingRule: typeof run.withholdingRule = opened.preserves
      ? run.withholdingRule
      : withholdingRuleOf(pack);
    [run] = (await tx
      .update(payrollRuns)
      .set({ preparedBy: actorId, warnings: allWarnings, packVersion: pack.version, withholdingRule })
      .where(eq(payrollRuns.id, run.id))
      .returning()) as [typeof run];
    const totalLines = stale.length - remove.length;
    await tx.insert(auditLogs).values({
      companyId,
      actorId,
      action: selected ? 'draft_batch' : 'draft',
      entity: 'payroll_run',
      entityId: run.id,
      after: {
        period,
        employees: results.length,
        totalEmployees: totalLines,
        ...(selected ? { employeeIds } : {}),
        warnings: allWarnings.length,
      },
    });
    return { run, lines: results.length, totalLines, warnings: allWarnings };
  });
}

/** Contas PGC da empresa (parametrizadas), com as sugeridas por omissão. */
export async function companyAccounts(db: Db, companyId: string): Promise<PgcAccountMap> {
  const rows = await db.select().from(accountMappings).where(eq(accountMappings.companyId, companyId));
  const map: PgcAccountMap = { ...DEFAULT_PGC_ACCOUNTS };
  for (const r of rows) if (r.role in map) (map as unknown as Record<string, string>)[r.role] = r.account;
  return map;
}

/** Fecha o processamento: bloqueia alterações e gera o lançamento PGC (classe 7 contra 34/36). */
interface PayrollCheck {
  hashes: Map<string, string | null>;
  warnings: PayrollWarning[];
}
/** Sinal interno para desfazer o recálculo de verificação (savepoint) depois de ler os resultados. */
class PayrollProbe extends Error {
  constructor(readonly check: PayrollCheck) {
    super('verificação do rascunho');
  }
}
const MANUAL_WARNING = /CÁLCULO MANUAL/;
const warningKeys = (warnings: PayrollWarning[]) =>
  JSON.stringify([...new Set(warnings.map(w => [w.employeeId ?? '', w.message].join('\0')))].sort());

/**
 * Recalcula a folha dentro de um savepoint e devolve os hashes e os avisos, sem gravar nada.
 * Serve para recusar o fecho de um rascunho desactualizado (variáveis, salários, assiduidade, ausências,
 * subsídios ou regras alterados depois do último «Recalcular»).
 */
async function freshPayrollCheck(tx: Db, companyId: string, period: string, actorId: string): Promise<PayrollCheck> {
  try {
    await tx.transaction(async sp => {
      const { run, warnings } = await draftPayroll(sp as unknown as Db, companyId, period, actorId);
      const rows = await sp
        .select({ employeeId: payrollLines.employeeId, hash: payrollLines.calculationHash })
        .from(payrollLines)
        .where(eq(payrollLines.runId, run.id));
      throw new PayrollProbe({ hashes: new Map(rows.map(r => [r.employeeId, r.hash])), warnings });
    });
  } catch (error) {
    if (error instanceof PayrollProbe) return error.check;
    if (error instanceof DomainError)
      throw new DomainError(
        'rascunho_desactualizado',
        `A folha já não pode ser recalculada com os dados actuais: ${error.message} Corrija e recalcule antes de fechar.`,
        409,
      );
    throw error;
  }
  throw new Error('Verificação do rascunho sem resultado');
}

export interface ClosePayrollOptions {
  manualReview?: string;
}

export async function closePayroll(
  db: Db,
  companyId: string,
  runId: string,
  actorId: string,
  role = 'owner',
  options: ClosePayrollOptions = {},
) {
  return db.transaction(async tx => {
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId)))
      .for('update');
    if (!run) throw new DomainError('nao_encontrado', 'Processamento inexistente', 404);
    if (run.status === 'closed') throw new DomainError('processamento_fechado', 'Já está fechado');
    // Segregação de funções: quem prepara não fecha (excepto o proprietário, em empresas pequenas).
    if (run.preparedBy === actorId && role !== 'owner')
      throw new DomainError(
        'segregacao_funcoes',
        'O processamento tem de ser fechado por uma pessoa diferente de quem o preparou',
        403,
      );
    const lines = await tx
      .select({ l: payrollLines, cc: departments.costCenter })
      .from(payrollLines)
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payrollLines.runId, run.id));
    if (!lines.length) throw new DomainError('sem_linhas', 'O processamento não tem colaboradores');
    const eligible = await eligiblePayrollStaff(tx as unknown as Db, companyId, run.period),
      valid = new Set(eligible.map(s => s.e.id));
    const included = new Set(lines.map(l => l.l.employeeId)),
      missing = eligible.filter(s => !included.has(s.e.id));
    if (missing.length)
      throw new DomainError(
        'processamento_incompleto',
        `Faltam ${missing.length} colaborador(es) por processar: ${missing
          .slice(0, 5)
          .map(s => s.e.name)
          .join(', ')}. Processe o lote em falta antes de fechar o mês.`,
        409,
      );
    if (lines.some(l => !valid.has(l.l.employeeId)))
      throw new DomainError(
        'equipa_alterada',
        'A elegibilidade da equipa mudou. Recalcule toda a folha antes de fechar o mês.',
        409,
      );
    const fresh = await freshPayrollCheck(tx as unknown as Db, companyId, run.period, actorId);
    const changed = lines.filter(l => !l.l.calculationHash || fresh.hashes.get(l.l.employeeId) !== l.l.calculationHash);
    if (changed.length || fresh.hashes.size !== lines.length) {
      const names = new Map(
        (
          await tx
            .select({ id: employees.id, name: employees.name })
            .from(employees)
            .where(
              inArray(
                employees.id,
                changed.slice(0, 5).map(l => l.l.employeeId),
              ),
            )
        ).map(e => [e.id, e.name]),
      );
      const who = changed
        .slice(0, 5)
        .map(l => names.get(l.l.employeeId) ?? l.l.employeeId)
        .join(', ');
      throw new DomainError(
        'rascunho_desactualizado',
        `Os dados mudaram depois do último cálculo${who ? ` (${changed.length} colaborador(es): ${who}${changed.length > 5 ? '…' : ''})` : ''}. Use «Recalcular» e confirme os valores antes de fechar o mês.`,
        409,
      );
    }
    if (warningKeys(fresh.warnings) !== warningKeys((run.warnings ?? []) as PayrollWarning[])) {
      throw new DomainError(
        'rascunho_desactualizado',
        'Os avisos da folha mudaram depois do último cálculo. Use «Recalcular» e reveja os avisos antes de fechar o mês.',
        409,
      );
    }
    // Avisos de cálculo manual: o fecho exige a confirmação escrita de quem fecha, que fica registada.
    const manual = fresh.warnings.filter(w => MANUAL_WARNING.test(w.message));
    const review = options.manualReview?.trim() ?? '';
    if (manual.length && review.length < 10)
      throw new DomainError(
        'revisao_calculo_manual',
        `Há ${manual.length} aviso(s) de CÁLCULO MANUAL neste mês. Confirme por escrito o que foi revisto e lançado (mínimo 10 caracteres) antes de fechar.`,
        409,
      );

    const byCc = new Map<string, PayrollTotals['byCostCenter'][number]>();
    const totals: PayrollTotals = {
      byCostCenter: [],
      irtMinor: 0,
      inssEmployeeMinor: 0,
      inssEmployerMinor: 0,
      advancesMinor: 0,
      otherDeductionsMinor: 0,
      netMinor: 0,
    };
    for (const { l, cc } of lines) {
      // Centro de custo do momento do cálculo (fotografia na linha); linhas antigas sem fotografia usam o actual.
      const key = l.costCenter ?? cc ?? 'SEM-CC';
      const t = byCc.get(key) ?? {
        costCenter: key,
        baseMinor: 0,
        allowancesMinor: 0,
        overtimeAndBonusMinor: 0,
        holidayChristmasMinor: 0,
        employerInssMinor: 0,
        terminationMinor: 0,
      };
      for (const item of linesOf(l)) {
        if (item.kind !== 'earning') continue;
        if (
          item.code === 'BASE' ||
          item.code === 'FALTAS' ||
          item.code === 'ATRASOS' ||
          item.code === 'LICNR' ||
          item.code === 'CORTE' ||
          item.code === 'SUSP' ||
          item.code === 'FERNG' ||
          item.code === 'FERPROP'
        )
          t.baseMinor += item.amountMinor;
        else if (item.code === 'SUBFER' || item.code === 'SUBNAT' || item.code === 'SUBFERPROP')
          t.holidayChristmasMinor += item.amountMinor;
        else if (item.code === 'COMP' || item.code === 'COMPEXC' || item.code === 'AVISO')
          t.terminationMinor = (t.terminationMinor ?? 0) + item.amountMinor;
        else if (
          item.code === 'HE' ||
          item.code === 'HEDESC' ||
          item.code === 'FERTRAB' ||
          item.code.startsWith('BONUS')
        )
          t.overtimeAndBonusMinor += item.amountMinor;
        else t.allowancesMinor += item.amountMinor;
      }
      t.employerInssMinor += l.inssEmployerMinor;
      byCc.set(key, t);
      totals.irtMinor += l.irtMinor;
      totals.inssEmployeeMinor += l.inssEmployeeMinor;
      totals.inssEmployerMinor += l.inssEmployerMinor;
      totals.advancesMinor += amountOf(l, 'ADIANT');
      totals.otherDeductionsMinor! += amountOf(l, 'OUTDESC');
      totals.noticeIncomeMinor = (totals.noticeIncomeMinor ?? 0) + amountOf(l, 'AVISODESC');
      totals.netMinor += l.netMinor;
    }
    totals.byCostCenter = [...byCc.values()];
    const entry = payrollJournal(run.period, totals, await companyAccounts(tx as unknown as Db, companyId));
    const [je] = await tx
      .insert(journalEntries)
      .values({
        companyId,
        date: entry.date,
        journal: entry.journal,
        reference: entry.reference,
        description: entry.description,
        source: 'payroll',
      })
      .returning();
    await tx.insert(journalLines).values(
      entry.lines.map(l => ({
        entryId: je!.id,
        account: l.account,
        description: l.description,
        costCenter: l.costCenter,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
      })),
    );
    const contexts = await payslipContexts(
      tx as unknown as Db,
      companyId,
      run.period,
      lines.map(x => x.l.employeeId),
    );
    const snapshots = lines.map(({ l }) => ({ id: l.id, context: contexts.get(l.employeeId)! }));
    await tx.execute(sql`update payroll_lines as l set payslip_context = snap.context
      from jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) as snap(id text, context jsonb)
      where l.id = snap.id and l.run_id = ${run.id}`);
    const [closed] = await tx
      .update(payrollRuns)
      .set({ status: 'closed', closedAt: new Date(), closedBy: actorId })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    await tx.insert(auditLogs).values({
      companyId,
      actorId,
      action: 'close',
      entity: 'payroll_run',
      entityId: run.id,
      before: run,
      after: {
        ...closed,
        ...(manual.length ? { manualReview: { note: review, warnings: manual.map(w => w.message) } } : {}),
      },
    });
    // Recibos disponíveis: aviso no telemóvel de cada colaborador processado (sem montantes no aviso).
    const month = new Date(`${run.period}-15T12:00:00Z`).toLocaleDateString('pt-PT', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Luanda',
    });
    await notifyEmployees(tx as unknown as Db, companyId, [...new Set(lines.map(x => x.l.employeeId))], {
      title: 'Recibo de vencimento disponível',
      body: `O seu recibo de ${month} já pode ser consultado.`,
      url: '/recibos',
      tag: `recibo-${run.period}`,
    });
    return { run: closed, journalReference: entry.reference, totals };
  });
}
