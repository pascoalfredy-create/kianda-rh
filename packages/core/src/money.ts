/**
 * Valores monetários em unidades inteiras (cêntimos de kwanza).
 * Nenhum cálculo usa vírgula flutuante sobre montantes.
 */
export type Minor = number;

export function assertMinor(value: number, label = 'montante'): Minor {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} inválido: tem de ser inteiro em cêntimos`);
  return value;
}

/** Converte kwanzas (podem ter 2 casas decimais) para cêntimos. */
export function kz(value: number): Minor {
  if (!Number.isFinite(value)) throw new RangeError('valor em kwanzas inválido');
  return Math.round(value * 100);
}

/** Converte cêntimos para kwanzas. */
export function toKz(minor: Minor): number {
  return assertMinor(minor) / 100;
}

/** Aplica uma taxa em pontos base (1% = 100 bps) com arredondamento meio-para-cima. */
export function applyBps(base: Minor, bps: number): Minor {
  assertMinor(base, 'base');
  if (!Number.isSafeInteger(bps)) throw new RangeError('taxa inválida');
  const neg = base < 0;
  const r = (BigInt(Math.abs(base)) * BigInt(bps) + 5000n) / 10000n;
  return neg ? -Number(r) : Number(r);
}

/** Proporção a/b de um montante, arredondada ao cêntimo. */
export function prorate(amount: Minor, numerator: number, denominator: number): Minor {
  assertMinor(amount);
  if (denominator <= 0) throw new RangeError('denominador inválido');
  return Math.round((amount * numerator) / denominator);
}

export function sum(...values: Minor[]): Minor {
  return assertMinor(values.reduce((a, b) => a + b, 0), 'soma');
}

const fmt = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions);
/** Formata cêntimos como "1 234,56 Kz". */
export function formatKz(minor: Minor): string {
  return `${fmt.format(toKz(minor))} Kz`;
}
