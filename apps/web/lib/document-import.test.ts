import { describe, expect, it } from 'vitest';
import { parseHistoricalTrialBalance, parseStatement, WORD_MIME } from '@kianda/core';
import { fixtureWord, fixtureZip, wordTableXml } from '../../../packages/core/test/fixtures/document-import';
import { fixturePdf } from '../test-fixtures/pdf';
import type { PdfTextItem } from '../modeling/pdf-import';
import { bankStatementFromPdfPages, extractWordRows, extractWordTrialBalance, readStatementDocument } from './document-import';

const arrayBuffer = (data: Uint8Array) => new Uint8Array(data).buffer;
describe('leitura real de documentos PDF e Word', () => {
  const balance = [['Conta', 'Designação', 'Saldo Devedor', 'Saldo Credor'], ['43', 'Banco & depósitos', '1.000,25', ''], ['51', 'Capital', '', '1.000,25']];
  const bank = [['Data', 'Descritivo', 'Débito', 'Crédito', 'Saldo'], ['01/10/2026', 'Salários', '100,25', '', '899,75'], ['02/10/2026', 'Entrada', '', '50,10', '949,85']];
  for (const compressed of [true, false]) it(`extrai um DOCX ${compressed ? 'comprimido' : 'sem compressão'} e confere os valores no core`, async () => {
    const buffer = arrayBuffer(fixtureWord(balance, compressed));
    expect(await extractWordRows(buffer)).toEqual(balance);
    const result = await extractWordTrialBalance(buffer);
    expect(result).toMatchObject({ accounts: 2, difference: 0 });
    expect(parseHistoricalTrialBalance(result.text).lines.map(r => r.v)).toEqual([1000.25, -1000.25]);
  });
  it('lê Word bancário e conserva saldos, débitos, créditos e cêntimos', async () => {
    const file = new File([arrayBuffer(fixtureWord(bank))], 'extracto.docx', { type: WORD_MIME });
    const result = parseStatement(await readStatementDocument(file));
    expect(result.problems).toEqual([]); expect(result.rows.map(r => r.amountMinor)).toEqual([-10025, 5010]);
    expect(result.balance).toMatchObject({ openingMinor: 100000, closingMinor: 94985, ok: true });
  });
  it('lê CSV e texto tabulado num Word sem obrigar a tabelas de apresentação', async () => {
    const xml = wordTableXml([['Data;Descritivo;Valor'], ['01/10/2026;Salário;-100,25']]).replaceAll('<w:tbl>', '').replaceAll('</w:tbl>', '').replaceAll(/<\/?w:(?:tr|tc)>/g, '');
    const file = new File([arrayBuffer(fixtureWord([], true, xml))], 'texto.docx');
    expect(parseStatement(await readStatementDocument(file)).rows[0]!.amountMinor).toBe(-10025);
  });
  it('não importa um DOCX corrompido, com CRC errado ou que seja outro formato', async () => {
    const zip = fixtureWord(balance, false); const marker = new TextEncoder().encode('Banco &amp;');
    const at = zip.findIndex((_, i) => marker.every((byte, j) => zip[i + j] === byte)); zip[at] = 88;
    await expect(extractWordTrialBalance(arrayBuffer(zip))).rejects.toThrow('danificado');
    await expect(extractWordTrialBalance(arrayBuffer(fixtureZip([['[Content_Types].xml', 'outro'], ['_rels/.rels', ''], ['word/document.xml', wordTableXml(balance)]])))).rejects.toThrow('sem macros');
    await expect(extractWordTrialBalance(new TextEncoder().encode('não é Word').buffer)).rejects.toThrow();
  });
  it('limita o tamanho, respeita cancelamento e explica Word antigo ou documentos sem tabela PGC', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(extractWordTrialBalance(arrayBuffer(fixtureWord(balance)), { signal: controller.signal })).rejects.toThrow();
    await expect(readStatementDocument(new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], 'grande.docx'))).rejects.toThrow('10 MB');
    await expect(readStatementDocument(new File(['antigo'], 'ficheiro.doc'))).rejects.toThrow('(.docx)');
    await expect(extractWordTrialBalance(arrayBuffer(fixtureWord(bank)))).rejects.toThrow();
  });
  const token = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, width, height: 10, transform: [10, 0, 0, 10, x, y] });
  const header = () => [token('Data', 40, 750), token('Descritivo', 140, 750), token('Débito', 340, 750), token('Crédito', 450, 750), token('Saldo', 560, 750)];
  const page = () => [...header(), token('01/10/2026', 40, 725), token('Salários', 140, 725), token('100,25', 340, 725), token('899,75', 560, 725), token('02/10/2026', 40, 710), token('Entrada', 140, 710), token('50,10', 450, 710), token('949,85', 560, 710)];
  it('lê o extracto bancário PDF por coordenadas e confere o saldo inicial e final', () => {
    const parsed = parseStatement(bankStatementFromPdfPages([page()]));
    expect(parsed.rows.map(r => r.amountMinor)).toEqual([-10025, 5010]);
    expect(parsed.balance).toMatchObject({ openingMinor: 100000, closingMinor: 94985, ok: true });
  });
  it('usa texto extraído de um PDF binário real', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'), task = pdfjs.getDocument({ data: fixturePdf([page()]), disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, verbosity: 0 });
    try {
      const doc = await task.promise, content = await (await doc.getPage(1)).getTextContent();
      const items = content.items.filter((v): v is typeof v & PdfTextItem => 'str' in v);
      expect(parseStatement(bankStatementFromPdfPages([items])).outflowMinor).toBe(10025);
    } finally { await task.destroy(); }
  });
  it('recusa páginas digitalizadas, mudança de colunas e movimentos incompletos', () => {
    expect(() => bankStatementFromPdfPages([page(), []])).toThrow('OCR');
    expect(() => bankStatementFromPdfPages([page(), [token('02/10/2026', 40, 725)]])).toThrow('cabeçalhos');
    expect(() => bankStatementFromPdfPages([[...header(), token('data errada', 40, 725), token('100,25', 340, 725)]])).toThrow('data ilegível');
    expect(() => bankStatementFromPdfPages([[...header(), token('01/10/2026', 40, 725), token('sem valor', 140, 725)]])).toThrow('Valor em falta');
  });
});
