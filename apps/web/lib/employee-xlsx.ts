/**
 * Leitura limitada de Excel para migração de pessoal: selecção da folha, datas e limites de dimensão. Só estrutura ZIP e XML; nunca executa conteúdo do ficheiro.
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

/** Metadados para escolher a folha e interpretar correctamente as datas dos livros antigos de Mac. */
export async function readXlsxWorkbookInfo(buffer: ArrayBuffer): Promise<{ sheets: string[]; dateSystem: '1900' | '1904' }> {
  if (buffer.byteLength > DOCUMENT_LIMIT) fail('O ficheiro excede 10 MB.');
  const entries = documentZipEntries(new Uint8Array(buffer)), workbook = entries.get('xl/workbook.xml');
  if (!workbook) return fail();
  const xml = await part(workbook);
  return { sheets: [...xml.matchAll(/<sheet\b[^>]*>/g)].map(m => text(attr(m[0], 'name') ?? 'Folha')), dateSystem: /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(xml) ? '1904' : '1900' };
}
