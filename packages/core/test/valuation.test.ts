import { describe, expect, it } from 'vitest';
import { blankValuationData, moduleForPath, personnelCostMkz, valuationCapacity, valuationDataIssue, VALUATION_BALANCE_KEYS, VALUATION_FLOW_KEYS, VALUATION_PLANS, valuationPlanPrice, kz } from '../src/index.js';

describe('Valora: contrato de dados e limites', () => {
  it('as rotas /v1/valuation pertencem ao módulo próprio', () => {
    expect(moduleForPath('/v1/valuation/bootstrap')).toBe('valuation');
    expect(moduleForPath('/v1/valuation')).toBe('valuation');
    expect(moduleForPath('/v1/valuations')).toBe('hr');
  });

  it('a análise em branco é válida, sem meses reais e com o exercício seguinte ao último encerrado', () => {
    const d = blankValuationData({ entity: '  Kalunga, S.A. ', lastClosedYear: 2025, historyYears: 4 });
    expect(valuationDataIssue(d)).toBeNull();
    expect(d.years).toEqual([2022, 2023, 2024, 2025]);
    expect(d.ex).toBe(2026);
    expect(d.fecho).toBe(0);
    expect(d.meta.ent).toBe('Kalunga, S.A.');
    expect(d.orc.saz.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 6);
    for (const k of [...VALUATION_FLOW_KEYS, ...VALUATION_BALANCE_KEYS]) expect(d.real[k]).toEqual(Array(12).fill(null));
    expect(() => blankValuationData({ entity: 'X', lastClosedYear: 2025, historyYears: 1 })).toThrow(RangeError);
    expect(() => blankValuationData({ entity: ' ', lastClosedYear: 2025 })).toThrow(RangeError);
  });

  it('recusa estruturas que o motor não abre', () => {
    const d = blankValuationData({ entity: 'X', lastClosedYear: 2025 });
    expect(valuationDataIssue({ ...d, v: 2 })).toMatch(/Versão/);
    expect(valuationDataIssue({ ...d, years: [2023, 2025, 2026] })).toMatch(/consecutivos/);
    expect(valuationDataIssue({ ...d, ex: 2030 })).toMatch(/exercício corrente/);
    expect(valuationDataIssue({ ...d, dr: { ...d.dr, v61: [1, 2] } })).toMatch(/v61/);
    expect(valuationDataIssue({ ...d, bal: { ...d.bal, caixa: [0, Number.NaN, 0] } })).toMatch(/caixa/);
    expect(valuationDataIssue({ ...d, real: { ...d.real, caixa: Array(12).fill('1') } })).toMatch(/caixa/);
    expect(valuationDataIssue({ ...d, fecho: 13 })).toMatch(/fecho/);
    expect(valuationDataIssue({ ...d, orc: { ...d.orc, saz: [1] } })).toMatch(/Orçamento/);
    expect(valuationDataIssue({ ...d, peers: Array(201).fill({}) })).toMatch(/Listas/);
    expect(valuationDataIssue({ ...d, rnotes: { a: 'x'.repeat(1_000_001) } })).toMatch(/tamanho/);
  });

  it('capacidade: análises activas e utilizadores incluídos', () => {
    expect(valuationCapacity({ analysisLimit: 3, extraUsers: 0 }, 3, 5)).toMatchObject({ canCreateAnalysis: false, canAddUser: false, userLimit: 5 });
    expect(valuationCapacity({ analysisLimit: null, extraUsers: 2 }, 40, 6)).toMatchObject({ canCreateAnalysis: true, canAddUser: true, userLimit: 7 });
    expect(() => valuationCapacity({ analysisLimit: 0, extraUsers: 0 }, 0, 0)).toThrow(RangeError);
  });

  it('custos com o pessoal: bruto + INSS da entidade empregadora, em Mkz', () => {
    expect(personnelCostMkz(300_000_000, 24_000_000)).toBe(3.24);
    expect(personnelCostMkz(0, 0)).toBe(0);
    expect(() => personnelCostMkz(1.5, 0)).toThrow(RangeError);
  });
});

describe('Valora: planos por análises activas', () => {
  it('cinco planos de 3, 10, 20, 40 e ilimitadas análises, com os preços aprovados', () => {
    expect(VALUATION_PLANS.map(p => p.label)).toEqual(['Essencial', 'PME / Grupo', 'Corporate', 'Profissional', 'Ilimitado']);
    expect(VALUATION_PLANS.map(p => [p.key, p.analysisLimit, p.monthlyMinor / 100])).toEqual([
      ['essencial', 3, 32_900], ['pme', 10, 52_900], ['corporate', 20, 72_900], ['enterprise40', 40, 92_900], ['unlimited', null, 129_900],
    ]);
  });
  it('semestral −10% e anual −15% à vista; extras a 10 000 Kz por mês do ciclo, sem desconto', () => {
    expect(valuationPlanPrice('essencial', 'monthly')!.totalMinor).toBe(kz(32_900));
    expect(valuationPlanPrice('essencial', 'semiannual')!.totalMinor).toBe(kz(177_660));
    expect(valuationPlanPrice('unlimited', 'annual')!.totalMinor).toBe(kz(1_324_980));
    const extra = valuationPlanPrice('pme', 'semiannual', 2)!;
    expect(extra.extraMinor).toBe(kz(120_000)); expect(extra.totalMinor).toBe(kz(285_660 + 120_000));
    expect(valuationPlanPrice('inexistente', 'monthly')).toBeNull();
    expect(() => valuationPlanPrice('pme', 'monthly', -1)).toThrow();
  });
});
