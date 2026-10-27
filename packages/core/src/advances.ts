import type { Minor } from './money.js';
import type { CountryPack } from './packs/types.js';

/**
 * Adiantamentos salariais (LGT, art. 248.º).
 *
 * - n.º 6: só a pedido escrito do trabalhador; o total em dívida não pode exceder 3 salários base.
 * - n.º 7: os descontos por adiantamentos, empréstimos e bens a crédito não podem, em conjunto, ultrapassar 25% do
 *   salário líquido de cada mês — por isso o reembolso é feito em prestações mensais.
 */

/** Período AAAA-MM somado de n meses. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Prestações iguais (o resto dos cêntimos vai para a última). */
export function advancePlan(amountMinor: Minor, installments: number, firstPeriod: string): { period: string; amountMinor: Minor }[] {
  const n = Math.max(1, Math.floor(installments));
  const each = Math.floor(amountMinor / n);
  return Array.from({ length: n }, (_, i) => ({ period: addMonths(firstPeriod, i), amountMinor: i === n - 1 ? amountMinor - each * (n - 1) : each }));
}

/** Desconto máximo por mês para adiantamentos e outros descontos a crédito: % do salário líquido. */
export const monthlyDeductionCap = (netMinor: Minor, pack: CountryPack): Minor => Math.floor((netMinor * pack.labour.advances.maxNetShareBps) / 10_000);

export interface AdvanceCheckInput {
  amountMinor: Minor;
  installments: number;
  /** Salário base em vigor. */
  baseMinor: Minor;
  /** Salário líquido mensal estimado (depois de INSS e IRT, antes de adiantamentos). */
  netMinor: Minor;
  /** Adiantamentos ainda por reembolsar (outros pedidos aprovados). */
  outstandingMinor: Minor;
  /** Outros descontos a crédito já previstos por mês (prestações de outros adiantamentos, empréstimos, bens a crédito). */
  otherMonthlyDeductionsMinor: Minor;
  pack: CountryPack;
}

export interface AdvanceCheck {
  /** Máximo que ainda pode ser adiantado (3 salários base − em dívida). */
  maxAmountMinor: Minor;
  /** Máximo por prestação (25% do líquido − outros descontos a crédito). */
  maxInstallmentMinor: Minor;
  /** Menor número de prestações que cumpre o limite mensal. */
  minInstallments: number;
  problems: string[];
}

const fmt = (m: Minor) => `${(m / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

export function checkAdvance(i: AdvanceCheckInput): AdvanceCheck {
  const { maxBaseSalaries, maxNetShareBps } = i.pack.labour.advances;
  const maxAmountMinor = Math.max(0, i.baseMinor * maxBaseSalaries - i.outstandingMinor);
  const maxInstallmentMinor = Math.max(0, monthlyDeductionCap(i.netMinor, i.pack) - i.otherMonthlyDeductionsMinor);
  const minInstallments = maxInstallmentMinor > 0 ? Math.ceil(i.amountMinor / maxInstallmentMinor) : Infinity;
  const problems: string[] = [];
  if (i.amountMinor <= 0) problems.push('Indique o valor do adiantamento');
  if (i.amountMinor > maxAmountMinor) {
    problems.push(`O total de adiantamentos não pode exceder ${maxBaseSalaries} salários base (${fmt(i.baseMinor * maxBaseSalaries)})${i.outstandingMinor ? `; já estão em dívida ${fmt(i.outstandingMinor)}` : ''} — máximo agora: ${fmt(maxAmountMinor)} (LGT, art. 248.º, n.º 6)`);
  }
  if (!maxInstallmentMinor) {
    problems.push(`Os descontos a crédito já atingem ${maxNetShareBps / 100}% do salário líquido: não há margem para novas prestações (LGT, art. 248.º, n.º 7)`);
  } else if (i.amountMinor > 0 && Math.ceil(i.amountMinor / Math.max(1, i.installments)) > maxInstallmentMinor) {
    problems.push(`Cada prestação não pode passar de ${fmt(maxInstallmentMinor)} (${maxNetShareBps / 100}% do líquido${i.otherMonthlyDeductionsMinor ? ', descontados outros descontos a crédito' : ''}) — são precisas pelo menos ${minInstallments} prestações (LGT, art. 248.º, n.º 7)`);
  }
  return { maxAmountMinor, maxInstallmentMinor, minInstallments: Number.isFinite(minInstallments) ? minInstallments : 0, problems };
}
