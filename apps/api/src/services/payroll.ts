import { createHash } from 'node:crypto';
import {
  businessDays, calculatePayroll, compensationAt, DEFAULT_PGC_ACCOUNTS, getPack, labourRules, lastDayOfMonth, NegativeNetError, overtimeHoursFromMinutes,
  payrollJournal, vacationEntitlement, yearServiceFraction, type EarningInput, type PayrollResult, type PayrollTotals, type PgcAccountMap,
} from '@kianda/core';
import {
  absences, accountMappings, and, asc, attendanceEntries, attendanceMonths, auditLogs, companies, compensationChanges, contracts, departments, desc, employees, eq,
  gte, inArray, journalEntries, journalLines, lte, ne, payrollLines, payrollRuns, payrollVariables, type Db,
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
    const withPunches = new Set((await tx.select({ id: attendanceEntries.employeeId }).from(attendanceEntries)
      .where(and(eq(attendanceEntries.companyId, companyId), gte(attendanceEntries.workDate, periodStart), lte(attendanceEntries.workDate, periodEnd)))).map((r) => r.id));
    const variables = await tx.select().from(payrollVariables).where(and(eq(payrollVariables.companyId, companyId), eq(payrollVariables.period, period)));
    // Subsídios já pagos noutros processamentos FECHADOS do mesmo ano.
    const paidThisYear = await tx.select({ employeeId: payrollLines.employeeId, breakdown: payrollLines.breakdown }).from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
      .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, `${year}-01`), lte(payrollRuns.period, `${year}-12`), ne(payrollRuns.period, period)));
    const paid = (employeeId: string, code: string) => paidThisYear.some((p) => p.employeeId === employeeId && amountOf(p, code) > 0);

    const warnings: PayrollWarning[] = [];
    const seen = new Set<string>();
    const results: { employeeId: string; r: PayrollResult }[] = [];
    const keep: string[] = [];
    for (const { e, c } of staff) {
      if (seen.has(e.id)) continue;
      if (c.startDate > periodEnd) continue; // contrato futuro: usa o contrato anterior (se existir)
      seen.add(e.id);
      const ended = c.terminatedAt ?? c.endDate;
      if (ended && ended < periodStart) continue;
      const pay = compensationAt(comp.filter((x) => x.employeeId === e.id), periodEnd) ?? c;
      const hire = firstContract.get(e.id) ?? c.startDate;

      // Assiduidade e faltas
      const att = approvedMonths.find((m) => m.employeeId === e.id);
      if (!att && withPunches.has(e.id)) warnings.push({ employeeId: e.id, message: `${e.name}: assiduidade de ${period} por aprovar — horas extra não incluídas` });
      const overtimeHours = att ? overtimeHoursFromMinutes(att.approvedOvertimeMinutes) : 0;
      const absenceDays = unjustified.filter((a) => a.employeeId === e.id).reduce((s, a) => {
        const from = a.startDate < periodStart ? periodStart : a.startDate;
        const to = a.endDate > periodEnd ? periodEnd : a.endDate;
        return s + businessDays(from, to, [labourRules('AO', year)]);
      }, 0);

      // Variáveis do mês
      const mine = variables.filter((v) => v.employeeId === e.id);
      const otherEarnings: EarningInput[] = mine.filter((v) => v.kind === 'bonus' || v.kind === 'other_earning').map((v) => ({
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

      // Subsídio de férias: mês fixo da empresa, ou mês em que começam as primeiras férias aprovadas do ano (Dezembro como último recurso)
      const ov = overrides[e.id] ?? {};
      const firstVacation = vacations.filter((v) => v.employeeId === e.id).map((v) => v.startDate).sort()[0];
      const holidayAuto = company?.holidaySubsidyMonth
        ? month === company.holidaySubsidyMonth
        : (firstVacation ? firstVacation.slice(0, 7) === period : false) || month === 12;
      let holidaySubsidy: number | false = false;
      if (!settling && (ov.holiday ?? holidayAuto)) {
        if (paid(e.id, 'SUBFER')) {
          if (ov.holiday) warnings.push({ employeeId: e.id, message: `${e.name}: subsídio de férias de ${year} já foi pago — não incluído` });
        } else {
          const entitlement = vacationEntitlement(hire, year, pack);
          holidaySubsidy = Math.round((entitlement / pack.labour.vacationWorkingDays) * 10_000) / 10_000;
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
          overtimeHours, absenceDays, otherEarnings, advancesMinor, otherDeductionsMinor, noticeDeductionMinor, holidaySubsidy, christmasSubsidy, workedDays,
        });
      } catch (err) {
        if (err instanceof NegativeNetError) throw new DomainError('liquido_negativo', `${e.name}: os descontos (adiantamentos e outros) excedem o ilíquido do mês. Reduza ou reparta pelos meses seguintes.`, 422);
        throw err;
      }
      const hash = createHash('sha256').update(JSON.stringify({
        company: companyId, period, packVersion: r.packVersion, employee: e.id, contract: c.id,
        pay: { base: pay.baseMinor, meal: pay.mealMinor, transport: pay.transportMinor }, lines: r.lines, net: r.netMinor,
      })).digest('hex');
      const values = {
        overtimeHours: String(overtimeHours), absenceDays, bonusMinor: otherEarnings.reduce((s, x) => s + x.amountMinor, 0), advancesMinor,
        grossMinor: r.grossMinor, inssBaseMinor: r.inssBaseMinor, irtTaxableMinor: r.irtTaxableMinor, inssEmployeeMinor: r.inssEmployeeMinor, irtMinor: r.irtMinor, netMinor: r.netMinor,
        inssEmployerMinor: r.inssEmployerMinor, irtBracket: r.irtBracket, breakdown: r.lines, calculationHash: hash,
      };
      await tx.insert(payrollLines).values({ runId: run.id, employeeId: e.id, ...values })
        .onConflictDoUpdate({ target: [payrollLines.runId, payrollLines.employeeId], set: values });
      keep.push(e.id);
      results.push({ employeeId: e.id, r });
    }
    // Colaboradores que já não entram (cessados, suspensos) saem do rascunho.
    const stale = await tx.select({ id: payrollLines.id, employeeId: payrollLines.employeeId }).from(payrollLines).where(eq(payrollLines.runId, run.id));
    const remove = stale.filter((l) => !keep.includes(l.employeeId)).map((l) => l.id);
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
        if (item.code === 'BASE' || item.code === 'FALTAS' || item.code === 'FERNG' || item.code === 'FERPROP') t.baseMinor += item.amountMinor;
        else if (item.code === 'SUBFER' || item.code === 'SUBNAT' || item.code === 'SUBFERPROP') t.holidayChristmasMinor += item.amountMinor;
        else if (item.code === 'COMP' || item.code === 'COMPEXC' || item.code === 'AVISO') t.terminationMinor = (t.terminationMinor ?? 0) + item.amountMinor;
        else if (item.code === 'HE' || item.code.startsWith('BONUS')) t.overtimeAndBonusMinor += item.amountMinor;
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
