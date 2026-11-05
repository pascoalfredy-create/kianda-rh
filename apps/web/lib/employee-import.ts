import { DOCUMENT_LIMIT, EMPLOYEE_IMPORT_LIMIT, employeeImportKey, guessEmployeeImportMapping, parseCsv, type EmployeeImportCell } from '@kianda/core';
import { decodeDocumentText, extractWordRows } from './document-import';
import { extractPdfContent, pdfPageRows, type PdfTextItem } from '../modeling/pdf-import';
import { readXlsxRows, readXlsxWorkbookInfo } from '../valuation/xlsx';
export const EMPLOYEE_IMPORT_ACCEPT = '.xlsx,.csv,.txt,.pdf,.docx';
export interface EmployeeImportDocument { grid: EmployeeImportCell[][]; sheets: string[]; dateSystem: '1900' | '1904' }
const fail = (message: string): never => { throw new Error(message); };
export function employeeRowsFromPdf(pages: PdfTextItem[][]): string[][] {
  const output: string[][] = []; let expected: string[] | null = null;
  for (const [index, page] of pages.entries()) {
    const rows = pdfPageRows(page);
    if (!rows.length) return fail('A página ' + (index + 1) + ' não contém texto seleccionável. Use Excel, Word ou um PDF com texto.');
    let columns: ReturnType<typeof pdfPageRows>[number] | null = null;
    for (const row of rows) {
      const labels = row.map(c => c.text), map = guessEmployeeImportMapping(labels);
      if (map.number !== undefined && map.name !== undefined && Object.keys(map).length >= 3) {
        const keys = labels.map(employeeImportKey);
        if (expected && JSON.stringify(expected) !== JSON.stringify(keys)) return fail('As colunas mudam entre páginas do PDF. Exporte uma tabela com cabeçalhos iguais.');
        if (!expected) { expected = keys; output.push(labels); }
        columns = row; continue;
      }
      if (!columns) continue;
      const cells = columns.map(() => '');
      for (const cell of row) {
        const center = (cell.x + cell.end) / 2;
        const c = columns.findIndex((col, i) => i === columns!.length - 1 || center < (col.end + columns![i + 1]!.x) / 2);
        cells[c] += (cells[c] ? ' ' : '') + cell.text;
      }
      output.push(cells);
    }
    if (!columns) return fail('Não foi possível reconhecer o cabeçalho de colaboradores na página ' + (index + 1) + '. Use a tabela em Excel ou Word.');
  }
  return output;
}
export async function readEmployeeImportDocument(file: File, sheetIndex = 0, signal?: AbortSignal): Promise<EmployeeImportDocument> {
  if (!file.size || file.size > DOCUMENT_LIMIT) return fail('Seleccione um ficheiro com dados, até 10 MB.');
  if (/\.(xls|xlsm|doc)$/i.test(file.name)) return fail('Guarde o Excel como XLSX ou CSV, ou o Word como DOCX, antes de importar.');
  if (!/\.(xlsx|csv|txt|pdf|docx)$/i.test(file.name)) return fail('Seleccione Excel XLSX, CSV, PDF ou Word DOCX.');
  signal?.throwIfAborted(); const buffer = await file.arrayBuffer(); signal?.throwIfAborted();
  let grid: EmployeeImportCell[][], sheets: string[] = [], dateSystem: '1900' | '1904' = '1900';
  if (/\.xlsx$/i.test(file.name)) {
    const info = await readXlsxWorkbookInfo(buffer); sheets = info.sheets; dateSystem = info.dateSystem;
    grid = (await readXlsxRows(buffer, { sheetIndex, maxRows: EMPLOYEE_IMPORT_LIMIT + 100, maxColumns: 128 })).map(row => row.map(v => typeof v === 'boolean' ? String(v) : v));
  } else if (/\.docx$/i.test(file.name)) grid = await extractWordRows(buffer, signal);
  else if (/\.pdf$/i.test(file.name)) grid = await extractPdfContent(buffer, employeeRowsFromPdf, { signal });
  else grid = parseCsv(decodeDocumentText(buffer)).rows;
  signal?.throwIfAborted();
  if (grid.length > EMPLOYEE_IMPORT_LIMIT + 100 || grid.some(row => row.length > 128)) return fail('A tabela excede 5.100 linhas ou 128 colunas. Separe apenas os dados dos colaboradores.');
  if (grid.some(row => row.some(v => typeof v === 'string' && v.length > 1000))) return fail('A tabela contém uma célula demasiado extensa. Seleccione uma tabela de colaboradores.');
  if (!grid.some(row => row.some(v => v !== null && String(v).trim()))) return fail('O documento não contém uma tabela com dados.');
  return { grid, sheets, dateSystem };
}
export function guessEmployeeHeader(grid: EmployeeImportCell[][]): number {
  let best = 0, score = -1;
  grid.slice(0, 100).forEach((row, i) => { const n = Object.keys(guessEmployeeImportMapping(row.map(v => String(v ?? '')))).length; if (n > score) { best = i; score = n; } });
  return best;
}
