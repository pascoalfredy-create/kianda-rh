import { describe, expect, it } from 'vitest';
import { baseForNet, calculatePayroll, convertUsdMinor, indexedBaseLabel, kz, parseFxRate } from '../src/index.js';

describe('salário indexado ao dólar', () => {
  it('lê o câmbio com vírgula ou ponto e até 6 casas decimais', () => {
    expect(parseFxRate('912,5')).toBe(912.5);
    expect(parseFxRate('912.123456')).toBe(912.123456);
    expect(parseFxRate(' 1 000,25 ')).toBe(1000.25);
    for (const bad of ['0', '-1', 'abc', '912,1234567', '']) expect(parseFxRate(bad)).toBeNull();
  });
  it('converte USD em Kz ao cêntimo, sem erros de vírgula flutuante', () => {
    expect(convertUsdMinor(150_000, 912.5)).toBe(136_875_000); // USD 1 500,00 → 1 368 750,00 Kz
    expect(convertUsdMinor(1, 912.123456)).toBe(912);
    expect(convertUsdMinor(123_456, 0.333333)).toBe(41_152);
    expect(() => convertUsdMinor(-1, 900)).toThrow();
    expect(indexedBaseLabel(150_000, 912.5)).toMatch(/^Vencimento base \(USD 1.500,00 × 912,50 Kz\)$/);
    expect(indexedBaseLabel(100, 1_000.123456)).toMatch(/× 1.000,123456 Kz\)$/);
  });
});

describe('simulador: líquido pretendido → salário base', () => {
  /** Mesmo cálculo da folha do Excel do simulador (Grupo A, INSS 3%, isenção de 30 000 Kz em cada subsídio). */
  it('encontra o menor salário base ao cêntimo que dá o líquido pretendido', () => {
    const r = baseForNet({ period: '2026-11' }, kz(500_000))!;
    expect(r.result.netMinor).toBeGreaterThanOrEqual(kz(500_000));
    expect(calculatePayroll({ period: '2026-11', baseMinor: r.baseMinor - 1 }).netMinor).toBeLessThan(kz(500_000));
    // Conferido com a folha: 500 000 Kz líquidos = 627 899,48 Kz de base (0,776 × B + 12 750), IRT escalão 5.
    expect(Math.abs(r.baseMinor - 62_789_948)).toBeLessThanOrEqual(2);
    expect(r.result.irtBracket).toBe(5);
  });
  it('com subsídios, outros descontos e subsídios dentro do INSS', () => {
    const input = { period: '2026-11', mealMinor: kz(40_000), transportMinor: kz(25_000), otherDeductionsMinor: kz(10_000) };
    const out = baseForNet(input, kz(400_000))!;
    expect(out.result.netMinor).toBeGreaterThanOrEqual(kz(400_000));
    expect(out.result.netMinor - kz(400_000)).toBeLessThan(5);
    const inss = baseForNet({ ...input, allowancesInInss: true }, kz(400_000))!;
    expect(inss.result.inssBaseMinor).toBe(inss.baseMinor + kz(65_000));
    expect(inss.baseMinor).toBeGreaterThan(out.baseMinor);
  });
  it('líquido já coberto pelos subsídios: base zero', () => {
    expect(baseForNet({ period: '2026-11', mealMinor: kz(30_000) }, kz(20_000))!.baseMinor).toBe(0);
  });
});
