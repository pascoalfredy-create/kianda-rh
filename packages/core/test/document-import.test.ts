import { describe, expect, it } from 'vitest';
import { DOCUMENT_LIMIT, documentCrc32, wordArchive, wordDocumentRows } from '../src/document-import.js';
import { fixtureWord, fixtureZip, wordNamespace, wordTableXml } from './fixtures/document-import.js';

describe('documentos importados: Word limitado e sem conteúdo activo', () => {
  const rows = [['Conta', 'Designação', 'Saldo Devedor', 'Saldo Credor'], ['43', 'Banco & depósitos', '1 000,25', ''], ['51', 'Capital', '', '1 000,25']];
  it('preserva acentos, células vazias, entidades e cêntimos numa tabela real', () => {
    expect(wordDocumentRows(wordTableXml(rows))).toEqual(rows);
    expect([...wordArchive(fixtureWord(rows)).keys()]).toEqual(['[content_types].xml', '_rels/.rels', 'word/document.xml']);
    expect(wordArchive(fixtureWord(rows, false)).get('word/document.xml')!.method).toBe(0);
    expect(documentCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('conserva fragmentos na mesma célula, parágrafos e ligações como texto', () => {
    const xml = `<w:document xmlns:w="${wordNamespace}"><w:body><w:p><w:r><w:t>Entidade externa</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r><w:r><w:t>000,25</w:t></w:r></w:p><w:p><w:hyperlink><w:r><w:t>texto</w:t></w:r></w:hyperlink></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    expect(wordDocumentRows(xml)).toEqual([['Entidade externa'], ['1000,25 texto']]);
  });
  it('não aceita um ZIP arbitrário, uma folha Excel, macros ou ficheiros truncados', () => {
    expect(() => wordArchive(fixtureZip([['texto.txt', 'texto']]))).toThrow();
    expect(() => wordArchive(fixtureZip([['[Content_Types].xml', ''], ['_rels/.rels', ''], ['word/document.xml', ''], ['xl/workbook.xml', '']]))).toThrow();
    expect(() => wordArchive(fixtureZip([['[Content_Types].xml', ''], ['_rels/.rels', ''], ['word/document.xml', ''], ['word/vbaProject.bin', '']]))).toThrow('sem macros');
    expect(() => wordArchive(fixtureWord(rows).subarray(0, 100))).toThrow();
    expect(() => wordArchive(new Uint8Array(DOCUMENT_LIMIT + 1))).toThrow();
  });
  it('recusa entradas repetidas, caminhos externos e um índice incoerente', () => {
    expect(() => wordArchive(fixtureZip([['../word/document.xml', 'x']]))).toThrow();
    expect(() => wordArchive(fixtureZip([['word/document.xml', 'x'], ['word/document.xml', 'y']]))).toThrow();
    const bytes = fixtureWord(rows); new DataView(bytes.buffer).setUint32(bytes.length - 6, 1, true);
    expect(() => wordArchive(bytes)).toThrow();
  });
  it('recusa XML mal formado e entidades externas sem tentar resolver conteúdo', () => {
    expect(() => wordDocumentRows('<!DOCTYPE doc [<!ENTITY x SYSTEM "https://example.test/">]>' + wordTableXml(rows))).toThrow('declarações XML');
    expect(() => wordDocumentRows(wordTableXml(rows).replace('</w:tc>', '</w:tr>'))).toThrow();
    expect(() => wordDocumentRows(wordTableXml(rows) + wordTableXml(rows))).toThrow();
    expect(() => wordDocumentRows(wordTableXml(rows).replace('Banco &amp;', 'Banco &unknown;'))).toThrow();
  });
  it('exige resolver revisões e células verticais antes de ler valores financeiros', () => {
    for (const tag of ['ins', 'del', 'moveFrom', 'vMerge', 'altChunk']) expect(() => wordDocumentRows(wordTableXml(rows).replace('<w:tbl>', `<w:${tag}/><w:tbl>`))).toThrow('revisões');
    expect(() => wordDocumentRows(wordTableXml(rows).replace('<w:tc>', '<w:tc><w:tbl/>'))).toThrow('tabelas dentro');
  });
  it('um Word digitalizado não se transforma numa tabela vazia válida', () => {
    expect(() => wordDocumentRows(`<w:document xmlns:w="${wordNamespace}"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>`)).toThrow('OCR');
  });
});
