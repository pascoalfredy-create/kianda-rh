import { lastDayOfMonth } from './calendar.js';
import { sum, type Minor } from './money.js';

/**
 * Lançamentos do processamento salarial segundo o PGC Angola (Decreto n.º 82/2001).
 * Classe 7 = Custos e perdas por natureza; Classe 6 = Proveitos e ganhos.
 * As contas são parametrizáveis — os códigos abaixo são sugestões.
 */
export interface PgcAccountMap {
  baseSalary: string;
  allowances: string;
  overtimeAndBonus: string;
  holidayChristmas: string;
  employerSocialSecurity: string;
  irtPayable: string;
  socialSecurityPayable: string;
  netPayable: string;
  advances: string;
  /** Outros descontos retidos (empréstimos ao trabalhador, quotizações, seguros…). */
  otherDeductions: string;
  bank: string;
  /** Despesas do pessoal reembolsadas (deslocações, alojamento, refeições…). */
  staffExpenses: string;
  /** Ajudas de custo (diárias). */
  perDiem: string;
  /** Reembolsos de despesas e ajudas de custo a pagar ao pessoal. */
  expensesPayable: string;
}

export const DEFAULT_PGC_ACCOUNTS: PgcAccountMap = {
  baseSalary: '72.2.1',
  allowances: '72.2.2',
  overtimeAndBonus: '72.2.3',
  holidayChristmas: '72.2.4',
  employerSocialSecurity: '72.5.1',
  irtPayable: '34.3',
  socialSecurityPayable: '34.9.1',
  netPayable: '36.1.2',
  advances: '36.3',
  otherDeductions: '36.9',
  bank: '43.1',
  staffExpenses: '75.2',
  perDiem: '72.8',
  expensesPayable: '36.9',
};

export interface JournalLine { account: string; description: string; costCenter?: string; debitMinor: Minor; creditMinor: Minor }
export interface JournalEntry { date: string; journal: string; reference: string; description: string; lines: JournalLine[] }

export interface PayrollTotalsByCostCenter {
  costCenter: string;
  baseMinor: Minor;
  allowancesMinor: Minor;
  overtimeAndBonusMinor: Minor;
  holidayChristmasMinor: Minor;
  employerInssMinor: Minor;
}

export interface PayrollTotals {
  byCostCenter: PayrollTotalsByCostCenter[];
  irtMinor: Minor;
  inssEmployeeMinor: Minor;
  inssEmployerMinor: Minor;
  advancesMinor: Minor;
  otherDeductionsMinor?: Minor;
  netMinor: Minor;
}

export class UnbalancedEntryError extends Error {}

export function assertBalanced(e: JournalEntry): JournalEntry {
  const d = sum(...e.lines.map((l) => l.debitMinor));
  const c = sum(...e.lines.map((l) => l.creditMinor));
  if (d !== c) throw new UnbalancedEntryError(`Lançamento ${e.reference} desequilibrado: D ${d} ≠ C ${c}`);
  return e;
}

/** Lançamento do processamento: custos (classe 7) por centro de custo contra Estado (34) e Pessoal (36). */
export function payrollJournal(period: string, t: PayrollTotals, accounts: PgcAccountMap = DEFAULT_PGC_ACCOUNTS): JournalEntry {
  const lines: JournalLine[] = [];
  const dr = (account: string, description: string, v: Minor, costCenter: string) => { if (v) lines.push({ account, description, costCenter, debitMinor: v, creditMinor: 0 }); };
  const cr = (account: string, description: string, v: Minor) => { if (v) lines.push({ account, description, debitMinor: 0, creditMinor: v }); };
  for (const c of t.byCostCenter) {
    dr(accounts.baseSalary, `Vencimentos ${period}`, c.baseMinor, c.costCenter);
    dr(accounts.allowances, `Subsídios ${period}`, c.allowancesMinor, c.costCenter);
    dr(accounts.overtimeAndBonus, `Horas extra e prémios ${period}`, c.overtimeAndBonusMinor, c.costCenter);
    dr(accounts.holidayChristmas, `Subsídios de férias/Natal ${period}`, c.holidayChristmasMinor, c.costCenter);
    dr(accounts.employerSocialSecurity, `INSS entidade ${period}`, c.employerInssMinor, c.costCenter);
  }
  cr(accounts.irtPayable, `IRT retido ${period}`, t.irtMinor);
  cr(accounts.socialSecurityPayable, `INSS ${period}`, t.inssEmployeeMinor + t.inssEmployerMinor);
  cr(accounts.advances, `Regularização de adiantamentos ${period}`, t.advancesMinor);
  cr(accounts.otherDeductions, `Outros descontos retidos ${period}`, t.otherDeductionsMinor ?? 0);
  cr(accounts.netPayable, `Remunerações a pagar ${period}`, t.netMinor);
  return assertBalanced({ date: lastDayOfMonth(period), journal: 'Pessoal', reference: `PS-${period.replace('-', '')}`, description: `Processamento salarial ${period}`, lines });
}

/** Lançamento de pagamento (salários, IRT ou INSS) contra a conta bancária. */
export function paymentJournal(date: string, reference: string, description: string, payableAccount: string, amount: Minor, accounts: PgcAccountMap = DEFAULT_PGC_ACCOUNTS): JournalEntry {
  return assertBalanced({ date, journal: 'Bancos', reference, description, lines: [
    { account: payableAccount, description, debitMinor: amount, creditMinor: 0 },
    { account: accounts.bank, description, debitMinor: 0, creditMinor: amount },
  ] });
}
