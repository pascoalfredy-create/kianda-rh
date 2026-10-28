import type { FinancialReportBundle, FinancialReportKey, ReportCell } from '@kianda/core';
import { xlsx, type Cell, type Sheet } from './xlsx.js';
const value = (c: ReportCell): Cell => c.value === null ? 'n/d' : c.format === 'text' ? { value: c.value, format: 'text', wrap: true } : { value: c.value, format: c.format };
/** Exportação de resultados congelados. Não pretende ser um motor financeiro Excel recalculável. */
export function renderFinancialXlsx(bundle: FinancialReportBundle, key: FinancialReportKey): Uint8Array {
  const source = bundle.source, report = bundle.reports[key];
  const summary: Sheet = { name: 'Resumo', numberFormat: '#,##0.00', boldRows: [0, 1], widths: [48, 95], rows: [
    [{ value: report.title, format: 'text', wrap: true }], [{ value: source.projectName, format: 'text', wrap: true }], ['Empresa', source.promoter || source.companyName], ['NIF', source.promoter ? source.promoterNif || 'n/d' : source.companyNif], ['Moeda', source.currency],
    ['Estado', source.state === 'approved' ? `V${source.versionNumber} - ${source.versionLabel}` : 'Rascunho'], ['Revisão de origem', { value: source.revision, format: 'integer' }], ['Data de referência', source.asOf], ['Identificação da origem', source.sourceHash],
    ['Natureza da exportação', 'Resultados calculados pelo Integra, sem fórmulas de recálculo.'],
    ...report.blocks.flatMap((b): Cell[][] => b.kind === 'metrics' ? b.items.map((v) => [v.label, value(v.cell)]) : b.kind === 'paragraph' ? [[b.title ?? '', { value: b.text, format: 'text', wrap: true }]] : []),
  ] };
  summary.rows = summary.rows.map((r) => r.map((v) => typeof v === 'string' ? { value: v, format: 'text', wrap: true } : v));
  const tables: Sheet[] = report.blocks.filter((b) => b.kind === 'table').map((b, i) => ({ name: `${i + 1} ${b.title}`.slice(0, 31), header: true, widths: [48, ...b.columns.slice(1).map(() => 20)], rows: [b.columns, ...b.rows.map((r) => r.cells.map(value))], boldRows: [0, ...b.rows.flatMap((r, i) => r.total ? [i + 1] : [])] }));
  return xlsx([summary, ...tables]);
}
