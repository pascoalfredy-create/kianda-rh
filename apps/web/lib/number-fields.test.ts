import { describe, expect, it } from 'vitest';
import { formatNumberInput, parseNumberInput } from './number-fields';

describe('campos numéricos à portuguesa', () => {
  it('montantes com milhares e duas casas; anos e prazos sem separador', () => {
    expect(formatNumberInput(1600000000, 'capex.0.valor').replace(/\s/g, ' ')).toBe('1 600 000 000,00');
    expect(formatNumberInput(950000000.5, 'capex.1.valor').replace(/\s/g, ' ')).toBe('950 000 000,50');
    expect(formatNumberInput(2027, 'anoBase').replace(/\s/g, ' ')).toBe('2027');
    expect(formatNumberInput(12, 'capex.0.vida').replace(/\s/g, ' ')).toBe('12');
    expect(formatNumberInput(13.5, 'inflacao').replace(/\s/g, ' ')).toBe('13,5');
    expect(formatNumberInput(-0, 'x').replace(/\s/g, ' ')).toBe('0');
  });
  it('lê o formato apresentado e o que a pessoa escreve', () => {
    expect(parseNumberInput('1 600 000 000,00')).toBe(1600000000);
    expect(parseNumberInput('1600000000')).toBe(1600000000);
    expect(parseNumberInput('913.5')).toBe(913.5);
    expect(parseNumberInput('1.600.000')).toBe(1600000);
    expect(parseNumberInput('1.234,56')).toBe(1234.56);
    expect(parseNumberInput('(500,00)')).toBe(-500);
    expect(parseNumberInput('abc')).toBeNaN();
  });
});
