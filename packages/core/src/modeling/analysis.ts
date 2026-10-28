import { runFinancialModel } from './engine.js';
import { validateFinancialAssumptions } from './validation.js';
import type { FinancialOverrides, FinancialScenario } from './types.js';

export function financialScenarios(input: unknown) {
  const m = validateFinancialAssumptions(input);
  return Object.fromEntries((['base', 'otim', 'pess'] as const).map((cen) => [cen, runFinancialModel(m, { cen })])) as Record<FinancialScenario, ReturnType<typeof runFinancialModel>>;
}
export function financialSensitivity(input: unknown, cen?: FinancialScenario) {
  const m = validateFinancialAssumptions(input), delta = m.sens / 100;
  return (['preco', 'volume', 'cvar', 'fixos', 'capex', 'wacc'] as const).map((key) => ({
    driver: key, delta: m.sens,
    low: runFinancialModel(m, { cen: cen ?? m.cen, [key]: 1 - delta }).npv,
    high: runFinancialModel(m, { cen: cen ?? m.cen, [key]: 1 + delta }).npv,
  })).map((row) => ({ ...row, impact: Math.abs(row.high - row.low) })).sort((a, b) => b.impact - a.impact);
}
/** Multiplicador do preço que anula o VAL; null se não há raiz no intervalo 0–512 vezes o preço base. */
export function financialBreakEvenPrice(input: unknown, cen?: FinancialScenario): number | null {
  const m = validateFinancialAssumptions(input);
  const f = (preco: number) => runFinancialModel(m, { cen: cen ?? m.cen, preco } as FinancialOverrides).npv;
  let lo = 0, hi = 1, flo = f(lo), fhi = f(hi);
  if (flo === 0) return 0;
  while (Math.sign(flo) === Math.sign(fhi) && hi < 512) { hi *= 2; fhi = f(hi); }
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.sign(flo) === Math.sign(fm)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}
