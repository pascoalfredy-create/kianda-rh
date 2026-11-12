import { describe, expect, it } from 'vitest';
import { analyzeFinancialProjection, buildFinancialProjectionAnalysisReport, buildFinancialReportBundle, FINANCIAL_REPORT_KEYS, runFinancialModel, FINANCIAL_SECTORS, financialTemplate, type FinancialReportSource } from '../src/index.js';
const source: FinancialReportSource = { modelId: 'm1', projectName: 'Estudo', sector: 'mineracao', currency: 'USD', companyName: 'Empresa', companyNif: '1234567890', revision: 1, sourceHash: 'a'.repeat(64), asOf: '2026-10-28T12:00:00.000Z', state: 'approved', versionNumber: 1, versionLabel: 'V comité' };
describe('relatórios financeiros congeláveis', () => {
  for (const sector of FINANCIAL_SECTORS) {
    it(`${sector}: oito relatórios com períodos, colunas e resultados consistentes`, () => {
      const m = financialTemplate(sector).assumptions, bundle = buildFinancialReportBundle(m, { ...source, sector });
      expect(Object.keys(bundle.reports)).toEqual([...FINANCIAL_REPORT_KEYS]);
      for (const report of Object.values(bundle.reports)) for (const b of report.blocks) {
        if (b.kind === 'table') {
          for (const row of b.rows) expect(row.cells).toHaveLength(b.columns.length);
          if (b.chronological && report.key === 'demonstracoes') expect(b.columns).toHaveLength(m.horizonte + 2);
        }
      }
      const funding = bundle.reports.sumario.blocks.find(b => b.kind === 'table' && b.title === 'Financiamento e cobertura por cenário');
      if (funding?.kind !== 'table') throw new Error('sem quadro de financiamento');
      expect(funding.rows.map(row => row.cells[1]!.value)).toEqual(Object.values(bundle.scenarios).map(scenario => Math.max(...(m.capitalAutomatico ? scenario.k.eqAuto : scenario.k.unfunded))));
      const dr = bundle.reports.demonstracoes.blocks.find((b) => b.kind === 'table')!;
      if (dr.kind !== 'table') throw new Error('sem demonstração');
      expect(dr.rows[0]!.cells.slice(1).map((c) => c.value)).toEqual(bundle.result.k.rev);
      expect(dr.rows.at(-1)!.cells.slice(1).map((c) => c.value)).toEqual(bundle.result.k.rl);
      const matrix = bundle.reports.cenarios.blocks.find((b) => b.kind === 'table' && b.title.startsWith('Matriz'))!;
      if (matrix.kind !== 'table') throw new Error('sem matriz');
      expect(matrix.rows[2]!.cells[3]!.value).toBe(bundle.result.npv);
    });
  }
  it('preserva os dados originais e o promotor sem se ligar ao rascunho ou ao RH', () => {
    const input = { ...financialTemplate('mineracao').assumptions, promotor: 'Promotor externo', customNote: 'Texto original' };
    const personnel = [{ source: 'budget', fromPeriod: '2026-01', toPeriod: '2026-12', importedAt: source.asOf }];
    const bundle = buildFinancialReportBundle(input, source, personnel), copy = JSON.stringify(bundle);
    input.pessoal = 1; input.receitas[0]!.preco = 1; input.customNote = 'alterado'; personnel[0]!.source = 'actual'; source.projectName = 'Outro projecto';
    expect(JSON.stringify(bundle)).toBe(copy);
    expect(bundle.inputAssumptions.customNote).toBe('Texto original');
  });
  it('a análise económico-financeira usa apenas as demonstrações projectadas do projecto', () => {
    expect(FINANCIAL_REPORT_KEYS).toContain('analise');
    const m = financialTemplate('industria').assumptions, r = runFinancialModel(m), a = analyzeFinancialProjection(r);
    expect(a.years).toEqual(r.years.slice(1));
    const t = 3, lg = a.rows.find((row) => row.key === 'lg')!.values[t - 1]!, k = r.k;
    expect(lg).toBeCloseTo((k.inv[t]! + k.ar[t]! + k.cash[t]!) / (k.ap[t]! + k.princ[t + 1]!), 10);
    expect(a.rows.find((row) => row.key === 'me')!.values[t - 1]).toBeCloseTo(k.ebitda[t]! / k.rev[t]!, 10);
    expect(a.diagnosis.map((d) => d.area)).toEqual(['Liquidez', 'Estrutura', 'Rendibilidade', 'Actividade']);
    const report = buildFinancialProjectionAnalysisReport(r, 'Fábrica', 'base');
    expect(report.key).toBe('analise');
    expect(JSON.stringify(report)).not.toMatch(/balancete/i);
    const ratios = report.blocks.find((b) => b.kind === 'table' && b.title === 'Rácios por ano') as { columns: string[] };
    expect(ratios.columns.slice(1, -1)).toEqual(a.years.map(String));
  });
});
