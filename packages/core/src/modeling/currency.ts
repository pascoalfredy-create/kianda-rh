import { FinancialModelError } from './types.js';
export const FINANCIAL_CURRENCIES = ['Kz', 'USD', 'EUR'] as const;
export type FinancialCurrency = typeof FINANCIAL_CURRENCIES[number];
export interface FinancialCurrencyConversion {
  from: FinancialCurrency; to: FinancialCurrency; storedFrom: FinancialCurrency;
  rate: number; rateDate: string; source: string; appliedAt: string;
}
const fail = (path: string, message: string): never => { throw new FinancialModelError([{ path, message }]); };
/** Só montantes: preços unitários mantêm precisão; o motor arredonda os fluxos a cêntimos. */
export function convertFinancialCurrency(input: Record<string, unknown>, from: FinancialCurrency, to: FinancialCurrency, rate: number): Record<string, unknown> {
  if (!FINANCIAL_CURRENCIES.includes(from) || !FINANCIAL_CURRENCIES.includes(to)) return fail('currency', 'Moeda inválida.');
  if (!Number.isFinite(rate) || rate < 1e-12 || rate > 1e12 || from === to && rate !== 1) return fail('rate', 'Indique uma taxa positiva; a mesma moeda usa taxa 1.');
  const result = structuredClone(input);
  const amount = (o: Record<string, unknown>, key: string, path: string) => {
    const v = o[key]; if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e12) return fail(path, 'Montante inválido para conversão.');
    const n = rate === 1 ? v : Number((v * rate).toPrecision(15));
    if (!Number.isFinite(n) || n > 1e12 || v > 0 && n === 0) return fail(path, 'A conversão ultrapassa o intervalo monetário suportado.');
    o[key] = n;
  };
  for (const key of ['pessoal', 'fst', 'outros', 'capitalInicial', 'caixaMin', 'valorResidualLiquido']) amount(result, key, key);
  for (const [key, fields] of [['divida', ['montante']], ['abertura', ['imob', 'exist', 'clientes', 'caixa', 'fornec', 'divida']]] as const) {
    const object = result[key]; if (object === undefined) continue;
    if (!object || typeof object !== 'object' || Array.isArray(object)) return fail(key, 'Estrutura inválida.');
    for (const field of fields) amount(object as Record<string, unknown>, field, `${key}.${field}`);
  }
  for (const [key, field, max] of [['receitas', 'preco', 100], ['capex', 'valor', 200]] as const) {
    const list = result[key]; if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > max) return fail(key, 'Lista inválida.');
    list.forEach((row, i) => { if (!row || typeof row !== 'object' || Array.isArray(row)) return fail(`${key}.${i}`, 'Linha inválida.'); amount(row, field, `${key}.${i}.${field}`); });
  }
  return result;
}
