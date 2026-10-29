/** Leitura limitada de pacotes Word: só estrutura ZIP e texto; nunca executa conteúdo do documento. */
export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_ACCEPT = '.csv,.txt,.pdf,.docx,text/csv,text/plain,application/pdf,' + WORD_MIME;
export const DOCUMENT_LIMIT = 10 * 1024 * 1024;
export const DOCUMENT_XML_LIMIT = 8 * 1024 * 1024;
export interface DocumentZipEntry { name: string; method: number; compressed: Uint8Array; size: number; crc: number }
const invalid = (message = 'O ficheiro Word está incompleto ou não é um DOCX válido.'): never => { throw new Error(message); };

/** Inspecciona o índice e os cabeçalhos locais antes de descomprimir qualquer parte. */
export function documentZipEntries(data: Uint8Array): Map<string, DocumentZipEntry> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), length = data.byteLength;
  if (length < 52 || length > DOCUMENT_LIMIT || v.getUint32(0, true) !== 0x04034b50) return invalid();
  let end = -1;
  for (let i = length - 22; i >= Math.max(0, length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === length) { end = i; break; }
  }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) return invalid();
  const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true), directorySize = v.getUint32(end + 12, true);
  if (!count || count > 1000 || v.getUint16(end + 8, true) !== count || start + directorySize !== end) return invalid();
  const entries = new Map<string, DocumentZipEntry>(), offsets = new Set<number>();
  let at = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) return invalid();
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), crc = v.getUint32(at + 16, true);
    const compressedSize = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true), nameSize = v.getUint16(at + 28, true);
    const next = at + 46 + nameSize + v.getUint16(at + 30, true) + v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    if (next > end || flags & 1 || ![0, 8].includes(method) || size > DOCUMENT_XML_LIMIT || (total += size) > 40 * 1024 * 1024 || v.getUint16(at + 34, true)) return invalid('O Word está protegido, tem partes demasiado grandes ou usa um formato não suportado.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(at + 46, at + 46 + nameSize));
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || entries.has(name.toLowerCase()) || offsets.has(local)) return invalid();
    if (local + 30 > start || v.getUint32(local, true) !== 0x04034b50 || v.getUint16(local + 8, true) !== method || v.getUint16(local + 6, true) !== flags) return invalid();
    const localNameSize = v.getUint16(local + 26, true), body = local + 30 + localNameSize + v.getUint16(local + 28, true);
    if (body + compressedSize > start || new TextDecoder().decode(data.subarray(local + 30, local + 30 + localNameSize)) !== name || method === 0 && compressedSize !== size) return invalid();
    if (!(flags & 8) && (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== compressedSize || v.getUint32(local + 22, true) !== size)) return invalid();
    offsets.add(local); entries.set(name.toLowerCase(), { name, method, crc, size, compressed: data.subarray(body, body + compressedSize) }); at = next;
  }
  if (at !== end) return invalid();
  return entries;
}

export function wordArchive(data: Uint8Array): Map<string, DocumentZipEntry> {
  const entries = documentZipEntries(data);
  if (!entries.has('[content_types].xml') || !entries.has('_rels/.rels') || !entries.has('word/document.xml') || [...entries.keys()].some(n => /vbaproject|^xl\/|^ppt\//.test(n))) return invalid('Seleccione um documento Word DOCX, sem macros.');
  return entries;
}

const crcTable = Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
export function documentCrc32(data: Uint8Array): number {
  let n = 0xffffffff; for (const byte of data) n = crcTable[(n ^ byte) & 255]! ^ n >>> 8; return (n ^ 0xffffffff) >>> 0;
}

function xmlText(raw: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(raw)) return invalid('O Word contém entidades XML inválidas.');
  return raw.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, key: string) => {
    const simple: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (simple[key]) return simple[key]!;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) return invalid();
    return String.fromCodePoint(n);
  });
}

/** Conserva as células vazias e os parágrafos. Não converte XML em HTML nem segue relações externas. */
export function wordDocumentRows(xml: string): string[][] {
  if (!xml || xml.length > DOCUMENT_XML_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml)) return invalid('O texto Word é demasiado grande ou contém declarações XML não suportadas.');
  const root = /<([\w.-]+:)?document\b([^>]*)>/.exec(xml), prefix = root?.[1] || '';
  const ns = root?.[2]?.match(new RegExp(`xmlns${prefix ? ':' + prefix.slice(0, -1) : ''}\\s*=\\s*["']([^"']+)["']`))?.[1];
  if (!['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'].includes(ns || '')) return invalid();
  const rows: string[][] = [], stack: string[] = [];
  let paragraph = '', cell = '', tableRow: string[] | null = null, inBody = false, inText = false, inCell = false, tables = 0, span = 1, ignored = 0, chars = 0, at = 0, roots = 0, bodies = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  const close = (name: string) => {
    if (ignored) { ignored--; return; }
    if (name === prefix + 't') inText = false;
    if (name === prefix + 'p' && !ignored) {
      if (inCell) cell += (cell ? ' ' : '') + paragraph.trim(); else if (paragraph.trim()) rows.push([paragraph.trim()]);
      paragraph = '';
    }
    if (name === prefix + 'tc') { if (!tableRow) return invalid(); tableRow.push(cell.trim(), ...Array<string>(span - 1).fill('')); cell = ''; inCell = false; span = 1; }
    if (name === prefix + 'tr') { if (!tableRow) return invalid(); rows.push(tableRow); tableRow = null; }
    if (name === prefix + 'tbl') tables--;
    if (name === prefix + 'body') inBody = false;
  };
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== at) return invalid(); at += match[0].length;
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) {
      if (inBody && inText && !ignored) { const text = token.startsWith('<!') ? token.slice(9, -3) : xmlText(token); paragraph += text; if ((chars += text.length) > 2_000_000) return invalid('O texto do Word excede o limite de importação.'); }
      continue;
    }
    const tag = /^<\/?([A-Za-z_][\w:.-]*)(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>$/.exec(token);
    if (!tag) return invalid('O Word contém XML inválido.');
    const name = tag[1]!, ending = token.startsWith('</'), single = token.endsWith('/>');
    if (ending) { if (!/^<\/[\w:.-]+\s*>$/.test(token) || stack.pop() !== name) return invalid(); close(name); continue; }
    if (!stack.length && (name !== prefix + 'document' || ++roots !== 1)) return invalid();
    stack.push(name); if (stack.length > 100) return invalid();
    if (ignored) ignored++;
    else if ([prefix + 'drawing', prefix + 'pict', prefix + 'object'].includes(name)) ignored = 1;
    if (name === prefix + 'body') { if (++bodies > 1) return invalid(); inBody = true; }
    if (inBody && !ignored) {
      const local = name.startsWith(prefix) ? name.slice(prefix.length) : '';
      if (['ins', 'del', 'moveFrom', 'moveTo', 'altChunk', 'vMerge'].includes(local)) return invalid('O Word tem revisões, células unidas verticalmente ou conteúdo incorporado. Aceite as revisões e exporte uma tabela simples antes de importar.');
      if (local === 'tbl' && ++tables > 1) return invalid('O Word contém tabelas dentro de outras tabelas. Exporte uma tabela simples.');
      if (local === 'tr') { if (tableRow) return invalid(); tableRow = []; }
      if (local === 'tc') { inCell = true; cell = ''; span = 1; }
      if (local === 'gridSpan') { const value = token.match(/(?:\w+:)?val\s*=\s*["'](\d+)["']/)?.[1]; span = Number(value); if (!Number.isInteger(span) || span < 1 || span > 50) return invalid(); }
      if (local === 'p') paragraph = '';
      if (local === 't') inText = true;
      if (local === 'tab') paragraph += '\t';
      if (local === 'br' || local === 'cr') paragraph += ' ';
    }
    if (single) { stack.pop(); close(name); }
    if (rows.length > 10000) return invalid('O Word excede 10 000 linhas.');
  }
  if (at !== xml.length || stack.length || !rows.some(r => r.some(Boolean))) return invalid('O Word não contém texto ou tabelas extraíveis. Documentos digitalizados precisam de OCR.');
  return rows;
}

export const documentRowsCsv = (rows: string[][]): string => rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(';')).join('\n');
