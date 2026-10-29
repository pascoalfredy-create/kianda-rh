import { getPack, luandaDate, OBLIGATION_LABEL, paymentJournal, payrollObligations, type ObligationKind } from '@kianda/core';
import {
  and, auditLogs, like, bankAccounts, expenseClaims, bankLines, bankMatches, eq, inArray, sql, journalEntries, journalLines, payrollLines, payrollPayments, payrollRuns, type Db,
} from '@kianda/db';
import { groupBy } from '../lib/group-by.js';
import { companyAccounts, DomainError } from './payroll.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export const KIND_CODE: Record<ObligationKind, string> = { salaries: 'SAL', inss: 'INSS', irt: 'IRT' };

export async function runTotals(db: Db | Tx, runId: string) {
  return (await totalsForRuns(db, [runId])).get(runId) ?? emptyTotals();
}

const emptyTotals = () => ({ netMinor: 0, irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0 });
async function totalsForRuns(db: Db | Tx, ids: string[]) {
  const rows = await db.select({ runId: payrollLines.runId,
    netMinor: sql`sum(${payrollLines.netMinor})`.mapWith(Number), irtMinor: sql`sum(${payrollLines.irtMinor})`.mapWith(Number),
    inssEmployeeMinor: sql`sum(${payrollLines.inssEmployeeMinor})`.mapWith(Number), inssEmployerMinor: sql`sum(${payrollLines.inssEmployerMinor})`.mapWith(Number),
  }).from(payrollLines).where(inArray(payrollLines.runId, ids)).groupBy(payrollLines.runId);
  return new Map(rows.map(({ runId, ...totals }) => [runId, totals]));
}

export function obligationAmount(kind: ObligationKind, t: Awaited<ReturnType<typeof runTotals>>) {
  return kind === 'salaries' ? t.netMinor : kind === 'irt' ? t.irtMinor : t.inssEmployeeMinor + t.inssEmployerMinor;
}

export async function obligationsFor(db: Db, run: typeof payrollRuns.$inferSelect) {
  return (await obligationsForRuns(db, [run]))[0]!.obligations;
}

/** Duas leituras para todos os meses, sem transferir os recibos completos para obter totais. */
export async function obligationsForRuns(db: Db, runs: (typeof payrollRuns.$inferSelect)[]) {
  if (!runs.length) return [];
  const ids = runs.map(r => r.id);
  const [paymentRows, totals] = await Promise.all([
    db.select().from(payrollPayments).where(inArray(payrollPayments.runId, ids)), totalsForRuns(db, ids),
  ]);
  const paymentsByRun = groupBy(paymentRows, p => p.runId), today = luandaDate(new Date());
  return runs.map(run => {
    const payments = paymentsByRun.get(run.id) ?? [];
    const paid = Object.fromEntries(payments.map(p => [p.kind, p.paidOn]));
    const items = payrollObligations({ period: run.period, pack: getPack('AO', Number(run.period.slice(0, 4))), ...(totals.get(run.id) ?? emptyTotals()), paid, today });
    return { runId: run.id, period: run.period, obligations: items.map(o => {
      const p = payments.find(x => x.kind === o.kind);
      return { ...o, reference: p?.reference ?? null, reconciled: p ? Boolean(p.matchId) : null };
    }) };
  });
}

export async function closedRun(db: Db, companyId: string, id: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, companyId)));
  if (!run) throw new DomainError('nao_encontrado', 'Processamento inexistente', 404);
  if (run.status !== 'closed') throw new DomainError('processamento_aberto', 'O processamento ainda não está fechado');
  return run;
}

interface Actor { companyId: string; actorId: string }

/**
 * Regista o pagamento de uma obrigação e gera o lançamento PGC (dívida a débito, banco a crédito).
 * Com `bankAccountId`, o crédito vai para a conta PGC dessa conta bancária. `within` corre na mesma transacção
 * (usado pela conciliação para associar o movimento do extracto).
 */
export async function registerPayment(
  db: Db, actor: Actor, run: typeof payrollRuns.$inferSelect,
  input: { kind: ObligationKind; paidOn: string; reference?: string | null; bankAccountId?: string | null; expectedAmountMinor?: number },
  within?: (tx: Tx, payment: typeof payrollPayments.$inferSelect) => Promise<void>,
) {
  const { kind, paidOn } = input;
  if (paidOn > luandaDate(new Date())) throw new DomainError('data_futura', 'A data de pagamento não pode ser futura', 400);
  if (paidOn < `${run.period}-01`) throw new DomainError('data_invalida', 'A data de pagamento é anterior ao mês processado', 400);
  const [exists] = await db.select({ id: payrollPayments.id }).from(payrollPayments).where(and(eq(payrollPayments.runId, run.id), eq(payrollPayments.kind, kind)));
  if (exists) throw new DomainError('ja_pago', `${OBLIGATION_LABEL[kind]} de ${run.period} já está registado como pago`);
  const amount = obligationAmount(kind, await runTotals(db, run.id));
  if (input.expectedAmountMinor !== undefined && input.expectedAmountMinor !== amount) {
    throw new DomainError('valor_diferente', `O valor do extracto não coincide com ${OBLIGATION_LABEL[kind]} de ${run.period}`, 400);
  }
  const acc = await companyAccounts(db, actor.companyId);
  let bankAccountId = input.bankAccountId ?? null;
  if (!bankAccountId) {
    const [first] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, actor.companyId), eq(bankAccounts.active, true))).limit(2);
    bankAccountId = first?.id ?? null;
  } else {
    const [ba] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, actor.companyId)));
    if (!ba) throw new DomainError('conta_inexistente', 'Conta bancária inexistente', 404);
    acc.bank = ba.ledgerAccount;
  }
  const payable = kind === 'salaries' ? acc.netPayable : kind === 'irt' ? acc.irtPayable : acc.socialSecurityPayable;
  // Depois de um estorno a referência original já existe: o novo pagamento leva sufixo (-2, -3…).
  const base = `PG-${KIND_CODE[kind]}-${run.period.replace('-', '')}`;
  const used = await db.select({ r: journalEntries.reference }).from(journalEntries).where(and(eq(journalEntries.companyId, actor.companyId), like(journalEntries.reference, `${base}%`)));
  const ref = used.length ? `${base}-${used.length + 1}` : base;
  const entry = paymentJournal(paidOn, ref, `Pagamento ${OBLIGATION_LABEL[kind]} ${run.period}${input.reference ? ` (${input.reference})` : ''}`, payable, amount, acc);
  const payment = await db.transaction(async (tx) => {
    const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'payroll_payment' }).returning();
    await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
    const [p] = await tx.insert(payrollPayments).values({ companyId: actor.companyId, runId: run.id, kind, paidOn, amountMinor: amount, reference: input.reference ?? null, journalEntryId: je!.id, bankAccountId, createdBy: actor.actorId }).returning();
    const col = kind === 'salaries' ? { paidSalariesAt: paidOn } : kind === 'irt' ? { paidIrtAt: paidOn } : { paidInssAt: paidOn };
    await tx.update(payrollRuns).set(col).where(eq(payrollRuns.id, run.id));
    await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'pay', entity: 'payroll_run', entityId: run.id, after: { ...p, journal: ref } });
    if (within) await within(tx, p!);
    return p!;
  });
  return { ...payment, journalReference: ref };
}

/** Desfaz uma correspondência: os movimentos voltam a "por conciliar" e o pagamento fica sem comprovativo. */
export async function undoMatch(tx: Tx, companyId: string, matchId: string) {
  await tx.update(bankLines).set({ status: 'pending', matchId: null }).where(and(eq(bankLines.matchId, matchId), eq(bankLines.companyId, companyId)));
  await tx.update(payrollPayments).set({ matchId: null }).where(and(eq(payrollPayments.matchId, matchId), eq(payrollPayments.companyId, companyId)));
  await tx.update(expenseClaims).set({ matchId: null }).where(and(eq(expenseClaims.matchId, matchId), eq(expenseClaims.companyId, companyId)));
  await tx.delete(bankMatches).where(and(eq(bankMatches.id, matchId), eq(bankMatches.companyId, companyId)));
}
