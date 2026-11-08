import { describe, expect, it } from 'vitest';
import { formatAmount, formatDecimal, formatPercent } from '../src/index.js';

describe('formatação de montantes e percentagens', () => {
  it('montantes por inteiro com milhares e duas casas', () => {
    expect(formatAmount(550000000).replace(/\s/g, ' ')).toBe('5 500 000,00');
    expect(formatAmount(123456).replace(/\s/g, ' ')).toBe('1 234,56');
  });
  it('percentagens com vírgula, milhares, duas casas por omissão e sem «-0,00%»', () => {
    expect(formatPercent(45.256)).toBe('45,26%');
    expect(formatPercent(-0.004)).toBe('0,00%');
    expect(formatPercent(1234.5).replace(/\s/g, ' ')).toBe('1 234,50%');
    expect(formatPercent(2.5, 1, true)).toBe('+2,5%');
    expect(formatPercent(-2.5, 1, true)).toBe('-2,5%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(100, 0)).toBe('100%');
    expect(formatDecimal(3.456)).toBe('3,46');
  });
});
