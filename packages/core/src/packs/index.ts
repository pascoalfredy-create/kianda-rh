import { AO_2026 } from './ao-2026.js';
export { AO_2026 };
import { angolaHolidays } from '../holidays.js';
import type { CountryPack } from './types.js';
export type { CountryPack, IrtBracket, Holiday } from './types.js';

const PACKS: Record<string, CountryPack> = { 'AO-2026': AO_2026 };

export class PackNotFoundError extends Error {
  constructor(public readonly country: string, public readonly year: number) {
    super(`Não existe pacote de regras ${country} para ${year}. Publique a tabela desse ano antes de processar.`);
    this.name = 'PackNotFoundError';
  }
}

/** Devolve o pacote de regras do ano. Nunca reutiliza silenciosamente o ano anterior. */
export function getPack(country: 'AO', year: number): CountryPack {
  const pack = PACKS[`${country}-${year}`];
  if (!pack) throw new PackNotFoundError(country, year);
  return pack;
}

/**
 * Regras LABORAIS de um ano (férias, licenças, feriados) — para planeamento de ausências.
 * Usa o pacote do ano se existir; senão o mais recente anterior, com os feriados gerados para o ano pedido.
 * NUNCA usar para cálculos fiscais (IRT/INSS/salário mínimo): para isso, getPack (estrito).
 */
export function labourRules(country: 'AO', year: number): CountryPack {
  const exact = PACKS[`${country}-${year}`];
  if (exact) return exact;
  const years = Object.values(PACKS).filter((p) => p.country === country).map((p) => p.year).sort((a, b) => a - b);
  const base = PACKS[`${country}-${years.filter((y) => y <= year).at(-1) ?? years[0]}`]!;
  return { ...base, year, version: `${base.version}+calendário-${year}`, holidays: angolaHolidays(year) };
}

/** Pacote para alertas informativos (ex.: salário mínimo na ficha): o do ano, ou o mais recente publicado. */
export function packOrLatest(country: 'AO', year: number): CountryPack {
  const exact = PACKS[`${country}-${year}`];
  if (exact) return exact;
  const years = Object.values(PACKS).filter((p) => p.country === country).map((p) => p.year).sort((a, b) => a - b);
  return PACKS[`${country}-${years.filter((y) => y <= year).at(-1) ?? years[0]}`]!;
}

/** Regista um pacote (ex.: AO-2027 quando o OGE for publicado), validando a tabela de IRT. */
export function registerPack(pack: CountryPack): void {
  const br = pack.irt.brackets;
  if (!br.length) throw new Error('Tabela de IRT vazia');
  for (let i = 1; i < br.length; i++) {
    const prev = br[i - 1]!, cur = br[i]!;
    if (cur[0] <= prev[0] || cur[3] !== prev[0]) throw new Error(`Escalão ${i + 1} incoerente com o anterior`);
  }
  PACKS[`${pack.country}-${pack.year}`] = pack;
}

export function listPacks(): string[] {
  return Object.keys(PACKS).sort();
}
