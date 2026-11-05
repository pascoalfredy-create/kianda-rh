import { describe, expect, it } from 'vitest';
import { employeeRowsFromPdf, guessEmployeeHeader, readEmployeeImportDocument } from './employee-import';
import { utils, write } from '../valuation/xlsx';
import { readXlsxRows } from './employee-xlsx';
const header = ['N.º mecanográfico', 'Nome completo', 'Função', 'Data de admissão', 'Salário base'];
const file = (name: string, value: Uint8Array | string): File => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return { name, size: bytes.byteLength, arrayBuffer: async () => new Uint8Array(bytes).buffer } as File;
};
describe('documentos de entrada de pessoal', () => {
  it('abre a folha escolhida do Excel, com títulos antes da tabela e zeros iniciais', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Orientações']]), 'Instruções');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Pessoal'], header, ['0001', 'Ana Exemplo', 'Técnica', '2024-03-04', 150000.25]]), 'Pessoal');
    const parsed = await readEmployeeImportDocument(file('base.xlsx', write(book)), 1);
    expect(parsed.sheets).toEqual(['Instruções', 'Pessoal']); expect(guessEmployeeHeader(parsed.grid)).toBe(1);
    expect(parsed.grid[2]).toEqual(['0001', 'Ana Exemplo', 'Técnica', '2024-03-04', 150000.25]);
    await expect(readXlsxRows(write(book).slice().buffer, { sheetIndex: 1, maxRows: 2, maxColumns: 10 })).rejects.toThrow();
  });
  it('lê CSV com ponto e vírgula e recusa documentos antigos, vazios ou excessivos', async () => {
    const parsed = await readEmployeeImportDocument(file('base.csv', header.join(';') + '\n0001;Ana;Técnica;04/03/2024;150000,25'));
    expect(parsed.grid[1]![0]).toBe('0001'); expect(parsed.grid[1]![4]).toBe('150000,25');
    await expect(readEmployeeImportDocument(file('base.xls', 'dados'))).rejects.toThrow('XLSX');
    await expect(readEmployeeImportDocument(file('base.xlsx', ''))).rejects.toThrow('10 MB');
    await expect(readEmployeeImportDocument({ name: 'base.csv', size: 11 * 1024 * 1024 } as File)).rejects.toThrow('10 MB');
  });
  it('alinha células do PDF pelos cabeçalhos da página e recusa páginas sem texto', () => {
    const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y], width: 45, height: 10 });
    const page = [item('Número', 0, 100), item('Nome', 100, 100), item('Função', 300, 100), item('Admissão', 400, 100), item('Salário base', 500, 100), item('0001', 0, 80), item('Ana Exemplo', 100, 80), item('Técnica', 300, 80), item('04/03/2024', 400, 80), item('150.000,00', 500, 80)];
    expect(employeeRowsFromPdf([page])[1]).toEqual(['0001', 'Ana Exemplo', 'Técnica', '04/03/2024', '150.000,00']);
    expect(() => employeeRowsFromPdf([[]])).toThrow('texto seleccionável');
  });
});
