import { groupBy } from '../lib/group-by.js';
import { createHash } from 'node:crypto';
import {
  allowanceAmount, businessDays, calculatePayroll, fullMonthsBetween, monthlyDeductionCap, scheduledDays, scheduledMinutes, type Schedule, compensationAt, DEFAULT_PGC_ACCOUNTS, getPack, labourRules, lastDayOfMonth, NegativeNetError, overtimeHoursFromMinutes,
  payrollJournal, yearServiceFraction, type EarningInput, type PayrollResult, type PayrollTotals, type PgcAccountMap,
} from '@kianda/core';
import {
  absences, accountMappings, allowanceTypes, and, asc, employeeAllowances, isNull, or, workSchedules, attendanceEntries, attendanceMonths, auditLogs, companies, compensationChanges, contracts, departments, desc, employees, eq,
  gte, inArray, sql, journalEntries, journalLines, lte, ne, payrollLines, payrollRuns, payrollVariables, type Db,
} from '@kianda/db';

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PayrollWarning { employeeId?: string; message: string }
export type SubsidyOverrides = Record<string, { holiday?: boolean; christmas?: boolean }>;

type Line = { code: string; kind: string; amountMinor: number };
const linesOf = (l: { breakdown: unknown }) => l.breakdown as Line[];
const amountOf = (l: { breakdown: unknown }, code: string) => linesOf(l).filter((x) => x.code === code).reduce((s, x) => s + x.amountMinor, 0);

/**
 * Cria (ou recalcula) o processamento em rascunho do período para todos os colaboradores activos.
 * Inclui: remuneração em vigor no fim do mês, horas extra aprovadas, faltas injustificadas, variáveis do mês,
 * subsídios de férias e de Natal (automáticos, proporcionais no ano de admissão, nunca em duplicado).
 */
export async function draftPayroll(db: Db, companyId: string, period: string, actorId: string) {
  if (!periodRe.test(period)) throw new DomainError('periodo_invalido', 'Período inválido (AAAA-MM)', 400);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const pack = getPack('AO', year);
  return db.transaction(async (tx) => {
    let [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period)));
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento deste período já está fechado');
    run ??= (await tx.insert(payrollRuns).values({ companyId, period, packVersion: pack.version, preparedBy: actorId }).returning())[0]!;
    const overrides = (run.subsidyOverrides ?? {}) as SubsidyOverrides;
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));

    const periodStart = `${period}-01`;
    const periodEnd = lastDayOfMonth(period);
    const staff = await tx.select({ e: employees, c: contracts }).from(employees)
      .innerJoin(contracts, eq(contracts.employeeId, employees.id))
      .where(and(eq(employees.companyId, companyId), inArray(employees.status, ['active', 'terminated'])))
      .orderBy(employees.number, desc(contracts.startDate));
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
      eq(absences.companyId, companyId), inArray(absences.type, ['paternity', 'vacation', 'maternity']), eq(absences.status, 'approved'),
      lte(absences.startDate, periodEnd), gte(absences.endDate, periodStart),
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
      const pay = compensationAt(compByEmployee.get(e.id) ?? [], periodEnd) ?? c;
      const hire = firstContract.get(e.id) ?? c.startDate;

      // Assiduidade e faltas
      const att = attendanceByEmployee.get(e.id);
      if (!att && withPunches.has(e.id)) warnings.push({ employeeId: e.id, message: `${e.name}: assiduidade de ${period} por aprovar — horas extra não incluídas` });
      // Extra em dias normais (+50%/+75%); descanso semanal (+75%, mín. 3 h) e feriados (+1 dia) à parte — arts. 188.º, 194.º e 200.º.
      const overtimeHours = att ? overtimeHoursFromMinutes(Math.max(0, att.approvedOvertimeMinutes - att.restHolidayOvertimeMinutes)) : 0;
      const restDayHours = att ? overtimeHoursFromMinutes(att.restDayPaidMinutes) : 0;
      const holidayWorkDays = att?.holidayWorkDays ?? 0;
      // Regime do colaborador (turnos/rotação) ou o horário normal da empresa.
      const sched = e.scheduleId ? schedules.get(e.scheduleId) : undefined;
      const regime: Schedule = sched ? { kind: sched.kind as Schedule['kind'], pattern: sched.pattern, anchorDate: sched.anchorDate } : companyWeek;
      const anchor = e.scheduleAnchor ?? sched?.anchorDate ?? null;
      if (sched?.kind === 'cycle' && !anchor) warnings.push({ employeeId: e.id, message: `${e.name}: regime "${sched.name}" sem data de início do ciclo — faltas e subsídios por dia não calculados` });
      // Faltas injustificadas: dias de trabalho previstos (regime) dentro da falta, sem feriados.
      const myAbsences = (absencesByEmployee.get(e.id) ?? []).map((a) => ({ from: a.startDate < periodStart ? periodStart : a.startDate, to: a.endDate > periodEnd ? periodEnd : a.endDate }));
      const absenceDays = myAbsences.reduce((s, a) => s + (sched ? scheduledDays(regime, a.from, a.to, anchor, holidaySet) : businessDays(a.from, a.to, [labourRules('AO', year)])), 0);
      // Horas de falta pelo regime (valor-hora × horas, arts. 237.º e 240.º); sem regime: dias × 8 h.
      const minutesIn = (from: string, to: string) => {
        let m = 0;
        for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
          const d = new Date(t).toISOString().slice(0, 10);
          if (!holidaySet.has(d)) m += scheduledMinutes(regime, d, anchor);
        }
        return m;
      };
      const absenceHours = sched ? Math.round((myAbsences.reduce((s, a) => s + minutesIn(a.from, a.to), 0) / 60) * 100) / 100 : undefined;
      const unjustifiedThisMonth = absenceDays;
      const unjustifiedThisYear = (unjustifiedYearByEmployee.get(e.id) ?? []).reduce((s, a) => {
        const f = a.startDate < `${year}-01-01` ? `${year}-01-01` : a.startDate;
        const l = a.endDate > periodEnd ? periodEnd : a.endDate;
        return s + businessDays(f, l, [labourRules('AO', year)]);
      }, 0);
      const disc = pack.labour.unjustifiedDisciplinary;
      if (unjustifiedThisMonth > disc.perMonth || unjustifiedThisYear > disc.perYear) {
        warnings.push({ employeeId: e.id, message: `${e.name}: ${unjustifiedThisMonth > disc.perMonth ? `${unjustifiedThisMonth} faltas injustificadas no mês` : `${unjustifiedThisYear} faltas injustificadas no ano`} — constitui infracção disciplinar (LGT, art. 230.º)` });
      }
      // Paternidade: 1 dia pago e o restante não remunerado (art. 218.º).
      const workMinutesIn = (from: string, to: string) => (sched ? minutesIn(from, to) : businessDays(from, to, [labourRules('AO', year)]) * pack.labour.dailyHours * 60);
      let unpaidLeaveHours = 0;
      for (const a of (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'paternity')) {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        let mins = workMinutesIn(from, to);
        if (a.startDate >= periodStart) mins -= Math.min(mins, pack.leave.paternityPaidDays * pack.labour.dailyHours * 60); // dia pago
        unpaidLeaveHours += mins / 60;
      }
      unpaidLeaveHours = Math.round(unpaidLeaveHours * 100) / 100;
      // Licença de maternidade: suspende o contrato e o salário (arts. 267.º, c) e 268.º) — cálculo manual, só se contam os dias.
      let maternityDays = 0;
      for (const a of (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'maternity')) {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        maternityDays += Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      }
      // Férias no mês: alimentação e transporte não são devidos nesses dias, salvo acordo (art. 213.º, n.º 2).
      let vacationAllowanceCut: { fraction: number; days: number } | undefined;
      if (!company?.allowancesOnVacation) {
        const dayCount = (from: string, to: string) => (sched ? scheduledDays(regime, from, to, anchor, holidaySet) : businessDays(from, to, [labourRules('AO', year)]));
        const vacDays = (leavesByEmployee.get(e.id) ?? []).filter((x) => x.type === 'vacation').reduce((s, a) => s + dayCount(a.startDate < periodStart ? periodStart : a.startDate, a.endDate > periodEnd ? periodEnd : a.endDate), 0);
        const monthDays = dayCount(periodStart, periodEnd);
        if (vacDays > 0 && monthDays > 0) vacationAllowanceCut = { fraction: Math.min(1, vacDays / monthDays), days: vacDays };
      }

      // Variáveis do mês
      const mine = variablesByEmployee.get(e.id) ?? [];
      const variableEarnings: EarningInput[] = mine.filter((v) => v.kind === 'bonus' || v.kind === 'other_earning').map((v) => ({
        code: v.code ?? (v.kind === 'bonus' ? 'BONUS' : 'OUTABON'), name: v.label, amountMinor: v.amountMinor, inInss: v.inInss, inIrt: v.inIrt,
      }));
      const advancesMinor = mine.filter((v) => v.kind === 'advance').reduce((s, v) => s + v.amountMinor, 0);
      const otherDeductionsMinor = mine.filter((v) => v.kind === 'other_deduction' && v.code !== 'AVISODESC').reduce((s, v) => s + v.amountMinor, 0);
      const noticeDeductionMinor = mine.filter((v) => v.kind === 'other_deduction' && v.code === 'AVISODESC').reduce((s, v) => s + v.amountMinor, 0);
      // Fecho de contas: os subsídios do ano vêm da cessação (já calculados e eventualmente ajustados), não do automático.
      const settling = mine.some((v) => v.terminationId);
      // Mês incompleto: admissão ou cessação a meio do mês.
      const from = hire > periodStart ? hire : periodStart;
      const to = ended && ended < periodEnd ? ended : periodEnd;
      const workedDays = from === periodStart && to === periodEnd ? undefined : Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);

      // Subsídios recorrentes: vigência ∩ contrato no mês; por dia = dias de escala menos faltas injustificadas.
      const allowanceEarnings: EarningInput[] = [];
      for (const { a, t } of allowancesByEmployee.get(e.id) ?? []) {
        const aFrom = a.startDate > from ? a.startDate : from;
        const aTo = a.endDate && a.endDate < to ? a.endDate : to;
        if (aFrom > aTo) continue;
        const full = aFrom === periodStart && aTo === periodEnd;
        let days = 0;
        if (t.calc === 'per_day') {
          days = scheduledDays(regime, aFrom, aTo, anchor);
          for (const ab of myAbsences) {
            const f = ab.from > aFrom ? ab.from : aFrom;
            const l = ab.to < aTo ? ab.to : aTo;
            if (f <= l) days -= scheduledDays(regime, f, l, anchor, holidaySet);
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
          holidaySubsidy = hire > `${year}-01-01` ? Math.round((Math.min(12, fullMonthsBetween(hire, periodEnd)) / 12) * 10_000) / 10_000 : 1;
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
          period, pack, baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor,
          overtimeHours, absenceDays, absenceHours, otherEarnings, advancesMinor, otherDeductionsMinor, noticeDeductionMinor, holidaySubsidy, christmasSubsidy, workedDays,
          restDayHours, unpaidLeaveHours, unpaidLeaveLabel: unpaidLeaveHours ? `Licença de paternidade não remunerada (${unpaidLeaveHours} h)` : undefined,
          vacationAllowanceCut,
        });
        // Casos sem regra fechada na LGT: o motor não calcula — avisa e o valor é lançado à mão nas variáveis.
        if (maternityDays) warnings.push({ employeeId: e.id, message: `${e.name}: ${maternityDays} dia(s) de licença de maternidade em ${period} — CÁLCULO MANUAL: o salário está suspenso (arts. 267.º, c) e 268.º) e o motor pagou o mês por inteiro; lance "Desconto na remuneração" com o valor a retirar (base, alimentação, transporte)` });
        if (holidayWorkDays) warnings.push({ employeeId: e.id, message: `${e.name}: ${holidayWorkDays} feriado(s) trabalhado(s) — CÁLCULO MANUAL do acréscimo do art. 200.º, n.º 2 ("mais um dia de salário normal"): lance em "Outro abono"` });
        if (period.endsWith('-12') && att && sched?.kind !== 'cycle') warnings.push({ employeeId: e.id, message: `${e.name}: 24 e 31 de Dezembro com paragem às 12h30 (art. 199.º) — CÁLCULO MANUAL: horas trabalhadas depois das 12h30 não entram como extraordinárias; lance-as em "Outro abono" se forem devidas` });
        if (maternityYear.has(e.id) && (holidaySubsidy || christmasSubsidy)) {
          warnings.push({ employeeId: e.id, message: `${e.name}: subsídio pago num ano com licença de maternidade — o art. 238.º, n.º 3 manda pagar proporcional aos meses completos de serviço efectivo; CÁLCULO MANUAL: confirme e ajuste o valor` });
        }
        // Descontos a crédito (adiantamentos e outros) até 25% do líquido (LGT, art. 248.º, n.º 7).
        const credit = advancesMinor + otherDeductionsMinor;
        const cap = monthlyDeductionCap(r.netMinor + credit + noticeDeductionMinor, pack);
        if (credit > cap) warnings.push({ employeeId: e.id, message: `${e.name}: adiantamentos e outros descontos (${(credit / 100).toLocaleString('pt-PT')} Kz) acima de 25% do salário líquido (${(cap / 100).toLocaleString('pt-PT')} Kz) — LGT, art. 248.º, n.º 7` });
      } catch (err) {
        if (err instanceof NegativeNetError) throw new DomainError('liquido_negativo', `${e.name}: os descontos (adiantamentos e outros) excedem o ilíquido do mês. Reduza ou reparta pelos meses seguintes.`, 422);
        throw err;
      }
      const hash = createHash('sha256').update(JSON.stringify({
        company: companyId, period, packVersion: r.packVersion, employee: e.id, contract: c.id,
        pay: { base: pay.baseMinor, meal: pay.mealMinor, transport: pay.transportMinor }, lines: r.lines, net: r.netMinor,
      })).digest('hex');
      const values = {
        overtimeHours: String(overtimeHours), absenceDays, bonusMinor: variableEarnings.reduce((s, x) => s + x.amountMinor, 0), advancesMinor,
        grossMinor: r.grossMinor, inssBaseMinor: r.inssBaseMinor, irtTaxableMinor: r.irtTaxableMinor, inssEmployeeMinor: r.inssEmployeeMinor, irtMinor: r.irtMinor, netMinor: r.netMinor,
        inssEmployerMinor: r.inssEmployerMinor, irtBracket: r.irtBracket, breakdown: r.lines, calculationHash: hash,
      };
      pendingLines.push({ runId: run.id, employeeId: e.id, ...values });
      keep.push(e.id);
      results.push({ employeeId: e.id, r });
    }
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
      } });
    }
    // Colaboradores que já não entram (cessados, suspensos) saem do rascunho.
    const stale = await tx.select({ id: payrollLines.id, employeeId: payrollLines.employeeId }).from(payrollLines).where(eq(payrollLines.runId, run.id));
    const keepIds = new Set(keep);
    const remove = stale.filter((l) => !keepIds.has(l.employeeId)).map((l) => l.id);
    if (remove.length) await tx.delete(payrollLines).where(inArray(payrollLines.id, remove));

    [run] = await tx.update(payrollRuns).set({ preparedBy: actorId, warnings, packVersion: pack.version }).where(eq(payrollRuns.id, run.id)).returning() as [typeof run];
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'draft', entity: 'payroll_run', entityId: run.id, after: { period, employees: results.length, warnings: warnings.length } });
    return { run, lines: results.length, warnings };
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
export async function closePayroll(db: Db, companyId: string, runId: string, actorId: string, role = 'owner') {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId)));
    if (!run) throw new DomainError('nao_encontrado', 'Processamento inexistente', 404);
    if (run.status === 'closed') throw new DomainError('processamento_fechado', 'Já está fechado');
    // Segregação de funções: quem prepara não fecha (excepto o proprietário, em empresas pequenas).
    if (run.preparedBy === actorId && role !== 'owner') throw new DomainError('segregacao_funcoes', 'O processamento tem de ser fechado por uma pessoa diferente de quem o preparou', 403);
    const lines = await tx.select({ l: payrollLines, cc: departments.costCenter }).from(payrollLines)
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payrollLines.runId, run.id));
    if (!lines.length) throw new DomainError('sem_linhas', 'O processamento não tem colaboradores');

    const byCc = new Map<string, PayrollTotals['byCostCenter'][number]>();
    const totals: PayrollTotals = { byCostCenter: [], irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0, advancesMinor: 0, otherDeductionsMinor: 0, netMinor: 0 };
    for (const { l, cc } of lines) {
      const key = cc ?? 'SEM-CC';
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
    const [closed] = await tx.update(payrollRuns).set({ status: 'closed', closedAt: new Date(), closedBy: actorId }).where(eq(payrollRuns.id, run.id)).returning();
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'close', entity: 'payroll_run', entityId: run.id, before: run, after: closed });
    return { run: closed, journalReference: entry.reference, totals };
  });
}
