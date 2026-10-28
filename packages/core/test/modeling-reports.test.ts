import { describe, expect, it } from 'vitest';
import { buildFinancialReportBundle, FINANCIAL_REPORT_KEYS, FINANCIAL_SECTORS, financialTemplate, type FinancialReportSource } from '../src/index.js';
const source: FinancialReportSource = { modelId: 'm1', projectName: 'Estudo', sector: 'mineracao', currency: 'USD', companyName: 'Empresa', companyNif: '1234567890', revision: 1, sourceHash: 'a'.repeat(64), asOf: '2026-10-28T12:00:00.000Z', state: 'approved', versionNumber: 1, versionLabel: 'V comité' };
describe('relatórios financeiros congeláveis', () => {
  for (const sector of FINANCIAL_SECTORS) {
    it(`${sector}: sete relatórios com períodos, colunas e resultados consistentes`, () => {
      const m = financialTemplate(sector).assumptions, bundle = buildFinancialReportBundle(m, { ...source, sector });
      expect(Object.keys(bundle.reports)).toEqual([...FINANCIAL_REPORT_KEYS]);
      for (const report of Object.values(bundle.reports)) for (const b of report.blocks) {
        if (b.kind === 'table') {
          for (const row of b.rows) expect(row.cells).toHaveLength(b.columns.length);
          if (b.chronological && report.key === 'demonstracoes') expect(b.columns).toHaveLength(m.horizonte + 2);
        }
      }
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
  it('não apresenta um relatório histórico como se viesse de projecções', () => {
    expect(FINANCIAL_REPORT_KEYS).not.toContain('analise');
  });
});
