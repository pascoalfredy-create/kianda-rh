import { groupBy } from '../lib/group-by.js';
import { createHash } from 'node:crypto';
import {
  allowanceAmount, convertUsdMinor, indexedBaseLabel, businessDays, calculatePayroll, fullMonthsBetween, monthlyDeductionCap, scheduledDays, scheduledMinutes, scheduleStats, type Schedule, compensationAt, DEFAULT_PGC_ACCOUNTS, getPack, labourRules, lastDayOfMonth, NegativeNetError, overtimeHoursFromMinutes,
  payrollJournal, yearServiceFraction, type EarningInput, type PayrollResult, type PayrollTotals, type PgcAccountMap,
} from '@kianda/core';
import {
  absences, accountMappings, allowanceTypes, and, asc, employeeAllowances, isNull, or, shiftAssignments, workSchedules, attendanceEntries, attendanceMonths, auditLogs, companies, compensationChanges, contracts, departments, desc, employees, eq,
  gte, inArray, sql, journalEntries, journalLines, lte, ne, payrollLines, payrollRuns, payrollVariables, type Db,
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
    if (last && r.startDate <= next) { if (r.endDate > last.to) last.to = r.endDate; }
    else out.push({ from: r.startDate, to: r.endDate });
  }
  return out;
}

/** Minutos de trabalho de um turno publicado (atravessa a meia-noite quando o fim é anterior ao início), sem o intervalo. */
export function shiftMinutes(start: string, end: string, breakMinutes = 0): number {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h! * 60 + (mm ?? 0); };
  const span = m(end) - m(start);
  return Math.max(0, (span <= 0 ? span + 1440 : span) - breakMinutes);
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PayrollWarning { employeeId?: string; message: string }
export type SubsidyOverrides = Record<string, { holiday?: boolean; christmas?: boolean }>;

type Line = { code: string; kind: string; amountMinor: number };
const linesOf = (l: { breakdown: unknown }) => l.breakdown as Line[];
/** Rubrica do fecho de contas com o pressuposto do cálculo (ex.: «Férias não gozadas — 12 dia(s) úteis × base/22»). */
const withBasis = (v: { label: string }) => v.label;
const amountOf = (l: { breakdown: unknown }, code: string) => linesOf(l).filter((x) => x.code === code).reduce((s, x) => s + x.amountMinor, 0);

/**
 * Cria (ou recalcula) o processamento em rascunho do período para todos os colaboradores activos.
 * Inclui: remuneração em vigor no fim do mês, horas extra aprovadas, faltas injustificadas, variáveis do mês,
 * subsídios de férias e de Natal (automáticos, proporcionais no ano de admissão, nunca em duplicado).
 */
/** Câmbio USD→Kz do dia do processamento (salários indexados ao dólar). */
export interface PayrollFx { rate: number; date: string; source?: string | null }

export async function draftPayroll(db: Db, companyId: string, period: string, actorId: string, fx?: PayrollFx, employeeIds?: string[]) {
  if (!periodRe.test(period)) throw new DomainError('periodo_invalido', 'Período inválido (AAAA-MM)', 400);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const pack = getPack('AO', year);
  if (employeeIds && (!employeeIds.length || employeeIds.length > 1000 || new Set(employeeIds).size !== employeeIds.length)) throw new DomainError('lote_invalido', 'Seleccione entre 1 e 1.000 colaboradores, sem duplicados.', 400);
  return db.transaction(async (tx) => {
    // Também protege dois primeiros lotes concorrentes para um mês ainda sem folha.
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
    let [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period))).for('update');
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento deste período já está fechado');
    const selected = employeeIds ? new Set(employeeIds) : null;
    let preserves = false;
    if (run && selected) {
      const existing = await tx.select({ employeeId: payrollLines.employeeId }).from(payrollLines).where(eq(payrollLines.runId, run.id));
      preserves = existing.some(l => !selected.has(l.employeeId));
      if (preserves && (run.packVersion !== pack.version || (fx && (Number(run.fxRate ?? 0) !== fx.rate || run.fxDate !== fx.date)))) throw new DomainError('lote_requer_recalculo_total', 'A alteração do câmbio ou das regras exige Recalcular toda a folha, para manter os colaboradores no mesmo enquadramento.', 409);
    }
    run ??= (await tx.insert(payrollRuns).values({ companyId, period, packVersion: pack.version, preparedBy: actorId }).returning())[0]!;
    if (fx) run = (await tx.update(payrollRuns).set({ fxRate: String(fx.rate), fxDate: fx.date, fxSource: fx.source?.trim() || null }).where(eq(payrollRuns.id, run.id)).returning())[0]!;
    const fxRate = run.fxRate ? Number(run.fxRate) : null;
    const missingFx: string[] = [];
    const overrides = (run.subsidyOverrides ?? {}) as SubsidyOverrides;
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));

    const periodStart = `${period}-01`;
    const periodEnd = lastDayOfMonth(period);
    const eligible = await eligiblePayrollStaff(tx as unknown as Db, companyId, period);
    // Escala publicada do mês: quando existe, manda nos dias de trabalho (faltas e subsídios por dia); sem ela, vale o regime.
    const publishedByEmployee = new Map<string, Map<string, number>>();
    for (const a of await tx.select({ employeeId: shiftAssignments.employeeId, workDate: shiftAssignments.workDate, kind: shiftAssignments.pubKind, start: shiftAssignments.pubStartTime, end: shiftAssignments.pubEndTime, breakMinutes: shiftAssignments.pubBreakMinutes })
      .from(shiftAssignments).where(and(eq(shiftAssignments.companyId, companyId), gte(shiftAssignments.workDate, `${period}-01`), lte(shiftAssignments.workDate, lastDayOfMonth(period)), sql`${shiftAssignments.pubKind} is not null`))) {
      const days = publishedByEmployee.get(a.employeeId) ?? new Map<string, number>();
      days.set(a.workDate, a.kind === 'shift' && a.start && a.end ? shiftMinutes(a.start, a.end, a.breakMinutes ?? 0) : 0);
      publishedByEmployee.set(a.employeeId, days);
    }
    const costCenterOf = new Map((await tx.select({ id: departments.id, cc: departments.costCenter }).from(departments).where(eq(departments.companyId, companyId))).map(d => [d.id, d.cc]));
    if (selected && employeeIds!.some(id => !eligible.some(s => s.e.id === id))) throw new DomainError('lote_colaboradores_invalidos', 'O lote contém colaboradores de outra empresa, sem contrato elegível ou fora do mês. Nenhum salário foi processado.', 400);
    const staff = selected ? eligible.filter(s => selected.has(s.e.id)) : eligible;
    const firstContract = new Map<string, string>();
    for (const r of await tx.select({ id: contracts.employeeId, d: contracts.startDate }).from(contracts)
      .innerJoin(employees, eq(employees.id, contracts.employeeId)).where(eq(employees.companyId, companyId)).orderBy(asc(contracts.startDate))) {
      if (!firstContract.has(r.id)) firstContract.set(r.id, r.d);
    }
    const comp = await tx.select().from(compensationChanges).where(eq(compensationChanges.companyId, companyId));
    const approvedMonths = await tx.select().from(attendanceMonths).where(and(eq(attendanceMonths.companyId, companyId), eq(attendanceMonths.period, period)));
    const unjustified = await tx.select().from(absences).where(and(
      eq(absences.companyId, companyId), eq(absences.type, 'unjustified'), eq(absences.status, 'approved'),
      lte(absences.startDate, periodEnd), gte(absences.endDate, periodStart),
    ));
    const vacations = await tx.select().from(absences).where(and(
      eq(absences.companyId, companyId), eq(absences.type, 'vacation'), eq(absences.status, 'approved'),
      gte(absences.startDate, `${year}-01-01`), lte(absences.startDate, `${year}-12-31`),
    ));
    // Licenças não remuneradas no mês (paternidade complementar, art. 218.º) e férias no mês (alimentação/transporte, art. 213.º).
    const monthLeaves = await tx.select().from(absences).where(and(
      eq(absences.companyId, companyId), inArray(absences.type, ['paternity', 'vacation', 'maternity', 'unpaid_leave']), eq(absences.status, 'approved'),
      lte(absences.startDate, periodEnd), gte(absences.endDate, periodStart),
    ));
    // Doença: paga pela empresa até 6 meses seguidos (art. 226.º, n.º 1); depois o contrato fica suspenso sem salário (art. 268.º, n.º 1).
    const sickFrom = new Date(Date.parse(`${periodStart}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
    const sickLeaves = await tx.select().from(absences).where(and(
      eq(absences.companyId, companyId), eq(absences.type, 'sick'), eq(absences.status, 'approved'),
      lte(absences.startDate, periodEnd), gte(absences.endDate, sickFrom),
    ));
    const maternityYear = new Set((await tx.select({ id: absences.employeeId }).from(absences).where(and(
      eq(absences.companyId, companyId), eq(absences.type, 'maternity'), eq(absences.status, 'approved'),
      lte(absences.startDate, `${year}-12-31`), gte(absences.endDate, `${year}-01-01`),
    ))).map((r) => r.id));
    const unjustifiedYear = await tx.select().from(absences).where(and(
      eq(absences.companyId, companyId), eq(absences.type, 'unjustified'), eq(absences.status, 'approved'),
      gte(absences.endDate, `${year}-01-01`), lte(absences.startDate, periodEnd),
    ));
    const withPunches = new Set((await tx.select({ id: attendanceEntries.employeeId }).from(attendanceEntries)
      .where(and(eq(attendanceEntries.companyId, companyId), gte(attendanceEntries.workDate, periodStart), lte(attendanceEntries.workDate, periodEnd)))).map((r) => r.id));
    const variables = await tx.select().from(payrollVariables).where(and(eq(payrollVariables.companyId, companyId), eq(payrollVariables.period, period)));
    // Regimes de horário e subsídios recorrentes em vigor no mês.
    const schedules = new Map((await tx.select().from(workSchedules).where(eq(workSchedules.companyId, companyId))).map((s) => [s.id, s]));
    const assigned = await tx.select({ a: employeeAllowances, t: allowanceTypes }).from(employeeAllowances)
      .innerJoin(allowanceTypes, eq(allowanceTypes.id, employeeAllowances.typeId))
      .where(and(eq(employeeAllowances.companyId, companyId), lte(employeeAllowances.startDate, periodEnd), or(isNull(employeeAllowances.endDate), gte(employeeAllowances.endDate, periodStart))))
      .orderBy(asc(allowanceTypes.code));
    const holidaySet = new Set(labourRules('AO', year).holidays.map((h) => h.date));
    const companyWeek: Schedule = { kind: 'weekly', pattern: [...Array(5).fill(company?.workdayMinutes ?? 480), 0, 0] };
    const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
    // Subsídios já pagos noutros processamentos FECHADOS do mesmo ano.
    const paidThisYear = await tx.select({ employeeId: payrollLines.employeeId, breakdown: payrollLines.breakdown }).from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
      .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, `${year}-01`), lte(payrollRuns.period, `${year}-12`), ne(payrollRuns.period, period)));
    const compByEmployee = groupBy(comp, x => x.employeeId), absencesByEmployee = groupBy(unjustified, x => x.employeeId);
    const leavesByEmployee = groupBy(monthLeaves, x => x.employeeId), vacationsByEmployee = groupBy(vacations, x => x.employeeId);
    const variablesByEmployee = groupBy(variables, x => x.employeeId), allowancesByEmployee = groupBy(assigned, x => x.a.employeeId);
    const unjustifiedYearByEmployee = groupBy(unjustifiedYear, a => a.employeeId);
    const attendanceByEmployee = new Map(approvedMonths.map(a => [a.employeeId, a])), paidByEmployee = groupBy(paidThisYear, x => x.employeeId);
    const paid = (employeeId: string, code: string) => (paidByEmployee.get(employeeId) ?? []).some(p => amountOf(p, code) > 0);

    const warnings: PayrollWarning[] = [];
    const seen = new Set<string>();
    const results: { employeeId: string; r: PayrollResult }[] = [];
    const keep: string[] = [];
    const pendingLines: (typeof payrollLines.$inferInsert)[] = [];
    for (const { e, c } of staff) {
      if (seen.has(e.id)) continue;
      if (c.startDate > periodEnd) continue; // contrato futuro: usa o contrato anterior (se existir)
      seen.add(e.id);
      const ended = c.terminatedAt ?? c.endDate;
      if (ended && ended < periodStart) continue;
      const current = compensationAt(compByEmployee.get(e.id) ?? [], periodEnd) ?? c;
      // Salário indexado ao dólar: base em USD convertida ao câmbio do dia do processamento.
      const indexed = current.salaryCurrency === 'USD' && current.baseForeignMinor ? current.baseForeignMinor : null;
      if (indexed && !fxRate) { missingFx.push(e.name); seen.add(e.id); continue; }
      const pay = indexed ? { ...current, baseMinor: convertUsdMinor(indexed, fxRate!) } : current;
      const baseLabel = indexed ? indexedBaseLabel(indexed, fxRate!) : undefined;
      const hire = firstContract.get(e.id) ?? c.startDate;

      // Assiduidade e faltas
      const att = attendanceByEmployee.get(e.id);
      if (!att && withPunches.has(e.id)) warnings.push({ employeeId: e.id, message: `${e.name}: assiduidade de ${period} por aprovar — horas extra não incluídas` });
      // Extra em dias normais (+50%/+75%); descanso semanal (+75%, mín. 3 h) e feriados (+1 dia) à parte — arts. 188.º, 194.º e 200.º.
      const overtimeHours = att ? overtimeHoursFromMinutes(Math.max(0, att.approvedOvertimeMinutes - att.restHolidayOvertimeMinutes)) : 0;
      const restDayHours = att ? overtimeHoursFromMinutes(att.restDayPaidMinutes) : 0;
      const holidayWorkDays = att?.holidayWorkDays ?? 0;
      // Atrasos e saídas antecipadas aprovados no fecho do ponto: faltas em horas (regra da empresa, como no Primavera).
      const latenessHours = att && company?.discountLateness !== false && att.shortfallMinutes > 0 ? Math.round((att.shortfallMinutes / 60) * 100) / 100 : 0;
      // Regime do colaborador (turnos/rotação) ou o horário normal da empresa.
      const sched = e.scheduleId ? schedules.get(e.scheduleId) : undefined;
      const regime: Schedule = sched ? { kind: sched.kind as Schedule['kind'], pattern: sched.pattern, anchorDate: sched.anchorDate } : companyWeek;
      const weeklyMinutes = scheduleStats(regime, pack.labour.weeklyHours).avgWeeklyMinutes;
      const normalWeeklyHours = weeklyMinutes > 0 ? weeklyMinutes / 60 : undefined;
      const anchor = e.scheduleAnchor ?? sched?.anchorDate ?? null;
      const roster = publishedByEmployee.get(e.id);
      const minutesOn = (d: string) => roster?.has(d) ? roster.get(d)! : scheduledMinutes(regime, d, anchor);
      const daysIn = (from: string, to: string, exclude?: ReadonlySet<string>) => {
        if (!roster) return scheduledDays(regime, from, to, anchor, exclude);
        let n = 0;
        for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) { const d = new Date(t).toISOString().slice(0, 10); if (!exclude?.has(d) && minutesOn(d) > 0) n++; }
        return n;
      };
      const planned = !!sched || !!roster;
      if (sched?.kind === 'cycle' && !anchor) warnings.push({ employeeId: e.id, message: `${e.name}: regime "${sched.name}" sem data de início do ciclo — faltas e subsídios por dia não calculados` });
      // Faltas injustificadas: dias de trabalho previstos (regime) dentro da falta, sem feriados.
      const myAbsences = (absencesByEmployee.get(e.id) ?? []).map((a) => ({ from: a.startDate < periodStart ? periodStart : a.startDate, to: a.endDate > periodEnd ? periodEnd : a.endDate }));
      const absenceDays = myAbsences.reduce((s, a) => s + (planned ? daysIn(a.from, a.to, holidaySet) : businessDays(a.from, a.to, [labourRules('AO', year)])), 0);
      // Horas de falta pelo horário normal ou pelos turnos publicados (arts. 237.º e 240.º).
      const minutesIn = (from: string, to: string) => {
        let m = 0;
        for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
          const d = new Date(t).toISOString().slice(0, 10);
          if (!holidaySet.has(d)) m += minutesOn(d);
        }
        return m;
      };
      const absenceHours = myAbsences.reduce((s, a) => s + minutesIn(a.from, a.to), 0) / 60;
      const unjustifiedThisMonth = absenceDays;
      const unjustifiedThisYear = (unjustifiedYearByEmployee.get(e.id) ?? []).reduce((s, a) => {
        const f = a.startDate < `${year}-01-01` ? `${year}-01-01` : a.startDate;
        const l = a.endDate > periodEnd ? periodEnd : a.endDate;
        return s + businessDays(f, l, [labourRules('AO', year)]);
      }, 0);
      const disc = pack.labour.unjustifiedDisciplinary;
      if (unjustifiedThisMonth > disc.perMonth || unjustifiedThisYear > disc.perYear) {
        warnings.push({ employeeId: e.id, message: `${e.name}: ${unjustifiedThisMonth > disc.perMonth ? `${unjustifiedThisMonth} faltas injustificadas no mês` : `${unjustifiedThisYear} faltas injustificadas no ano`} — constitui infracção disciplinar` });
      }
      // Paternidade: 1 dia pago e o restante não remunerado (art. 218.º).
      const workMinutesIn = minutesIn;
      let unpaidLeaveHours = 0;
      for (const a of (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'paternity')) {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        let mins = workMinutesIn(from, to);
        if (a.startDate >= periodStart) mins -= Math.min(mins, pack.leave.paternityPaidDays * pack.labour.dailyHours * 60); // dia pago
        unpaidLeaveHours += mins / 60;
      }
      // Licença sem remuneração (art. 216.º): os dias de calendário da licença saem dos dias pagos (vencimento e subsídios proporcionais).
      let licenceDays = 0;
      for (const a of (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'unpaid_leave')) {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        if (to >= from) licenceDays += Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      }
      let sickUnpaidHours = 0;
      for (const chain of sickChains(sickLeaves.filter((a) => a.employeeId === e.id))) {
        const unpaidFrom = addMonths(chain.from, SICK_PAID_MONTHS);
        const from = unpaidFrom > periodStart ? unpaidFrom : periodStart, to = chain.to < periodEnd ? chain.to : periodEnd;
        if (from > to) continue;
        sickUnpaidHours += workMinutesIn(from, to) / 60;
        warnings.push({ employeeId: e.id, message: `${e.name}: doença desde ${chain.from.split('-').reverse().join('/')} — passados 6 meses o contrato fica suspenso sem salário; os dias desde ${unpaidFrom.split('-').reverse().join('/')} foram descontados. O subsídio passa a ser pago pela segurança social.` });
      }
      unpaidLeaveHours = Math.round((unpaidLeaveHours + sickUnpaidHours) * 100) / 100;
      const unpaidLabel = [unpaidLeaveHours - sickUnpaidHours > 0.001 ? 'licença de paternidade não remunerada' : '', sickUnpaidHours ? 'doença além de 6 meses (contrato suspenso)' : ''].filter(Boolean).join(' e ');
      // Licença de maternidade: suspende o contrato e o salário (arts. 267.º, c) e 268.º) — cálculo manual, só se contam os dias.
      let maternityDays = 0;
      for (const a of (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'maternity')) {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        maternityDays += Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      }
      // Férias no mês: alimentação e transporte não são devidos nesses dias, salvo acordo (art. 213.º, n.º 2).
      let vacationAllowanceCut: { fraction: number; days: number } | undefined;
      let absenceAllowanceCut: { fraction: number; days: number } | undefined;
      const dayCount = (from: string, to: string) => (planned ? daysIn(from, to, holidaySet) : businessDays(from, to, [labourRules('AO', year)]));
      const monthDays = dayCount(periodStart, periodEnd);
      if (!company?.allowancesOnVacation) {
        const vacDays = (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'vacation').reduce((s, a) => s + dayCount(a.startDate < periodStart ? periodStart : a.startDate, a.endDate > periodEnd ? periodEnd : a.endDate), 0);
        if (vacDays > 0 && monthDays > 0) vacationAllowanceCut = { fraction: Math.min(1, vacDays / monthDays), days: vacDays };
      }
      // Faltas injustificadas: por regra da empresa (como no Primavera), alimentação e transporte só nos dias trabalhados.
      if (!company?.allowancesOnAbsence && absenceDays > 0 && monthDays > 0) absenceAllowanceCut = { fraction: Math.min(1, absenceDays / monthDays), days: absenceDays };

      // Variáveis do mês
      const mine = variablesByEmployee.get(e.id) ?? [];
      const variableEarnings: EarningInput[] = mine.filter((v) => v.kind === 'bonus' || v.kind === 'other_earning').map((v) => ({
        code: v.code ?? (v.kind === 'bonus' ? 'BONUS' : 'OUTABON'), name: withBasis(v), amountMinor: v.amountMinor, inInss: v.inInss, inIrt: v.inIrt,
      }));
      // Cada desconto com a sua rubrica (e a base de cálculo, no fecho de contas).
      const otherDeductions = mine.filter((v) => v.kind === 'other_deduction' && v.code !== 'AVISODESC').map((v) => ({ name: withBasis(v), amountMinor: v.amountMinor }));
      const advancesMinor = mine.filter((v) => v.kind === 'advance').reduce((s, v) => s + v.amountMinor, 0);
      const otherDeductionsMinor = mine.filter((v) => v.kind === 'other_deduction' && v.code !== 'AVISODESC').reduce((s, v) => s + v.amountMinor, 0);
      const noticeDeductionMinor = mine.filter((v) => v.kind === 'other_deduction' && v.code === 'AVISODESC').reduce((s, v) => s + v.amountMinor, 0);
      // Fecho de contas: os subsídios do ano vêm da cessação (já calculados e eventualmente ajustados), não do automático.
      const settling = mine.some((v) => v.terminationId);
      // Mês incompleto: admissão ou cessação a meio do mês.
      const from = hire > periodStart ? hire : periodStart;
      const to = ended && ended < periodEnd ? ended : periodEnd;
      const calendarDays = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
      const workedDays = from === periodStart && to === periodEnd && !licenceDays ? undefined : Math.max(0, Math.min(calendarDays, from === periodStart && to === periodEnd ? pack.labour.dailyRateDivisor : calendarDays) - licenceDays);

      // Subsídios recorrentes: vigência ∩ contrato no mês; por dia = dias de escala menos faltas injustificadas.
      const allowanceEarnings: EarningInput[] = [];
      for (const { a, t } of allowancesByEmployee.get(e.id) ?? []) {
        const aFrom = a.startDate > from ? a.startDate : from;
        const aTo = a.endDate && a.endDate < to ? a.endDate : to;
        if (aFrom > aTo) continue;
        const full = aFrom === periodStart && aTo === periodEnd;
        let days = 0;
        if (t.calc === 'per_day') {
          days = daysIn(aFrom, aTo);
          for (const ab of myAbsences) {
            const f = ab.from > aFrom ? ab.from : aFrom;
            const l = ab.to < aTo ? ab.to : aTo;
            if (f <= l) days -= daysIn(f, l, holidaySet);
          }
        }
        const amount = allowanceAmount({
          calc: t.calc as 'fixed' | 'base_pct' | 'per_day', valueMinor: a.valueMinor ?? t.valueMinor, bps: a.bps ?? t.bps, baseMinor: pay.baseMinor,
          activeDays: full ? undefined : dayDiff(aFrom, aTo), scheduledDays: Math.max(0, days), dailyRateDivisor: pack.labour.dailyRateDivisor,
        });
        if (amount > 0) allowanceEarnings.push({ code: t.code, name: t.calc === 'per_day' ? `${t.label} (${days} dia(s))` : t.label, amountMinor: amount, inInss: t.inInss, inIrt: t.inIrt });
      }
      const otherEarnings = [...allowanceEarnings, ...variableEarnings];

      // Subsídio de férias: mês fixo da empresa, ou mês em que começam as primeiras férias aprovadas do ano (Dezembro como último recurso)
      const ov = overrides[e.id] ?? {};
      const firstVacation = (vacationsByEmployee.get(e.id) ?? []).map((v) => v.startDate).sort()[0];
      const holidayAuto = company?.holidaySubsidyMonth
        ? month === company.holidaySubsidyMonth
        : (firstVacation ? firstVacation.slice(0, 7) === period : false) || month === 12;
      let holidaySubsidy: number | false = false;
      if (!settling && (ov.holiday ?? holidayAuto)) {
        if (paid(e.id, 'SUBFER')) {
          if (ov.holiday) warnings.push({ employeeId: e.id, message: `${e.name}: subsídio de férias de ${year} já foi pago — não incluído` });
        } else {
          // Art. 238.º, n.º 3: sem um ano de serviço, proporcional aos meses completos trabalhados (até ao pagamento).
          holidaySubsidy = Math.min(12, fullMonthsBetween(hire, periodEnd)) / 12;
          if (!holidaySubsidy) holidaySubsidy = false;
        }
      }
      // Subsídio de Natal: mês definido pela empresa; proporcional ao tempo de serviço no ano
      let christmasSubsidy: number | false = false;
      if (!settling && (ov.christmas ?? month === (company?.christmasSubsidyMonth ?? 12))) {
        if (paid(e.id, 'SUBNAT')) {
          if (ov.christmas) warnings.push({ employeeId: e.id, message: `${e.name}: subsídio de Natal de ${year} já foi pago — não incluído` });
        } else {
          christmasSubsidy = yearServiceFraction(year, hire, ended) || false;
        }
      }

      let r: PayrollResult;
      try {
        r = calculatePayroll({
          period, pack, normalWeeklyHours, baseMinor: pay.baseMinor, baseLabel, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor,
          overtimeHours, absenceDays, absenceHours, otherEarnings, advancesMinor, otherDeductionsMinor, otherDeductions, noticeDeductionMinor, holidaySubsidy, christmasSubsidy, workedDays,
          restDayHours, unpaidLeaveHours, unpaidLeaveLabel: unpaidLeaveHours ? `${unpaidLabel.charAt(0).toUpperCase()}${unpaidLabel.slice(1)} (${unpaidLeaveHours} h)` : undefined,
          vacationAllowanceCut, absenceAllowanceCut, latenessHours,
        });
        // Casos sem regra fechada na LGT: o motor não calcula — avisa e o valor é lançado à mão nas variáveis.
        if (maternityDays) warnings.push({ employeeId: e.id, message: `${e.name}: ${maternityDays} dia(s) de licença de maternidade em ${period} — CÁLCULO MANUAL: o salário está suspenso e o motor pagou o mês por inteiro; lance "Desconto na remuneração" com o valor a retirar (base, alimentação, transporte). Apure separadamente o subsídio de maternidade e o reembolso ao abrigo do regime aplicável à licença (DP n.º 95/26 para as licenças abrangidas pelo novo regime).` });
        if (holidayWorkDays) warnings.push({ employeeId: e.id, message: `${e.name}: ${holidayWorkDays} feriado(s) trabalhado(s) — CÁLCULO MANUAL do acréscimo por feriado trabalhado ("mais um dia de salário normal"): lance em "Outro abono"` });
        if (period.endsWith('-12') && att && sched?.kind !== 'cycle') warnings.push({ employeeId: e.id, message: `${e.name}: 24 e 31 de Dezembro com paragem às 12h30 — CÁLCULO MANUAL: horas trabalhadas depois das 12h30 não entram como extraordinárias; lance-as em "Outro abono" se forem devidas` });
        if (maternityYear.has(e.id) && (holidaySubsidy || christmasSubsidy)) {
          warnings.push({ employeeId: e.id, message: `${e.name}: subsídio pago num ano com licença de maternidade — a lei manda pagar proporcional aos meses completos de serviço efectivo; CÁLCULO MANUAL: confirme e ajuste o valor` });
        }
        // Descontos a crédito (adiantamentos e outros) até 25% do líquido (LGT, art. 248.º, n.º 7).
        const credit = advancesMinor + otherDeductionsMinor;
        const cap = monthlyDeductionCap(r.netMinor + credit + noticeDeductionMinor, pack);
        if (credit > cap) warnings.push({ employeeId: e.id, message: `${e.name}: adiantamentos e outros descontos (${(credit / 100).toLocaleString('pt-PT')} Kz) acima de 25% do salário líquido (${(cap / 100).toLocaleString('pt-PT')} Kz)` });
      } catch (err) {
        if (err instanceof NegativeNetError) throw new DomainError('liquido_negativo', `${e.name}: os descontos (adiantamentos e outros) excedem o ilíquido do mês. Reduza ou reparta pelos meses seguintes.`, 422);
        throw err;
      }
      const hash = createHash('sha256').update(JSON.stringify({
        company: companyId, period, packVersion: r.packVersion, employee: e.id, contract: c.id, department: e.departmentId,
        pay: { base: pay.baseMinor, meal: pay.mealMinor, transport: pay.transportMinor, ...(indexed ? { usd: indexed, fx: run.fxRate, fxDate: run.fxDate } : {}) }, lines: r.lines, net: r.netMinor,
      })).digest('hex');
      const values = {
        overtimeHours: String(overtimeHours), absenceDays, bonusMinor: variableEarnings.reduce((s, x) => s + x.amountMinor, 0), advancesMinor,
        grossMinor: r.grossMinor, inssBaseMinor: r.inssBaseMinor, irtTaxableMinor: r.irtTaxableMinor, inssEmployeeMinor: r.inssEmployeeMinor, irtMinor: r.irtMinor, netMinor: r.netMinor,
        inssEmployerMinor: r.inssEmployerMinor, irtBracket: r.irtBracket, breakdown: r.lines, calculationHash: hash,
        departmentId: e.departmentId, costCenter: e.departmentId ? costCenterOf.get(e.departmentId) ?? null : null,
      };
      pendingLines.push({ runId: run.id, employeeId: e.id, ...values });
      keep.push(e.id);
      results.push({ employeeId: e.id, r });
    }
    if (missingFx.length) throw new DomainError('cambio_em_falta', `Indique o câmbio USD→Kz do dia do processamento: ${missingFx.length} colaborador(es) com salário indexado ao dólar (${missingFx.slice(0, 5).join(', ')}${missingFx.length > 5 ? '…' : ''}).`, 422);
    // Até 200 linhas por escrita; preserva os IDs dos recibos no recálculo.
    for (let i = 0; i < pendingLines.length; i += 200) {
      await tx.insert(payrollLines).values(pendingLines.slice(i, i + 200)).onConflictDoUpdate({ target: [payrollLines.runId, payrollLines.employeeId], set: {
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
      } });
    }
    // Colaboradores que já não entram (cessados, suspensos) saem do rascunho.
    const stale = await tx.select({ id: payrollLines.id, employeeId: payrollLines.employeeId }).from(payrollLines).where(eq(payrollLines.runId, run.id));
    const keepIds = new Set(keep);
    const remove = stale.filter((l) => !keepIds.has(l.employeeId) && (!selected || selected.has(l.employeeId))).map((l) => l.id);
    if (remove.length) await tx.delete(payrollLines).where(inArray(payrollLines.id, remove));

    const allWarnings = selected ? [...(run.warnings as PayrollWarning[]).filter(w => !w.employeeId || !selected.has(w.employeeId)), ...warnings] : warnings;
    const withholdingRule: typeof run.withholdingRule = preserves ? run.withholdingRule : {
      tax: 'IRT', group: 'A', packVersion: pack.version,
      allowanceExemptionMinor: pack.irt.allowanceExemptionMinor,
      brackets: pack.irt.brackets.map(([upper, fixed, rateBps, excessFrom]) =>
        [Number.isFinite(upper) ? upper : null, fixed, rateBps, excessFrom]),
    };
    [run] = await tx.update(payrollRuns).set({ preparedBy: actorId, warnings: allWarnings, packVersion: pack.version, withholdingRule }).where(eq(payrollRuns.id, run.id)).returning() as [typeof run];
    await tx.insert(auditLogs).values({ companyId, actorId, action: selected ? 'draft_batch' : 'draft', entity: 'payroll_run', entityId: run.id, after: { period, employees: results.length, totalEmployees: stale.length - remove.length, ...(selected ? { employeeIds } : {}), warnings: allWarnings.length } });
    return { run, lines: results.length, totalLines: stale.length - remove.length, warnings: allWarnings };
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
interface PayrollCheck { hashes: Map<string, string | null>; warnings: PayrollWarning[] }
/** Sinal interno para desfazer o recálculo de verificação (savepoint) depois de ler os resultados. */
class PayrollProbe extends Error { constructor(readonly check: PayrollCheck) { super('verificação do rascunho'); } }
const MANUAL_WARNING = /CÁLCULO MANUAL/;
const warningKeys = (warnings: PayrollWarning[]) => JSON.stringify([...new Set(warnings.map(w => [w.employeeId ?? '', w.message].join('\0')))].sort());

/**
 * Recalcula a folha dentro de um savepoint e devolve os hashes e os avisos, sem gravar nada.
 * Serve para recusar o fecho de um rascunho desactualizado (variáveis, salários, assiduidade, ausências,
 * subsídios ou regras alterados depois do último «Recalcular»).
 */
async function freshPayrollCheck(tx: Db, companyId: string, period: string, actorId: string): Promise<PayrollCheck> {
  try {
    await tx.transaction(async (sp) => {
      const { run, warnings } = await draftPayroll(sp as unknown as Db, companyId, period, actorId);
      const rows = await sp.select({ employeeId: payrollLines.employeeId, hash: payrollLines.calculationHash }).from(payrollLines).where(eq(payrollLines.runId, run.id));
      throw new PayrollProbe({ hashes: new Map(rows.map(r => [r.employeeId, r.hash])), warnings });
    });
  } catch (error) {
    if (error instanceof PayrollProbe) return error.check;
    if (error instanceof DomainError) throw new DomainError('rascunho_desactualizado', `A folha já não pode ser recalculada com os dados actuais: ${error.message} Corrija e recalcule antes de fechar.`, 409);
    throw error;
  }
  throw new Error('Verificação do rascunho sem resultado');
}

export interface ClosePayrollOptions { manualReview?: string }

export async function closePayroll(db: Db, companyId: string, runId: string, actorId: string, role = 'owner', options: ClosePayrollOptions = {}) {
  return db.transaction(async (tx) => {
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).for('update');
    if (!run) throw new DomainError('nao_encontrado', 'Processamento inexistente', 404);
    if (run.status === 'closed') throw new DomainError('processamento_fechado', 'Já está fechado');
    // Segregação de funções: quem prepara não fecha (excepto o proprietário, em empresas pequenas).
    if (run.preparedBy === actorId && role !== 'owner') throw new DomainError('segregacao_funcoes', 'O processamento tem de ser fechado por uma pessoa diferente de quem o preparou', 403);
    const lines = await tx.select({ l: payrollLines, cc: departments.costCenter }).from(payrollLines)
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payrollLines.runId, run.id));
    if (!lines.length) throw new DomainError('sem_linhas', 'O processamento não tem colaboradores');
    const eligible = await eligiblePayrollStaff(tx as unknown as Db, companyId, run.period), valid = new Set(eligible.map(s => s.e.id));
    const included = new Set(lines.map(l => l.l.employeeId)), missing = eligible.filter(s => !included.has(s.e.id));
    if (missing.length) throw new DomainError('processamento_incompleto', `Faltam ${missing.length} colaborador(es) por processar: ${missing.slice(0, 5).map(s => s.e.name).join(', ')}. Processe o lote em falta antes de fechar o mês.`, 409);
    if (lines.some(l => !valid.has(l.l.employeeId))) throw new DomainError('equipa_alterada', 'A elegibilidade da equipa mudou. Recalcule toda a folha antes de fechar o mês.', 409);
    const fresh = await freshPayrollCheck(tx as unknown as Db, companyId, run.period, actorId);
    const changed = lines.filter(l => !l.l.calculationHash || fresh.hashes.get(l.l.employeeId) !== l.l.calculationHash);
    if (changed.length || fresh.hashes.size !== lines.length) {
      const names = new Map((await tx.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, changed.slice(0, 5).map(l => l.l.employeeId)))).map(e => [e.id, e.name]));
      const who = changed.slice(0, 5).map(l => names.get(l.l.employeeId) ?? l.l.employeeId).join(', ');
      throw new DomainError('rascunho_desactualizado', `Os dados mudaram depois do último cálculo${who ? ` (${changed.length} colaborador(es): ${who}${changed.length > 5 ? '…' : ''})` : ''}. Use «Recalcular» e confirme os valores antes de fechar o mês.`, 409);
    }
    if (warningKeys(fresh.warnings) !== warningKeys((run.warnings ?? []) as PayrollWarning[])) {
      throw new DomainError('rascunho_desactualizado', 'Os avisos da folha mudaram depois do último cálculo. Use «Recalcular» e reveja os avisos antes de fechar o mês.', 409);
    }
    // Avisos de cálculo manual: o fecho exige a confirmação escrita de quem fecha, que fica registada.
    const manual = fresh.warnings.filter(w => MANUAL_WARNING.test(w.message));
    const review = options.manualReview?.trim() ?? '';
    if (manual.length && review.length < 10) throw new DomainError('revisao_calculo_manual', `Há ${manual.length} aviso(s) de CÁLCULO MANUAL neste mês. Confirme por escrito o que foi revisto e lançado (mínimo 10 caracteres) antes de fechar.`, 409);

    const byCc = new Map<string, PayrollTotals['byCostCenter'][number]>();
    const totals: PayrollTotals = { byCostCenter: [], irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0, advancesMinor: 0, otherDeductionsMinor: 0, netMinor: 0 };
    for (const { l, cc } of lines) {
      // Centro de custo do momento do cálculo (fotografia na linha); linhas antigas sem fotografia usam o actual.
      const key = l.costCenter ?? cc ?? 'SEM-CC';
      const t = byCc.get(key) ?? { costCenter: key, baseMinor: 0, allowancesMinor: 0, overtimeAndBonusMinor: 0, holidayChristmasMinor: 0, employerInssMinor: 0, terminationMinor: 0 };
      for (const item of linesOf(l)) {
        if (item.kind !== 'earning') continue;
        if (item.code === 'BASE' || item.code === 'FALTAS' || item.code === 'LICNR' || item.code === 'CORTE' || item.code === 'SUSP' || item.code === 'FERNG' || item.code === 'FERPROP') t.baseMinor += item.amountMinor;
        else if (item.code === 'SUBFER' || item.code === 'SUBNAT' || item.code === 'SUBFERPROP') t.holidayChristmasMinor += item.amountMinor;
        else if (item.code === 'COMP' || item.code === 'COMPEXC' || item.code === 'AVISO') t.terminationMinor = (t.terminationMinor ?? 0) + item.amountMinor;
        else if (item.code === 'HE' || item.code === 'HEDESC' || item.code === 'FERTRAB' || item.code.startsWith('BONUS')) t.overtimeAndBonusMinor += item.amountMinor;
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
    const [je] = await tx.insert(journalEntries).values({ companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'payroll' }).returning();
    await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, costCenter: l.costCenter, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
    const contexts = await payslipContexts(tx as unknown as Db, companyId, run.period, lines.map(x => x.l.employeeId));
    const snapshots = lines.map(({ l }) => ({ id: l.id, context: contexts.get(l.employeeId)! }));
    await tx.execute(sql`update payroll_lines as l set payslip_context = snap.context
      from jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) as snap(id text, context jsonb)
      where l.id = snap.id and l.run_id = ${run.id}`);
    const [closed] = await tx.update(payrollRuns).set({ status: 'closed', closedAt: new Date(), closedBy: actorId }).where(eq(payrollRuns.id, run.id)).returning();
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'close', entity: 'payroll_run', entityId: run.id, before: run, after: { ...closed, ...(manual.length ? { manualReview: { note: review, warnings: manual.map(w => w.message) } } : {}) } });
    // Recibos disponíveis: aviso no telemóvel de cada colaborador processado (sem montantes no aviso).
    const month = new Date(`${run.period}-15T12:00:00Z`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'Africa/Luanda' });
    await notifyEmployees(tx as unknown as Db, companyId, [...new Set(lines.map(x => x.l.employeeId))], { title: 'Recibo de vencimento disponível', body: `O seu recibo de ${month} já pode ser consultado.`, url: '/recibos', tag: `recibo-${run.period}` });
    return { run: closed, journalReference: entry.reference, totals };
  });
}
