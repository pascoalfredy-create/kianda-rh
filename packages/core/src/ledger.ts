/**
 * Contabilidade do pessoal: plano de contas por função, validação de classes do PGC Angola, balancete e razão.
 * PGC Angola (Decreto n.º 82/2001): classe 3 = terceiros, 4 = meios monetários, 6 = proveitos e ganhos, 7 = custos e perdas.
 */
import type { Minor } from './money.js';
import { DEFAULT_PGC_ACCOUNTS, type PgcAccountMap } from './pgc.js';

export type AccountRole = keyof PgcAccountMap;

/** Descrição funcional de cada papel (editável pela empresa) e classe PGC esperada. */
export const ACCOUNT_ROLES: Record<AccountRole, { label: string; expectedClass: '3' | '4' | '6' | '7'; group: string }> = {
  baseSalary: { label: 'Remunerações do pessoal — vencimento base', expectedClass: '7', group: 'Custos com o pessoal' },
  allowances: { label: 'Remunerações do pessoal — subsídios', expectedClass: '7', group: 'Custos com o pessoal' },
  overtimeAndBonus: { label: 'Remunerações do pessoal — horas extra e prémios', expectedClass: '7', group: 'Custos com o pessoal' },
  holidayChristmas: { label: 'Remunerações do pessoal — subsídios de férias e de Natal', expectedClass: '7', group: 'Custos com o pessoal' },
  employerSocialSecurity: { label: 'Encargos sobre remunerações — INSS entidade empregadora', expectedClass: '7', group: 'Custos com o pessoal' },
  irtPayable: { label: 'Estado — IRT retido a pagar', expectedClass: '3', group: 'Terceiros' },
  socialSecurityPayable: { label: 'Segurança Social — INSS a pagar', expectedClass: '3', group: 'Terceiros' },
  netPayable: { label: 'Pessoal — remunerações a pagar', expectedClass: '3', group: 'Terceiros' },
  advances: { label: 'Pessoal — adiantamentos', expectedClass: '3', group: 'Terceiros' },
  otherDeductions: { label: 'Pessoal — outros (descontos retidos)', expectedClass: '3', group: 'Terceiros' },
  bank: { label: 'Depósitos à ordem — conta de pagamento de salários', expectedClass: '4', group: 'Meios monetários' },
  staffExpenses: { label: 'Fornecimentos e serviços de terceiros — despesas do pessoal reembolsadas', expectedClass: '7', group: 'Despesas e ajudas de custo' },
  perDiem: { label: 'Outros custos com o pessoal — ajudas de custo', expectedClass: '7', group: 'Despesas e ajudas de custo' },
  expensesPayable: { label: 'Pessoal — reembolsos de despesas a pagar', expectedClass: '3', group: 'Despesas e ajudas de custo' },
  terminationCompensation: { label: 'Outros custos com o pessoal — compensações e indemnizações por cessação', expectedClass: '7', group: 'Cessação de contratos' },
  terminationIncome: { label: 'Outros proveitos operacionais — compensação por falta de aviso prévio do trabalhador', expectedClass: '6', group: 'Cessação de contratos' },
};

export const PGC_CLASS_LABEL: Record<string, string> = {
  '1': 'Classe 1 — Meios fixos e investimentos',
  '2': 'Classe 2 — Existências',
  '3': 'Classe 3 — Terceiros',
  '4': 'Classe 4 — Meios monetários',
  '5': 'Classe 5 — Capital e reservas',
  '6': 'Classe 6 — Proveitos e ganhos por natureza',
  '7': 'Classe 7 — Custos e perdas por natureza',
  '8': 'Classe 8 — Resultados',
};

export const accountClass = (code: string) => code.trim().charAt(0);

/** Problema com o código de conta escolhido para um papel (null se estiver bem). */
export function accountMappingProblem(role: AccountRole, code: string): string | null {
  const c = code.trim();
  if (!/^\d{2}(\.\d{1,4}){0,4}$/.test(c)) return 'Código de conta inválido (ex.: 72.2.1)';
  const expected = ACCOUNT_ROLES[role].expectedClass;
  if (accountClass(c) !== expected) return `${ACCOUNT_ROLES[role].label}: a conta deve ser da ${PGC_CLASS_LABEL[expected]} (indicou ${c})`;
  return null;
}

export const DEFAULT_ACCOUNT_MAPPINGS: { role: AccountRole; account: string; label: string }[] =
  (Object.keys(ACCOUNT_ROLES) as AccountRole[]).map((role) => ({ role, account: DEFAULT_PGC_ACCOUNTS[role], label: ACCOUNT_ROLES[role].label }));

export interface LedgerLine { date: string; account: string; debitMinor: Minor; creditMinor: Minor }

export interface TrialBalanceRow {
  account: string;
  class: string;
  openingMinor: Minor; // saldo inicial (devedor positivo, credor negativo)
  debitMinor: Minor;
  creditMinor: Minor;
  closingMinor: Minor;
}

/** Balancete do período [from, to]: saldo inicial (antes de from), movimentos do período e saldo final. */
export function trialBalance(lines: readonly LedgerLine[], from: string, to: string): { rows: TrialBalanceRow[]; totals: { debitMinor: Minor; creditMinor: Minor; balanced: boolean } } {
  const map = new Map<string, TrialBalanceRow>();
  for (const l of lines) {
    if (l.date > to) continue;
    const r = map.get(l.account) ?? { account: l.account, class: accountClass(l.account), openingMinor: 0, debitMinor: 0, creditMinor: 0, closingMinor: 0 };
    if (l.date < from) r.openingMinor += l.debitMinor - l.creditMinor;
    else { r.debitMinor += l.debitMinor; r.creditMinor += l.creditMinor; }
    r.closingMinor = r.openingMinor + r.debitMinor - r.creditMinor;
    map.set(l.account, r);
  }
  const rows = [...map.values()].sort((a, b) => compareAccounts(a.account, b.account));
  const debitMinor = rows.reduce((s, r) => s + r.debitMinor, 0);
  const creditMinor = rows.reduce((s, r) => s + r.creditMinor, 0);
  return { rows, totals: { debitMinor, creditMinor, balanced: debitMinor === creditMinor } };
}

/** Ordenação natural de contas (72.2.10 depois de 72.2.9). */
export function compareAccounts(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Razão de uma conta: movimentos ordenados com saldo acumulado. */
export function accountLedger<T extends LedgerLine>(lines: readonly T[], account: string, from: string, to: string) {
  const own = lines.filter((l) => l.account === account).sort((a, b) => a.date.localeCompare(b.date));
  const opening = own.filter((l) => l.date < from).reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
  let balance = opening;
  const movements = own.filter((l) => l.date >= from && l.date <= to).map((l) => ({ ...l, balanceMinor: (balance += l.debitMinor - l.creditMinor) }));
  return { account, openingMinor: opening, movements, closingMinor: balance };
}
