import { describe, expect, it } from 'vitest';
import { interpretManagement, interpretValuation } from './interpretation';

describe('interpretação Valora', () => {
  const base = {
    year: 2025, equity: -5, methods: [
      { k: 'nav', n: 'Activos', lo: -6, mid: -5, hi: -4 },
      { k: 'dcf', n: 'DCF', lo: NaN, mid: NaN, hi: NaN },
    ],
    weights: { nav: 100, dcf: 0 }, dcfEquity: NaN, ev: NaN, terminal: NaN,
    tests: [{ label: 'WACC', low: NaN, high: 6, check: 'Rever taxa' }], adverse: NaN,
  };
  it('interpreta um valor negativo e exclui métodos sem peso e testes incompletos', () => {
    const result = interpretValuation(base).join(' ');
    expect(result).toContain('valor ponderado');
    expect(result).toContain('Testes indisponíveis para WACC');
    expect(result).not.toMatch(/NaN|Infinity|Rever taxa/);
    expect(interpretValuation({ ...base, weights: { nav: 0, dcf: 100 } })[0]).toContain('indisponível');
  });
  it('aguarda um fecho e usa diferenças absolutas quando a receita orçamentada é zero', () => {
    expect(interpretManagement(null)[0]).toContain('Sem meses reais encerrados');
    const result = interpretManagement({ period: 'Março 2026', revenue: 2, budgetRevenue: 0, ebitda: 1, budgetEbitda: 0, cash: 1, cashMinimum: 2, adverseDeviations: [], forecastLow: 0, forecastMonth: 'Abril' }).join(' ');
    expect(result).toContain('sem base orçamental positiva');
    expect(result).toContain('antes desse mês');
    expect(result).not.toMatch(/NaN|Infinity/);
  });
});
