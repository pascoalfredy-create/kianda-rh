import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_SECTORS, FinancialModelError, financialBreakEvenPrice, financialDuration, financialIrr, financialNpv, financialPayback,
  financialScenarios, financialSensitivity, financialTaxes, financialTemplate, runFinancialModel, type FinancialAssumptions,
} from '../src/index.js';

function simple(): FinancialAssumptions {
  const m = financialTemplate('servicos').assumptions;
  Object.assign(m, { horizonte: 2, anoBase: 2026, inicioOp: 1, preOp: 0, inflacao: 0, ii: 0, royalty: 0, cvar: 0, pessoal: 0, fst: 0, outros: 0, manut: 0, dso: 0, dio: 0, dpo: 0, capitalInicial: 100, payout: 0, caixaMin: 0, valorResidualLiquido: 0, libertarFundoManeio: false });
  m.receitas = [{ nome: 'Receita', unid: 'unidades', qtd: 1, preco: 60, cresc: 0, esc: 0, ramp: '100' }];
  m.capex = [{ nome: 'Investimento', ano: 0, valor: 100, vida: 2 }];
  m.divida = { montante: 0, taxa: 0, prazo: 2, carencia: 0, ano: 0, jurosDesembolso: 0 };
  m.wacc = { modo: 'manual', rf: 10, erp: 0, beta: 1, crp: 0, kd: 0, wd: 0, manual: 10 };
  m.tv = { metodo: 'nenhum', g: 0, mult: 0 };
  return m;
}

describe('matemática financeira — referências analíticas independentes', () => {
  it('VAL inclui o investimento em t0; taxa zero e taxa negativa', () => {
    expect(financialNpv(0.1, [-100, 60, 60])).toBeCloseTo(-100 + 60 / 1.1 + 60 / 1.1 ** 2, 12);
    expect(financialNpv(0, [-100, 60, 60])).toBe(20);
    expect(financialNpv(-0.5, [-100, 60])).toBe(20);
  });
  it('TIR confere com a solução quadrática e com retornos de um ano', () => {
    expect(financialIrr([-100, 60, 60]).value).toBeCloseTo((60 + Math.sqrt(27600)) / 200 - 1, 12);
    expect(financialIrr([-100, 110]).value).toBeCloseTo(0.1, 12);
    expect(financialIrr([-100, 1]).value).toBeCloseTo(-0.99, 12);
    expect(financialIrr([-1, 101]).value).toBeCloseTo(100, 9);
  });
  it('não inventa TIR sem mudança de sinal ou com fluxos não convencionais', () => {
    expect(financialIrr([0, 10, 20])).toEqual({ value: null, status: 'no_sign_change' });
    expect(financialIrr([-100, 230, -132])).toEqual({ value: null, status: 'non_conventional' });
    expect(financialIrr([-100, -20]).value).toBeNull();
  });
  it('payback em anos e meses explícitos, sem incluir valor terminal', () => {
    expect(financialPayback([-100, 60, 60])).toBeCloseTo(1 + 40 / 60);
    expect(financialDuration(1 + 40 / 60)).toEqual({ years: 1, months: 8, totalMonths: 20 });
    expect(financialPayback([-100, 20, 20])).toBeNull();
    expect(financialPayback([0, 20, 20])).toBeNull();
  });
});

describe('motor integrado — todos os sectores', () => {
  for (const sector of FINANCIAL_SECTORS) {
    it(`${sector}: demonstrações reconciliadas nos três cenários; pressupostos preservados`, () => {
      const template = financialTemplate(sector), source = JSON.stringify(template.assumptions);
      const results = financialScenarios(template.assumptions);
      for (const r of Object.values(results)) {
        expect(r.checks).toEqual({ balance: true, cashFlow: true, maxBalanceDifference: 0, maxCashFlowDifference: 0 });
        expect(r.k.cash).toHaveLength(template.assumptions.horizonte + 1);
        expect(r.k.imob.every((v) => v >= 0)).toBe(true);
        expect(r.k.check.every((v) => v === 0)).toBe(true);
        expect(r.k.debt.every((v) => v >= 0)).toBe(true);
        if (r.irr !== null) {
          const flows = r.k.fcff.slice(); flows[r.H] += r.tv;
          // Erro relativo: não exigir igualdade absoluta de cêntimos num desconto iterativo de milhares de milhões.
          expect(Math.abs(financialNpv(r.irr, flows)) / Math.max(...flows.map(Math.abs))).toBeLessThan(1e-9);
        }
      }
      expect(results.pess.npv).toBeLessThan(results.base.npv);
      expect(results.otim.npv).toBeGreaterThan(results.base.npv);
      // O mesmo motor reconcilia a abertura de uma empresa existente, sem novos aportes/dívida fictícios.
      const existing = structuredClone(template.assumptions);
      existing.inicio = 'existente'; existing.capex = []; existing.divida.montante = 0; existing.capitalInicial = 0;
      Object.assign(existing.abertura, { imob: 2000000, vidaRem: 5, exist: 50000, clientes: 100000, caixa: 150000, fornec: 80000, divida: 500000, divTaxa: 10, divPrazo: 4 });
      for (const result of Object.values(financialScenarios(existing))) {
        expect(result.checks.balance).toBe(true); expect(result.checks.cashFlow).toBe(true);
        expect(result.irr).toBeNull(); expect(result.irrEq).toBeNull();
      }
      expect(JSON.stringify(template.assumptions)).toBe(source);
      expect(financialTemplate(sector).assumptions).not.toBe(template.assumptions);
    });
  }
});

describe('financiamento, fiscalidade parametrizada e avaliação', () => {
  it('projecto simples: FCFF, VAL, TIR, payback e PI por referência analítica', () => {
    const r = runFinancialModel(simple());
    expect(r.k.fcff).toEqual([-100, 60, 60]);
    expect(r.npv).toBeCloseTo(-100 + 60 / 1.1 + 60 / 1.1 ** 2, 12);
    expect(r.irr).toBeCloseTo((60 + Math.sqrt(27600)) / 200 - 1, 12);
    expect(r.pbDuration).toEqual({ years: 1, months: 8, totalMonths: 20 });
    expect(r.pi).toBeCloseTo((60 / 1.1 + 60 / 1.1 ** 2) / 100, 12);
    expect(r.minDscr).toBeNull();
    expect(r.multiples.enterpriseLow).toBe(60 * simple().mult.lo);
  });
  it('TIR do accionista considera aportes, dividendos e caixa residual, não FCFE potencial', () => {
    const m = simple(), r = runFinancialModel(m);
    expect(r.k.equityCashFlow).toEqual([-100, 0, 0]);
    expect(r.valuationFlows.equity).toEqual([-100, 0, 120]);
    expect(Math.abs(financialNpv(r.irrEq!, r.valuationFlows.equity!))).toBeLessThan(1e-8);
    expect(r.k.cash[2]).toBe(120);
    expect(r.irrEq).toBeCloseTo(Math.sqrt(120 / 100) - 1, 12);
    m.payout = 100;
    const distributed = runFinancialModel(m);
    expect(distributed.k.div).toEqual([0, 10, 10]);
    expect(distributed.irrEq).toBeCloseTo(0.1, 12);
  });
  it('juros, capital adicional inicial e fluxos dos investidores reconciliam', () => {
    const m = simple(); m.capitalInicial = 60; Object.assign(m.divida, { montante: 40, taxa: 10, jurosDesembolso: 50 });
    const r = runFinancialModel(m);
    expect(r.k.jur).toEqual([2, 4, 2]); expect(r.k.princ).toEqual([0, 20, 20]);
    expect(r.k.debt).toEqual([40, 20, 0]); expect(r.k.eqAuto).toEqual([2, 0, 0]);
    expect(r.k.equityCashFlow).toEqual([-62, 0, 0]); expect(r.k.cash[2]).toBe(74);
    expect(r.irrEq).toBeCloseTo(Math.sqrt(74 / 62) - 1, 12);
    expect(r.checks.balance).toBe(true);
  });
  it('dívida a taxa zero não usa uma taxa de substituição', () => {
    const m = simple(); m.divida.montante = 40;
    const r = runFinancialModel(m);
    expect(r.k.jur).toEqual([0, 0, 0]); expect(r.llcr).toBe(3);
  });
  it('DSCR inclui anos apenas com juros e não esconde o período mais fraco', () => {
    const m = simple(); m.horizonte = 3; m.capitalInicial = 0;
    Object.assign(m.divida, { montante: 100, taxa: 10, prazo: 3, carencia: 2 });
    Object.assign(m.receitas[0]!, { preco: 200, ramp: '1,50,100' });
    const r = runFinancialModel(m);
    expect(r.serviceYears).toEqual([1, 2, 3]); expect(r.repY).toEqual([3]);
    expect(r.k.dscr[1]).toBe(0.2); expect(r.minDscr).toBe(0.2);
    expect(r.covenants[0]).toMatchObject({ year: 2027, dscr: false, ndEbitda: false, icr: false });
  });
  it('a dívida que vence depois do horizonte não produz LLCR parcial enganador', () => {
    const m = simple(); Object.assign(m.divida, { montante: 40, prazo: 5 });
    const r = runFinancialModel(m);
    expect(r.llcr).toBeNull(); expect(r.debtCap).toBeNull(); expect(r.k.debt[2]).toBe(24);
    expect(r.warnings.some((w) => w.code === 'debt_beyond_horizon')).toBe(true);
  });
  it('depreciação ao cêntimo nunca ultrapassa o activo e acerta a última parcela', () => {
    const m = simple(); m.horizonte = 3; m.capex = [{ nome: 'Activo', ano: 0, valor: 0.05, vida: 3 }];
    const r = runFinancialModel(m);
    expect(r.k.da).toEqual([0, 0.02, 0.02, 0.01]); expect(r.k.imob[3]).toBe(0);
  });
  it('impostos com utilização FIFO, expiração parametrizada e sem crédito fictício de caixa', () => {
    expect(financialTaxes([-10000, 0, 0, 0, 0, 5000, 5000], 0.25, 5)).toEqual([0, 0, 0, 0, 0, 0, 1250]);
    expect(financialTaxes([-10000, 5000], 0.25, 0)).toEqual([0, 1250]);
    const m = simple(); m.ii = 25;
    const r = runFinancialModel(m);
    expect(r.k.imp).toEqual([0, 2.5, 2.5]); expect(r.k.fcff).toEqual([-100, 57.5, 57.5]);
  });
  it('dividendos não excedem os lucros acumulados nem a caixa disponível', () => {
    const m = simple(); m.payout = 100; m.pessoal = 10; Object.assign(m.receitas[0]!, { preco: 100, ramp: '0,100' });
    const r = runFinancialModel(m);
    expect(r.k.rl).toEqual([0, -60, 40]); expect(r.k.div).toEqual([0, 0, 0]);
  });
  it('sem financiamento automático, apresenta défice e não inventa aportes nem TIR do accionista', () => {
    const m = simple(); m.capitalInicial = 0; m.pessoal = 10; m.receitas = [];
    const automatic = runFinancialModel(m);
    expect(automatic.fundingGap).toBe(120); expect(automatic.fullyFunded).toBe(true);
    m.capitalAutomatico = false;
    const unfunded = runFinancialModel(m);
    expect(unfunded.fundingGap).toBe(120); expect(unfunded.k.eqAuto).toEqual([0, 0, 0]);
    expect(unfunded.irrEq).toBeNull(); expect(unfunded.irrEqStatus).toBe('not_funded'); expect(unfunded.fullyFunded).toBe(false);
  });
  it('empresa existente mantém abertura, reconcilia expansão no ano 0 e não inventa preço de aquisição', () => {
    const m = simple(); m.inicio = 'existente'; m.capex = [];
    Object.assign(m.abertura, { imob: 100, vidaRem: 2, exist: 5, clientes: 20, caixa: 10, fornec: 15, divida: 40, divTaxa: 10, divPrazo: 2 });
    const r = runFinancialModel(m);
    expect(r.bookEq).toBe(80); expect(r.netDebt0).toBe(30); expect(r.k.cash[0]).toBe(10);
    expect(r.k.fcff).toEqual([0, 70, 60]); expect(r.eqVal).toBeCloseTo(r.ev - 30);
    expect(r.checks.balance).toBe(true); expect(r.irr).toBeNull(); expect(r.irrEq).toBeNull(); expect(r.pb).toBeNull();
    m.capex = [{ nome: 'Expansão', ano: 0, valor: 30, vida: 2 }];
    const expanded = runFinancialModel(m);
    expect(expanded.k.fcff[0]).toBe(-30); expect(expanded.ev).toBeCloseTo(r.ev - 30, 10); expect(expanded.checks.balance).toBe(true);
  });
  it('dívidas distintas não produzem LLCR agregado com taxa arbitrária', () => {
    const m = simple(); m.inicio = 'existente'; m.abertura.divida = 10; m.divida.montante = 20;
    expect(runFinancialModel(m).llcr).toBeNull();
  });
  it('valor residual líquido é contado uma vez e não entra no payback operacional', () => {
    const m = simple(); m.receitas[0]!.preco = 20; m.valorResidualLiquido = 100;
    const r = runFinancialModel(m);
    expect(r.npv).toBeCloseTo(-100 + 20 / 1.1 + 120 / 1.21); expect(r.pb).toBeNull();
    m.tv.metodo = 'gordon'; expect(() => runFinancialModel(m)).toThrow(FinancialModelError);
  });
  it('um multiplicador zero elimina receita, em vez de ser substituído por um', () => {
    const r = runFinancialModel(simple(), { volume: 0 });
    expect(r.k.rev).toEqual([0, 0, 0]);
  });
  it('WACC por CAPM e Gordon validam a relação entre desconto e crescimento', () => {
    const m = simple(); Object.assign(m.wacc, { modo: 'capm', rf: 4, erp: 5, beta: 1.2, crp: 3, kd: 8, wd: 40 }); m.ii = 25;
    expect(runFinancialModel(m).wacc).toBeCloseTo(0.13 * 0.6 + 0.08 * 0.75 * 0.4, 12);
    Object.assign(m.wacc, { modo: 'manual', manual: 10 }); Object.assign(m.tv, { metodo: 'gordon', g: 10 });
    expect(() => runFinancialModel(m)).toThrow(FinancialModelError);
    m.tv.g = 9; expect(() => runFinancialModel(m, { wacc: 0.9 })).toThrow(FinancialModelError);
  });
  it('sensibilidade e preço break-even preservam pressupostos e conferem com o VAL', () => {
    const m = simple(), source = JSON.stringify(m), price = financialBreakEvenPrice(m)!;
    expect(price).toBeCloseTo(100 / (60 / 1.1 + 60 / 1.21), 3); // arredondamento dos fluxos ao cêntimo
    expect(Math.abs(runFinancialModel(m, { preco: price }).npv)).toBeLessThan(0.02);
    const sensitivity = financialSensitivity(m);
    expect(sensitivity).toHaveLength(6); expect(sensitivity[0]!.impact).toBeGreaterThanOrEqual(sensitivity[5]!.impact);
    expect(JSON.stringify(m)).toBe(source);
  });
  it('bloqueia entradas inválidas e crescimento que exceda a precisão suportada', () => {
    expect(() => runFinancialModel({ pessoal: 100 })).toThrow(FinancialModelError);
    const m = simple(); m.capex[0]!.vida = 0; expect(() => runFinancialModel(m)).toThrow(FinancialModelError);
    m.capex[0]!.vida = 2; m.divida.montante = 10; m.divida.carencia = m.divida.prazo; expect(() => runFinancialModel(m)).toThrow(FinancialModelError);
    m.divida.montante = 0; m.horizonte = 40; m.receitas[0]!.cresc = 200; expect(() => runFinancialModel(m)).toThrow(FinancialModelError);
  });
});
