/**
 * Excel do Valora sem bibliotecas externas: leitura da primeira folha (balancetes mensais) e escrita de
 * relatórios com formatos numéricos. Só estrutura ZIP e XML; nunca executa conteúdo do ficheiro.
 */
import { DOCUMENT_LIMIT, DOCUMENT_XML_LIMIT, documentCrc32, documentZipEntries, type DocumentZipEntry } from '@kianda/core';

const fail = (message = 'O ficheiro Excel está incompleto ou não é um .xlsx válido. Guarde-o de novo como «Livro do Excel (.xlsx)» ou exporte para CSV.'): never => { throw new Error(message); };

async function part(entry: DocumentZipEntry): Promise<string> {
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = entry.compressed;
  else {
    let stream: DecompressionStream;
    try { stream = new DecompressionStream('deflate-raw'); } catch { return fail('Este navegador não consegue abrir ficheiros Excel. Actualize-o ou exporte a folha para CSV.'); }
    const reader = new Blob([new Uint8Array(entry.compressed)]).stream().pipeThrough(stream).getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > entry.size || size > DOCUMENT_XML_LIMIT) return fail('O conteúdo expandido do Excel excede o limite de importação.');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  }
  if (bytes.length !== entry.size || documentCrc32(bytes) !== entry.crc) return fail('O ficheiro Excel está danificado.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function text(raw: string): string {
  return raw.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, key: string) => {
    if (entities[key]) return entities[key]!;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** Texto de <si>/<is>: junta os <t> (incluindo texto formatado em <r>), ignorando fonéticas <rPh>. */
const runText = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => text(m[1]!)).join('');

/** Coluna "AB" → índice 27 (base 0). */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]{1,3})\d+$/.exec(ref)?.[1];
  if (!letters) return -1;
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** Linhas da primeira folha, como o sheet_to_json({header:1, raw:true, defval:null}) do SheetJS. */
export async function readXlsxRows(buffer: ArrayBuffer, options: { sheetIndex?: number; maxRows?: number; maxColumns?: number } = {}): Promise<(string | number | boolean | null)[][]> {
  if (buffer.byteLength > DOCUMENT_LIMIT) fail('O ficheiro excede 10 MB.');
  let entries: Map<string, DocumentZipEntry>;
  try { entries = documentZipEntries(new Uint8Array(buffer)); } catch { return fail(); }
  if ([...entries.keys()].some(n => /vbaproject\.bin$/.test(n))) fail('Ficheiros Excel com macros não são aceites. Guarde como .xlsx.');
  const workbook = entries.get('xl/workbook.xml'), rels = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return fail();
  const sheetIndex = options.sheetIndex ?? 0;
  if (!Number.isInteger(sheetIndex) || sheetIndex < 0) return fail();
  const first = [...(await part(workbook)).matchAll(/<sheet\b[^>]*>/g)][sheetIndex]?.[0];
  const relId = first && (attr(first, 'r:id') ?? attr(first, 'relationships:id'));
  if (!relId) return fail('O livro não tem folhas.');
  const relation = [...(await part(rels)).matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => attr(r, 'Id') === relId);
  const targetRaw = relation && attr(relation, 'Target');
  if (!targetRaw) return fail();
  const target = (targetRaw.startsWith('/') ? targetRaw.slice(1) : `xl/${targetRaw}`).replace(/\/\.\//g, '/').toLowerCase();
  const sheet = entries.get(target);
  if (!sheet) return fail();
  const sharedEntry = entries.get('xl/sharedstrings.xml');
  const shared = sharedEntry ? [...(await part(sharedEntry)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runText(m[1]!)) : [];
  const xml = await part(sheet);
  const rows: (string | number | boolean | null)[][] = [];
  for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const index = Number(attr(row[1] ?? row[3] ?? '', 'r') ?? rows.length + 1) - 1;
    if (!Number.isInteger(index) || index < 0 || index > (options.maxRows ? 1_048_575 : 100_000)) fail();
    const cells: (string | number | boolean | null)[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cell[1]!, body = cell[2] ?? '', ref = attr(tag, 'r'), type = attr(tag, 't') ?? 'n';
      const col = ref ? columnIndex(ref) : cells.length;
      if (col < 0 || col > 16_383) fail();
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: string | number | boolean | null = null;
      if (type === 's') value = raw === undefined ? null : shared[Number(raw)] ?? null;
      else if (type === 'inlineStr') value = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'str' || type === 'd') value = raw === undefined ? null : text(raw);
      else if (type === 'b') value = raw === '1';
      else if (type === 'e') value = null;
      else value = raw === undefined || raw === '' ? null : Number(raw);
      if (typeof value === 'number' && !Number.isFinite(value)) value = null;
      if (col >= (options.maxColumns ?? 16_384)) { if (value !== null && value !== '') fail('A folha excede o limite de colunas. Seleccione apenas a tabela de colaboradores.'); else continue; }
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    if (index >= (options.maxRows ?? 100_001)) { if (!cells.some(v => v !== null && v !== '')) continue; return fail('A folha excede o limite de linhas. Separe os dados em ficheiros menores.'); }
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  const width = Math.max(0, ...rows.map(r => r.length));
  return rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? null));
}

/* ---------------- Escrita (subconjunto compatível com a API do SheetJS usada pelo protótipo) ---------------- */
type Cell = { v: string | number; t: 's' | 'n'; z?: string };
export type Sheet = Record<string, Cell> & { '!cols'?: { wch: number }[]; '!ref'?: string };
export interface Book { SheetNames: string[]; Sheets: Record<string, Sheet> }

const letters = (c: number): string => { let s = '', n = c + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const escapeXml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export const utils = {
  book_new: (): Book => ({ SheetNames: [], Sheets: {} }),
  encode_cell: ({ r, c }: { r: number; c: number }) => `${letters(c)}${r + 1}`,
  aoa_to_sheet(rows: unknown[][]): Sheet {
    const sheet = {} as Sheet; let maxC = 0;
    rows.forEach((row, r) => (row ?? []).forEach((value, c) => {
      if (value === null || value === undefined || value === '') return;
      maxC = Math.max(maxC, c);
      sheet[utils.encode_cell({ r, c })] = typeof value === 'number' && Number.isFinite(value) ? { v: value, t: 'n' } : { v: String(value), t: 's' };
    }));
    sheet['!ref'] = `A1:${utils.encode_cell({ r: Math.max(0, rows.length - 1), c: maxC })}`;
    return sheet;
  },
  book_append_sheet(book: Book, sheet: Sheet, name: string) { book.SheetNames.push(name); book.Sheets[name] = sheet; },
};

/** Pacote ZIP sem compressão (método 0): simples, determinístico e aceite pelo Excel, LibreOffice e Numbers. */
function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder(), locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = enc.encode(content), nameBytes = enc.encode(name), crc = documentCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
    const head = new Uint8Array(46 + nameBytes.length), cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); head.set(nameBytes, 46);
    locals.push(local, data); central.push(head); offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22); let at = 0;
  for (const chunk of [...locals, ...central, end]) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export function write(book: Book): Uint8Array {
  const formats: string[] = [];
  const styleOf = (z?: string) => { if (!z) return 0; let i = formats.indexOf(z); if (i < 0) { formats.push(z); i = formats.length - 1; } return i + 1; };
  const sheets = book.SheetNames.map((name, index) => {
    const sheet = book.Sheets[name]!;
    const byRow = new Map<number, string[]>();
    for (const [ref, value] of Object.entries(sheet)) {
      if (ref.startsWith('!')) continue;
      const cell = value as Cell;
      const r = Number(/\d+$/.exec(ref)![0]);
      const xml = cell.t === 'n' ? `<c r="${ref}"${styleOf(cell.z) ? ` s="${styleOf(cell.z)}"` : ''}><v>${cell.v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell.v))}</t></is></c>`;
      (byRow.get(r) ?? byRow.set(r, []).get(r)!).push(xml);
    }
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cells]) => `<row r="${r}">${cells.sort((a, b) => columnIndex(/r="([A-Z]+\d+)"/.exec(a)![1]!) - columnIndex(/r="([A-Z]+\d+)"/.exec(b)![1]!)).join('')}</row>`).join('');
    const cols = sheet['!cols']?.length ? `<cols>${sheet['!cols'].map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(120, c.wch))}" customWidth="1"/>`).join('')}</cols>` : '';
    return { name, path: `xl/worksheets/sheet${index + 1}.xml`, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>` };
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats.length ? `<numFmts count="${formats.length}">${formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeXml(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${formats.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map(s => `<Override PartName="/${s.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...sheets.map(s => [s.path, s.xml] as [string, string]),
  ]);
}

/** Metadados para escolher a folha e interpretar correctamente as datas dos livros antigos de Mac. */
export async function readXlsxWorkbookInfo(buffer: ArrayBuffer): Promise<{ sheets: string[]; dateSystem: '1900' | '1904' }> {
  if (buffer.byteLength > DOCUMENT_LIMIT) fail('O ficheiro excede 10 MB.');
  const entries = documentZipEntries(new Uint8Array(buffer)), workbook = entries.get('xl/workbook.xml');
  if (!workbook) return fail();
  const xml = await part(workbook);
  return { sheets: [...xml.matchAll(/<sheet\b[^>]*>/g)].map(m => text(attr(m[0], 'name') ?? 'Folha')), dateSystem: /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(xml) ? '1904' : '1900' };
}
