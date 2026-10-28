import type { FinancialCurrency } from '@kianda/core';
import { DomainError } from './payroll.js';
export interface ModelingExchangeQuote { from: FinancialCurrency; to: FinancialCurrency; rate: number; rateDate: string; source: string; stale: boolean }
const iso = { Kz: 'AOA', USD: 'USD', EUR: 'EUR' };
const cache = new Map<string, { until: number; quote: ModelingExchangeQuote }>();
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** Só envia moedas/data públicas ao fornecedor; nunca envia montantes ou identificadores. */
export async function modelingExchangeQuote(from: FinancialCurrency, to: FinancialCurrency, date?: string): Promise<ModelingExchangeQuote> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const key = `${from}/${to}/${date ?? 'latest'}`, old = cache.get(key);
  if (old && old.until > Date.now()) return { ...old.quote };
  if (from === to) return { from, to, rate: 1, rateDate: date ?? today, source: 'Mesma moeda — taxa 1', stale: false };
  try {
    if (date && (!validDate(date) || date > today)) throw Error('Data inválida');
    const url = `https://api.frankfurter.dev/v2/providers/bna/rate/${iso[from].toLowerCase()}/${iso[to].toLowerCase()}${date ? '?date=' + date : ''}`;
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(7000), redirect: 'error' });
    if (!response.ok) throw Error('Referência indisponível');
    const q = await response.json() as Record<string, unknown>;
    if (q.base !== iso[from] || q.quote !== iso[to] || typeof q.rate !== 'number' || !Number.isFinite(q.rate) || q.rate <= 0 || q.rate > 1e12 || !validDate(q.date) || q.date > today || date && q.date > date) throw Error('Referência inválida');
    const quote: ModelingExchangeQuote = { from, to, rate: q.rate, rateDate: q.date, source: 'BNA via Frankfurter (referência)', stale: Date.parse(today) - Date.parse(q.date) > 7 * 86400000 };
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { quote, until: Date.now() + 3600000 });
    return { ...quote };
  } catch { throw new DomainError('cambio_indisponivel', 'Não foi possível obter a referência BNA. Indique a taxa, data e fonte que pretende utilizar.', 503); }
}
