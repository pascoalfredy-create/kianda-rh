import { describe, expect, it } from 'vitest';
import { FINANCIAL_SECTORS, buildFinancialReportBundle, creditDiagnosis, creditDiagnosisText, financialTemplate, runFinancialModel, type FinancialAssumptions } from '../src/index.js';

function graceModel(): FinancialAssumptions {
  const m = financialTemplate('servicos').assumptions;
  Object.assign(m, { horizonte: 3, anoBase: 2026, inicioOp: 1, preOp: 0, inflacao: 0, ii: 0, royalty: 0, cvar: 0, pessoal: 0, fst: 0, outros: 0, manut: 0, dso: 0, dio: 0, dpo: 0, capitalInicial: 0, payout: 0, caixaMin: 0, valorResidualLiquido: 0, libertarFundoManeio: false });
  m.receitas = [{ nome: 'Receita', unid: 'unidades', qtd: 1, preco: 200, cresc: 0, esc: 0, ramp: '1,50,100' }];
  m.capex = [{ nome: 'Investimento', ano: 0, valor: 100, vida: 3 }];
  m.divida = { montante: 100, taxa: 10, prazo: 3, carencia: 2, ano: 0, jurosDesembolso: 0 };
  m.wacc = { modo: 'manual', rf: 10, erp: 0, beta: 1, crp: 0, kd: 0, wd: 0, manual: 10 };
  m.tv = { metodo: 'nenhum', g: 0, mult: 0 };
  return m;
}

describe('diagnóstico de crédito do Integra', () => {
  it('mede o covenant no reembolso e trata a carência à parte, como necessidade de liquidez', () => {
    const m = graceModel(), r = runFinancialModel(m), d = creditDiagnosis(m, r)!;
    expect(r.minDscr).toBe(0.2); // o motor continua a mostrar o pior ano com serviço da dívida
    expect(d.graceDscr).toBe(0.2);
    expect(d.repaymentDscr).toBe(r.k.dscr[3]);
    expect(d.conditions.join(' ')).toMatch(/juros do período de carência.*0,20x/);
    expect(d.level).not.toBe('r');
  });

  it('considera todos os covenants e só conclui «não bancável» quando o reembolso não é coberto', () => {
    const m = graceModel(); m.receitas[0]!.preco = 60;
    const r = runFinancialModel(m), d = creditDiagnosis(m, r)!;
    expect(d.repaymentDscr!).toBeLessThan(1);
    expect(d.level).toBe('r');
    expect(d.breachYears).toContain(2029);
    expect(creditDiagnosisText(m, r, d)).toMatch(/^DSCR mínimo no reembolso/);
  });

  it('sem dívida não há diagnóstico', () => {
    const m = graceModel(); m.divida.montante = 0; m.capitalInicial = 100;
    expect(creditDiagnosis(m, runFinancialModel(m))).toBeNull();
  });

  it('os modelos de exemplo com dívida reembolsam com DSCR positivo e nunca saem «não bancáveis»', () => {
    for (const sector of FINANCIAL_SECTORS) {
      const m = financialTemplate(sector).assumptions, r = runFinancialModel(m), d = creditDiagnosis(m, r);
      if (!d) continue;
      expect(d.repaymentDscr, sector).not.toBeNull();
      expect(d.repaymentDscr!, sector).toBeGreaterThan(1);
      expect(d.level, sector).not.toBe('r');
    }
  });

  it('o relatório de crédito usa o mesmo diagnóstico e assinala o que falta completar', () => {
    const t = financialTemplate('comercio');
    const bundle = buildFinancialReportBundle(t.assumptions, { companyName: 'Empresa', companyNif: '5000000000', sector: 'Comércio', revision: 1, sourceHash: 'x', asOf: '2026-11-08', state: 'draft' } as never);
    const text = JSON.stringify(bundle.reports.credito);
    expect(text).toContain('DSCR mínimo no reembolso');
    expect(text).toContain('A completar antes de enviar');
    expect(text).toContain('a decisão cabe ao financiador');
  });
});
