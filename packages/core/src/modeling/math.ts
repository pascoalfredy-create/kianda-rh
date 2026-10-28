import type { IrrResult } from './types.js';

/** Inclui CF0, ao contrário da função VPL/NPV do Excel (nesta: CF0 + NPV(taxa, CF1:CFn)). */
export function financialNpv(rate: number, flows: readonly number[]): number {
  if (!Number.isFinite(rate) || rate <= -1 || flows.some((v) => !Number.isFinite(v))) throw new RangeError('Taxa ou fluxos inválidos');
  let total = 0, correction = 0;
  for (let i = 0; i < flows.length; i++) {
    const value = flows[i]! / (1 + rate) ** i - correction;
    const next = total + value;
    correction = (next - total) - value;
    total = next;
  }
  return total;
}

/** TIR única para fluxos convencionais. Não escolhe arbitrariamente uma raiz de fluxos com múltiplas mudanças de sinal. */
export function financialIrr(flows: readonly number[]): IrrResult {
  if (flows.some((v) => !Number.isFinite(v))) throw new RangeError('Fluxos inválidos');
  const nonzero = flows.filter((v) => v !== 0);
  let changes = 0;
  for (let i = 1; i < nonzero.length; i++) if (Math.sign(nonzero[i]!) !== Math.sign(nonzero[i - 1]!)) changes++;
  if (!changes) return { value: null, status: 'no_sign_change' };
  if (changes > 1) return { value: null, status: 'non_conventional' };
  const scale = Math.max(...flows.map(Math.abs));
  // y=ln(1+r) permite pesquisar também TIR negativas muito próximas de -100%.
  const f = (y: number) => {
    const q = Math.exp(-y);
    let sum = 0;
    for (let i = flows.length - 1; i >= 0; i--) sum = sum * q + flows[i]! / scale;
    return sum;
  };
  let lo = -30, hi = 30;
  let flo = f(lo);
  if (Math.sign(flo) === Math.sign(f(hi))) return { value: null, status: 'outside_range' };
  for (let i = 0; i < 220 && hi - lo > 1e-13; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (fm === 0) return { value: Math.expm1(mid), status: 'ok' };
    if (Math.sign(flo) === Math.sign(fm)) { lo = mid; flo = fm; } else hi = mid;
  }
  return { value: Math.expm1((lo + hi) / 2), status: 'ok' };
}

/** Payback dos fluxos explícitos, sem atribuir ao valor terminal uma recuperação operacional. */
export function financialPayback(flows: readonly number[]): number | null {
  let cumulative = 0, invested = false;
  for (let t = 0; t < flows.length; t++) {
    const previous = cumulative;
    cumulative += flows[t]!;
    if (cumulative < 0) invested = true;
    if (invested && t > 0 && previous < 0 && cumulative >= 0) return t - 1 - previous / flows[t]!;
  }
  return null;
}

/** Duração explícita: nunca interpretar 1,11 anos decimais como 1 ano e 11 meses. */
export function financialDuration(years: number | null): { years: number; months: number; totalMonths: number } | null {
  if (years === null) return null;
  const totalMonths = Math.ceil(years * 12 - 1e-9);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, totalMonths };
}
