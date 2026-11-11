/**
 * Diagnóstico de crédito do Integra, único para o painel, a vista de crédito, os relatórios e o memorando.
 *
 * - O DSCR exigido pelo covenant é medido no período de reembolso (anos com amortização de capital).
 * - Os anos de carência (só juros) são avaliados à parte: um DSCR abaixo de 1 nesses anos é uma necessidade
 *   de liquidez a cobrir (suprimentos, conta de reserva), não a medida da capacidade de reembolso.
 * - Todos os covenants modelados (DSCR, dívida líquida/EBITDA, EBITDA/juros) entram na conclusão.
 * - A linguagem é condicional: o resultado é uma leitura do modelo, não uma decisão de crédito.
 */
import type { FinancialAssumptions as FinancialModel, FinancialResult } from './types.js';

export type CreditLevel = 'g' | 'a' | 'r';
export interface CreditDiagnosis {
  level: CreditLevel;
  title: string;
  /** DSCR mínimo nos anos de reembolso de capital (null se não houver reembolso no horizonte). */
  repaymentDscr: number | null;
  /** DSCR mínimo nos anos só com juros (carência), se existirem. */
  graceDscr: number | null;
  /** Anos (calendário) com algum covenant em incumprimento no período de reembolso. */
  breachYears: number[];
  /** Condições que o modelo sugere para a operação ser aceitável. */
  conditions: string[];
}

const x = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2).replace('.', ',')}x`);

export function creditDiagnosis(m: FinancialModel, r: FinancialResult): CreditDiagnosis | null {
  if (!r.hasDebt) return null;
  const rep = r.repY.map((t) => r.k.dscr[t]).filter((v): v is number => v != null);
  const repSet = new Set(r.repY);
  const grace = r.serviceYears.filter((t) => !repSet.has(t)).map((t) => r.k.dscr[t]).filter((v): v is number => v != null);
  const repaymentDscr = rep.length ? Math.min(...rep) : null, graceDscr = grace.length ? Math.min(...grace) : null;
  const breaches = r.covenants.filter((c, i) => repSet.has(i + 1) && (c.dscr === false || c.ndEbitda === false || c.icr === false));
  const conditions: string[] = [];
  const debtAtHorizon = r.k.debt[r.H] ?? 0;
  if (debtAtHorizon > 0) {
    const end = m.anoBase + Math.max(m.divida.montante > 0 ? m.divida.ano + m.divida.prazo : 0,
      m.inicio === 'existente' && m.abertura.divida > 0 ? m.abertura.divPrazo : 0);
    const amount = debtAtHorizon.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
    conditions.push(`demonstrar o reembolso ou refinanciamento dos ${amount} remanescentes na moeda do projecto em ${r.years[r.H]}, com calendário até ${end}`);
  } else if (repaymentDscr == null) conditions.push('demonstrar a cobertura dos reembolsos: o DSCR do período de reembolso não é calculável');
  if (repaymentDscr != null && repaymentDscr < m.cov.dscr) conditions.push(`ajustar o prazo, a carência ou o montante para que o DSCR no reembolso atinja ${x(m.cov.dscr)} (mínimo modelado ${x(repaymentDscr)})`);
  if (graceDscr != null && graceDscr < 1) conditions.push(`cobrir os juros do período de carência com suprimentos, capital ou conta de reserva (DSCR mínimo na carência ${x(graceDscr)})`);
  if (breaches.some((c) => c.ndEbitda === false)) conditions.push(`reduzir a alavancagem para dívida líquida/EBITDA ≤ ${x(m.cov.ndEbitda)} em ${breaches.filter((c) => c.ndEbitda === false).map((c) => c.year).join(', ')}`);
  if (breaches.some((c) => c.icr === false)) conditions.push(`reforçar a cobertura de juros (EBITDA/juros ≥ ${x(m.cov.icr)}) em ${breaches.filter((c) => c.icr === false).map((c) => c.year).join(', ')}`);
  if (r.fundingGap > 0) conditions.push('assegurar o capital adicional que o modelo identifica como necessário');
  const level: CreditLevel = repaymentDscr != null && repaymentDscr < 1 ? 'r' : conditions.length ? 'a' : 'g';
  const title = level === 'r' ? 'Não bancável na estrutura proposta: o fluxo do reembolso não cobre o serviço da dívida'
    : debtAtHorizon > 0 ? 'Análise de crédito incompleta: há dívida para além do horizonte'
    : level === 'a' ? 'Potencialmente bancável, com condições' : 'Bancável nos pressupostos do modelo — cumpre os covenants modelados';
  return { level, title, repaymentDscr, graceDscr, breachYears: breaches.map((c) => c.year), conditions };
}

/** Texto de apoio (pt-PT) para o painel e os relatórios. */
export function creditDiagnosisText(m: FinancialModel, r: FinancialResult, d: CreditDiagnosis): string {
  const parts = [`DSCR mínimo no reembolso ${x(d.repaymentDscr)} (covenant ${x(m.cov.dscr)})`];
  if (d.graceDscr != null) parts.push(`na carência ${x(d.graceDscr)}`);
  parts.push(`médio ${x(r.avgDscr)}; LLCR ${x(r.llcr)}`);
  return parts.join('; ') + '.' + (d.conditions.length ? ` Condições indicadas pelo modelo: ${d.conditions.join('; ')}.` : '');
}
