import type { Minor } from './money.js';
import { assertBalanced, DEFAULT_PGC_ACCOUNTS, type JournalEntry, type JournalLine, type PgcAccountMap } from './pgc.js';

/**
 * Despesas e ajudas de custo do pessoal.
 *
 * Uma nota de despesas junta as despesas documentadas (com recibo/factura) e as ajudas de custo (diárias) de uma
 * deslocação ou de um período. O reembolso de despesas documentadas não é rendimento do trabalhador; as ajudas de
 * custo ficam fora do IRT e do INSS até à diária fixada pela empresa (limite legal a confirmar — ver toValidate).
 */

export const EXPENSE_CATEGORIES = {
  transport: 'Transporte e deslocações',
  lodging: 'Alojamento',
  meals: 'Refeições',
  fuel: 'Combustível',
  communications: 'Comunicações',
  other: 'Outras despesas',
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export type PerDiemZone = 'national' | 'international';
export const PER_DIEM_ZONE: Record<PerDiemZone, string> = { national: 'Diária — território nacional', international: 'Diária — estrangeiro' };

export interface ExpenseLineInput {
  kind: 'expense' | 'per_diem';
  date: string;
  description: string;
  /** Despesas: categoria. */
  category?: ExpenseCategory;
  /** Despesas: valor do documento. */
  amountMinor?: Minor;
  /** Despesas: n.º do recibo ou factura (obrigatório). */
  documentRef?: string | null;
  supplierNif?: string | null;
  /** Ajudas de custo: zona, dias (múltiplos de meio dia) e diária. */
  zone?: PerDiemZone;
  days?: number;
  rateMinor?: Minor;
}

export interface ExpenseLine extends ExpenseLineInput { amountMinor: Minor }

export interface PerDiemRates { national: Minor | null; international: Minor | null }

/** Valor de cada linha: o documento para despesas; dias × diária (arredondado ao cêntimo) para ajudas de custo. */
export function lineAmount(l: ExpenseLineInput): Minor {
  if (l.kind === 'per_diem') return Math.round((l.days ?? 0) * (l.rateMinor ?? 0));
  return l.amountMinor ?? 0;
}

export function claimTotals(lines: ExpenseLineInput[]) {
  const expensesMinor = lines.filter((l) => l.kind === 'expense').reduce((s, l) => s + lineAmount(l), 0);
  const perDiemMinor = lines.filter((l) => l.kind === 'per_diem').reduce((s, l) => s + lineAmount(l), 0);
  return { expensesMinor, perDiemMinor, totalMinor: expensesMinor + perDiemMinor };
}

const DAY = 86_400_000;

/** Problemas que impedem submeter a nota (lista vazia = pode seguir). */
export function claimProblems(lines: ExpenseLineInput[], opts: { today: string; rates: PerDiemRates; maxAgeDays?: number }): string[] {
  const out: string[] = [];
  if (!lines.length) out.push('A nota não tem linhas');
  const maxAge = opts.maxAgeDays ?? 120;
  lines.forEach((l, i) => {
    const n = `Linha ${i + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date)) out.push(`${n}: data inválida`);
    else if (l.date > opts.today) out.push(`${n}: data futura`);
    else if ((Date.parse(opts.today) - Date.parse(l.date)) / DAY > maxAge) out.push(`${n}: despesa com mais de ${maxAge} dias`);
    if (!l.description.trim()) out.push(`${n}: indique a descrição`);
    if (l.kind === 'expense') {
      if (!l.category || !(l.category in EXPENSE_CATEGORIES)) out.push(`${n}: escolha a categoria`);
      if (!l.amountMinor || l.amountMinor <= 0) out.push(`${n}: valor tem de ser positivo`);
      if (!l.documentRef?.trim()) out.push(`${n}: indique o n.º do recibo ou factura`);
    } else {
      if (!l.zone || !(l.zone in PER_DIEM_ZONE)) out.push(`${n}: indique se a deslocação é nacional ou no estrangeiro`);
      if (!l.days || l.days <= 0 || Math.round(l.days * 2) !== l.days * 2) out.push(`${n}: dias em múltiplos de meio dia`);
      if (!l.rateMinor || l.rateMinor <= 0) out.push(`${n}: indique a diária`);
      const max = l.zone ? opts.rates[l.zone] : null;
      if (max !== null && l.rateMinor && l.rateMinor > max) out.push(`${n}: diária acima da fixada pela empresa`);
    }
  });
  return out;
}

/** Aprovação: custo (classe 7) contra a dívida ao trabalhador (classe 3). */
export function expenseApprovalJournal(date: string, reference: string, description: string, lines: ExpenseLineInput[], costCenter: string | undefined, accounts: PgcAccountMap = DEFAULT_PGC_ACCOUNTS): JournalEntry {
  const t = claimTotals(lines);
  const out: JournalLine[] = [];
  if (t.expensesMinor) out.push({ account: accounts.staffExpenses, description: `Despesas ${description}`, costCenter, debitMinor: t.expensesMinor, creditMinor: 0 });
  if (t.perDiemMinor) out.push({ account: accounts.perDiem, description: `Ajudas de custo ${description}`, costCenter, debitMinor: t.perDiemMinor, creditMinor: 0 });
  out.push({ account: accounts.expensesPayable, description: `A reembolsar ${description}`, debitMinor: 0, creditMinor: t.totalMinor });
  return assertBalanced({ date, journal: 'Pessoal', reference, description: `Nota de despesas ${reference} — ${description}`, lines: out });
}
