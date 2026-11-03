import { describe, expect, it } from 'vitest';
import { formatAmount, formatDecimal, formatPercent } from '../src/index.js';

describe('formatação de montantes e percentagens', () => {
  it('montantes por inteiro com milhares e duas casas', () => {
    expect(formatAmount(550000000).replace(/\s/g, ' ')).toBe('5 500 000,00');
    expect(formatAmount(123456).replace(/\s/g, ' ')).toBe('1 234,56');
  });
  it('percentagens com vírgula, milhares e sem «-0,0%»', () => {
    expect(formatPercent(45.25)).toBe('45,3%');
    expect(formatPercent(-0.04)).toBe('0,0%');
    expect(formatPercent(1234.5).replace(/\s/g, ' ')).toBe('1 234,5%');
    expect(formatPercent(2.5, 1, true)).toBe('+2,5%');
    expect(formatPercent(-2.5, 1, true)).toBe('-2,5%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(100, 0)).toBe('100%');
    expect(formatDecimal(3.456)).toBe('3,46');
  });
});
