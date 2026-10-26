import { createHash } from 'node:crypto';
import { calculatePayroll, compensationAt, getPack, lastDayOfMonth, payrollJournal, type PayrollResult, type PayrollTotals } from '@kianda/core';
import { auditLogs, compensationChanges, contracts, departments, employees, journalEntries, journalLines, payrollLines, payrollRuns, type Db } from '@kianda/db';
import { and, desc, eq } from '@kianda/db';

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Cria (ou recalcula) o processamento em rascunho do período para todos os colaboradores activos. */
export async function draftPayroll(db: Db, companyId: string, period: string, actorId: string) {
  if (!periodRe.test(period)) throw new DomainError('periodo_invalido', 'Período inválido (AAAA-MM)', 400);
  const pack = getPack('AO', Number(period.slice(0, 4)));
  return db.transaction(async (tx) => {
    let [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period)));
    if (run?.status === 'closed') throw new DomainError('processamento_fechado', 'O processamento deste período já está fechado');
    run ??= (await tx.insert(payrollRuns).values({ companyId, period, packVersion: pack.version, preparedBy: actorId }).returning())[0]!;
    if (run.preparedBy !== actorId) [run] = await tx.update(payrollRuns).set({ preparedBy: actorId }).where(eq(payrollRuns.id, run.id)).returning() as [typeof run];

    const staff = await tx.select({ e: employees, c: contracts }).from(employees)
      .innerJoin(contracts, eq(contracts.employeeId, employees.id))
      .where(and(eq(employees.companyId, companyId), eq(employees.status, 'active')))
      .orderBy(employees.number, desc(contracts.startDate));
    const comp = await tx.select().from(compensationChanges).where(eq(compensationChanges.companyId, companyId));
    const periodStart = `${period}-01`;
    const periodEnd = lastDayOfMonth(period);
    const seen = new Set<string>();
    const results: { employeeId: string; r: PayrollResult }[] = [];
    for (const { e, c } of staff) {
      if (seen.has(e.id)) continue;
      if (c.startDate > periodEnd) continue; // contrato futuro: usa o contrato anterior (se existir)
      seen.add(e.id);
      const ended = c.terminatedAt ?? c.endDate;
      if (ended && ended < periodStart) continue; // contrato já terminado
      // Remuneração em vigor no último dia do mês (histórico com data de efeito); sem histórico, valores do contrato.
      const pay = compensationAt(comp.filter((x) => x.employeeId === e.id), periodEnd) ?? c;
      const r = calculatePayroll({ period, pack, baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor, christmasSubsidy: period.endsWith('-12') });
      const hash = createHash('sha256').update(JSON.stringify({ period, packVersion: r.packVersion, contract: c.id, pay: { base: pay.baseMinor, meal: pay.mealMinor, transport: pay.transportMinor }, lines: r.lines })).digest('hex');
      await tx.insert(payrollLines).values({
        runId: run.id, employeeId: e.id, grossMinor: r.grossMinor, inssEmployeeMinor: r.inssEmployeeMinor, irtMinor: r.irtMinor, netMinor: r.netMinor,
        inssEmployerMinor: r.inssEmployerMinor, irtBracket: r.irtBracket, breakdown: r.lines, calculationHash: hash,
      }).onConflictDoUpdate({
        target: [payrollLines.runId, payrollLines.employeeId],
        set: { grossMinor: r.grossMinor, inssEmployeeMinor: r.inssEmployeeMinor, irtMinor: r.irtMinor, netMinor: r.netMinor, inssEmployerMinor: r.inssEmployerMinor, irtBracket: r.irtBracket, breakdown: r.lines, calculationHash: hash },
      });
      results.push({ employeeId: e.id, r });
    }
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'draft', entity: 'payroll_run', entityId: run.id, after: { period, employees: results.length } });
    return { run, lines: results.length };
  });
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
    const totals: PayrollTotals = { byCostCenter: [], irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0, advancesMinor: 0, netMinor: 0 };
    for (const { l, cc } of lines) {
      const key = cc ?? 'SEM-CC';
      const t = byCc.get(key) ?? { costCenter: key, baseMinor: 0, allowancesMinor: 0, overtimeAndBonusMinor: 0, holidayChristmasMinor: 0, employerInssMinor: 0 };
      for (const item of l.breakdown as { code: string; kind: string; amountMinor: number }[]) {
        if (item.kind !== 'earning') continue;
        if (item.code === 'BASE' || item.code === 'FALTAS') t.baseMinor += item.amountMinor;
        else if (item.code === 'SUBFER' || item.code === 'SUBNAT') t.holidayChristmasMinor += item.amountMinor;
        else if (item.code === 'HE' || item.code.startsWith('BONUS')) t.overtimeAndBonusMinor += item.amountMinor;
        else t.allowancesMinor += item.amountMinor;
      }
      t.employerInssMinor += l.inssEmployerMinor;
      byCc.set(key, t);
      totals.irtMinor += l.irtMinor;
      totals.inssEmployeeMinor += l.inssEmployeeMinor;
      totals.inssEmployerMinor += l.inssEmployerMinor;
      totals.advancesMinor += l.advancesMinor;
      totals.netMinor += l.netMinor;
    }
    totals.byCostCenter = [...byCc.values()];
    const entry = payrollJournal(run.period, totals);
    const [je] = await tx.insert(journalEntries).values({ companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'payroll' }).returning();
    await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, costCenter: l.costCenter, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
    const [closed] = await tx.update(payrollRuns).set({ status: 'closed', closedAt: new Date(), closedBy: actorId }).where(eq(payrollRuns.id, run.id)).returning();
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'close', entity: 'payroll_run', entityId: run.id, before: run, after: closed });
    return { run: closed, journalReference: entry.reference, totals };
  });
}
