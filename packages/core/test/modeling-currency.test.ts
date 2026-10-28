import { describe, expect, it } from 'vitest';
import { buildFinancialReportBundle, convertFinancialCurrency, FINANCIAL_SECTORS, financialTemplate, runFinancialModel } from '../src/index.js';
describe('conversão da moeda do projecto', () => {
  for (const sector of FINANCIAL_SECTORS) it(`${sector}: converte os fluxos e mantém TIR, WACC, DSCR e fecho`, () => {
    const t = financialTemplate(sector), before = runFinancialModel(t.assumptions), rate = t.currency === 'USD' ? 1000 : 0.001;
    const input = t.assumptions as unknown as Record<string, unknown>, original = structuredClone(input);
    const converted = convertFinancialCurrency(input, t.currency as 'Kz' | 'USD', t.currency === 'USD' ? 'Kz' : 'USD', rate), after = runFinancialModel(converted);
    expect(input).toEqual(original); expect(after.checks).toMatchObject({ balance: true, cashFlow: true });
    // Cada cálculo arredonda os seus fluxos à unidade mínima da respectiva moeda.
    expect(Math.abs(after.npv - before.npv * rate)).toBeLessThan(0.1 * Math.max(1, rate));
    expect(after.irr).toBeCloseTo(before.irr!, 6); expect(after.minDscr).toBeCloseTo(before.minDscr!, 5); expect(after.wacc).toBe(before.wacc);
    expect((converted.receitas as any[])[0].qtd).toBe(t.assumptions.receitas[0]!.qtd); expect(converted.ii).toBe(input.ii); expect(converted.cenarios).toEqual(input.cenarios);
  });
  it('converte todos os saldos de abertura, dívida, capital, pessoal e residual', () => {
    const input = { pessoal: 2, fst: 3, outros: 4, capitalInicial: 5, caixaMin: 6, valorResidualLiquido: 7, divida: { montante: 8, taxa: 12, prazo: 4 }, abertura: { imob: 9, exist: 10, clientes: 11, caixa: 12, fornec: 13, divida: 14, divTaxa: 10, vidaRem: 8 }, receitas: [{ preco: 0.001, qtd: 2000000 }], capex: [{ valor: 15, vida: 5, ano: 1 }], dso: 60 };
    const result = convertFinancialCurrency(input, 'USD', 'EUR', 0.8) as any;
    for (const k of ['pessoal', 'fst', 'outros', 'capitalInicial', 'caixaMin', 'valorResidualLiquido'] as const) expect(result[k]).toBeCloseTo(input[k] * 0.8, 12);
    for (const k of ['imob', 'exist', 'clientes', 'caixa', 'fornec', 'divida'] as const) expect(result.abertura[k]).toBeCloseTo(input.abertura[k] * 0.8, 12);
    expect(result.receitas[0]).toEqual({ preco: 0.0008, qtd: 2000000 }); expect(result.divida).toEqual({ montante: 6.4, taxa: 12, prazo: 4 }); expect(result.capex[0]).toEqual({ valor: 12, vida: 5, ano: 1 }); expect(result.dso).toBe(60);
  });
  it('rascunhos incompletos não recebem valores de exemplo e a correcção da etiqueta usa taxa 1', () => {
    expect(convertFinancialCurrency({ pessoal: 10 }, 'USD', 'Kz', 900)).toEqual({ pessoal: 9000 });
    const input = { pessoal: 123.4567890123456 };
    expect(convertFinancialCurrency(input, 'USD', 'USD', 1)).toEqual(input);
  });
  it.each([0, -1, NaN, Infinity, 1e13])('recusa taxa inválida %s sem alterar dados', rate => { expect(() => convertFinancialCurrency({ pessoal: 10 }, 'USD', 'EUR', rate)).toThrow(); });
  it('recusa valores incompatíveis e sobrefluxo antes de converter parcialmente', () => {
    expect(() => convertFinancialCurrency({ pessoal: 1, fst: 'inválido' }, 'USD', 'Kz', 900)).toThrow();
    expect(() => convertFinancialCurrency({ pessoal: 1e12 }, 'USD', 'Kz', 900)).toThrow();
    expect(() => convertFinancialCurrency({ pessoal: 1 }, 'USD', 'USD', 2)).toThrow();
  });
  it('os relatórios registam a taxa e a data utilizadas', () => {
    const m = financialTemplate('mineracao').assumptions;
    const input = { ...convertFinancialCurrency(m as unknown as Record<string, unknown>, 'USD', 'EUR', 0.9), currencyConversion: { from: 'USD', to: 'EUR', rate: 0.9, rateDate: '2026-10-27', source: 'Taxa do teste' } };
    const bundle = buildFinancialReportBundle(input, { modelId: 'm', projectName: 'Teste', sector: 'mineracao', currency: 'EUR', companyName: 'Teste', companyNif: '', revision: 2, sourceHash: 'a', asOf: '2026-10-28', state: 'draft' });
    for (const report of Object.values(bundle.reports)) expect(JSON.stringify(report)).toContain('1 USD = 0.9 EUR, taxa de 2026-10-27');
  });
});
