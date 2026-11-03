/**
 * Salários: moeda do contrato (salário indexado ao dólar) e cálculo inverso do simulador (líquido pretendido → base).
 */
import { calculatePayroll, NegativeNetError, type PayrollInput, type PayrollResult } from './payroll.js';
import type { Minor } from './money.js';

export const SALARY_CURRENCIES = { AOA: 'Kwanza (Kz)', USD: 'Dólar dos EUA (indexado)' } as const;
export type SalaryCurrency = keyof typeof SALARY_CURRENCIES;

const RATE = /^\d{1,7}(?:[.,]\d{1,6})?$/;

/** Câmbio Kz por 1 USD, até 6 casas decimais (aceita vírgula). Devolve null se inválido. */
export function parseFxRate(text: string | number): number | null {
  const s = String(text).trim().replace(/\s/g, '');
  if (!RATE.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return n > 0 ? n : null;
}

/** Converte cêntimos de USD em cêntimos de Kz ao câmbio indicado (arredondado ao cêntimo). */
export function convertUsdMinor(usdMinor: Minor, rate: number): Minor {
  if (!Number.isInteger(usdMinor) || usdMinor < 0) throw new Error('Montante em USD inválido');
  if (!(rate > 0)) throw new Error('Câmbio inválido');
  // Escala inteira para não perder cêntimos em taxas com 6 casas decimais.
  const micro = Math.round(rate * 1_000_000);
  return Math.round((usdMinor * micro) / 1_000_000);
}

const usdFmt = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions);
const rateFmt = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: 'always' } as Intl.NumberFormatOptions);
export const formatUsd = (minor: Minor) => `USD ${usdFmt.format(minor / 100)}`;
export const formatFxRate = (rate: number) => rateFmt.format(rate);

/** Descrição da linha do vencimento base de um salário indexado. */
export const indexedBaseLabel = (usdMinor: Minor, rate: number) => `Vencimento base (${formatUsd(usdMinor)} × ${formatFxRate(rate)} Kz)`;

/**
 * Cálculo inverso: o menor salário base (ao cêntimo) cujo líquido atinge o pretendido, com as mesmas regras do processamento.
 * O líquido cresce com a base (a taxa marginal do IRT fica abaixo de 100%), por isso a pesquisa binária é exacta.
 */
export function baseForNet(input: Omit<PayrollInput, 'baseMinor'>, targetNetMinor: Minor): { baseMinor: Minor; result: PayrollResult } | null {
  const run = (baseMinor: Minor): PayrollResult | null => {
    try { return calculatePayroll({ ...input, baseMinor }); } catch (e) { if (e instanceof NegativeNetError) return null; throw e; }
  };
  const zero = run(0);
  if (zero && zero.netMinor >= targetNetMinor) return { baseMinor: 0, result: zero };
  let lo = 0, hi = Math.max(100, targetNetMinor * 2);
  for (let guard = 0; (run(hi)?.netMinor ?? -Infinity) < targetNetMinor; guard++) {
    if (guard > 40) return null;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((run(mid)?.netMinor ?? -Infinity) >= targetNetMinor) hi = mid; else lo = mid;
  }
  return { baseMinor: hi, result: run(hi)! };
}
