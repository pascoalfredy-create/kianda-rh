/** Leitura limitada de pacotes Word: só estrutura ZIP e texto; nunca executa conteúdo do documento. */
export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_ACCEPT = '.csv,.txt,.pdf,.docx,text/csv,text/plain,application/pdf,' + WORD_MIME;
export const DOCUMENT_LIMIT = 10 * 1024 * 1024;
export const DOCUMENT_XML_LIMIT = 8 * 1024 * 1024;
export interface DocumentZipEntry {
  name: string;
  method: number;
  compressed: Uint8Array;
  size: number;
  crc: number;
}
const invalid = (message = 'O ficheiro Word está incompleto ou não é um DOCX válido.'): never => {
  throw new Error(message);
};

/** Inspecciona o índice e os cabeçalhos locais antes de descomprimir qualquer parte. */
export function documentZipEntries(data: Uint8Array): Map<string, DocumentZipEntry> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength),
    length = data.byteLength;
  if (length < 52 || length > DOCUMENT_LIMIT || v.getUint32(0, true) !== 0x04034b50) return invalid();
  let end = -1;
  for (let i = length - 22; i >= Math.max(0, length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === length) {
      end = i;
      break;
    }
  }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) return invalid();
  const count = v.getUint16(end + 10, true),
    start = v.getUint32(end + 16, true),
    directorySize = v.getUint32(end + 12, true);
  if (!count || count > 1000 || v.getUint16(end + 8, true) !== count || start + directorySize !== end) return invalid();
  const entries = new Map<string, DocumentZipEntry>(),
    offsets = new Set<number>();
  let at = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) return invalid();
    const flags = v.getUint16(at + 8, true),
      method = v.getUint16(at + 10, true),
      crc = v.getUint32(at + 16, true);
    const compressedSize = v.getUint32(at + 20, true),
      size = v.getUint32(at + 24, true),
      nameSize = v.getUint16(at + 28, true);
    const next = at + 46 + nameSize + v.getUint16(at + 30, true) + v.getUint16(at + 32, true),
      local = v.getUint32(at + 42, true);
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > DOCUMENT_XML_LIMIT ||
      (total += size) > 40 * 1024 * 1024 ||
      v.getUint16(at + 34, true)
    )
      return invalid('O Word está protegido, tem partes demasiado grandes ou usa um formato não suportado.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(at + 46, at + 46 + nameSize));
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      entries.has(name.toLowerCase()) ||
      offsets.has(local)
    )
      return invalid();
    if (
      local + 30 > start ||
      v.getUint32(local, true) !== 0x04034b50 ||
      v.getUint16(local + 8, true) !== method ||
      v.getUint16(local + 6, true) !== flags
    )
      return invalid();
    const localNameSize = v.getUint16(local + 26, true),
      body = local + 30 + localNameSize + v.getUint16(local + 28, true);
    if (
      body + compressedSize > start ||
      new TextDecoder().decode(data.subarray(local + 30, local + 30 + localNameSize)) !== name ||
      (method === 0 && compressedSize !== size)
    )
      return invalid();
    if (
      !(flags & 8) &&
      (v.getUint32(local + 14, true) !== crc ||
        v.getUint32(local + 18, true) !== compressedSize ||
        v.getUint32(local + 22, true) !== size)
    )
      return invalid();
    offsets.add(local);
    entries.set(name.toLowerCase(), {
      name,
      method,
      crc,
      size,
      compressed: data.subarray(body, body + compressedSize),
    });
    at = next;
  }
  if (at !== end) return invalid();
  return entries;
}

export function wordArchive(data: Uint8Array): Map<string, DocumentZipEntry> {
  const entries = documentZipEntries(data);
  if (
    !entries.has('[content_types].xml') ||
    !entries.has('_rels/.rels') ||
    !entries.has('word/document.xml') ||
    [...entries.keys()].some(n => /vbaproject|^xl\/|^ppt\//.test(n))
  )
    return invalid('Seleccione um documento Word DOCX, sem macros.');
  return entries;
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function documentCrc32(data: Uint8Array): number {
  let n = 0xffffffff;
  for (const byte of data) n = crcTable[(n ^ byte) & 255]! ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}

function xmlText(raw: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(raw))
    return invalid('O Word contém entidades XML inválidas.');
  return raw.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, key: string) => {
    const simple: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (simple[key]) return simple[key]!;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return invalid();
    return String.fromCodePoint(n);
  });
}

const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];
const WORD_TOKENS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
const WORD_TAG = /^<\/?([A-Za-z_][\w:.-]*)(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>$/;

/** Prefixo do elemento raiz do Word; recusa documentos sem o espaço de nomes do WordprocessingML. */
function wordPrefix(xml: string) {
  const root = /<([\w.-]+:)?document\b([^>]*)>/.exec(xml),
    prefix = root?.[1] || '';
  const ns = root?.[2]?.match(
    new RegExp(`xmlns${prefix ? ':' + prefix.slice(0, -1) : ''}\\s*=\\s*["']([^"']+)["']`),
  )?.[1];
  if (!WORD_NAMESPACES.includes(ns || '')) invalid();
  return prefix;
}

/** Leitor sequencial do XML do Word: parágrafos e células de tabela, ignorando desenhos e objectos. */
class WordReader {
  readonly rows: string[][] = [];
  private readonly stack: string[] = [];
  private paragraph = '';
  private cell = '';
  private tableRow: string[] | null = null;
  private inBody = false;
  private inText = false;
  private inCell = false;
  private tables = 0;
  private span = 1;
  private ignored = 0;
  private chars = 0;
  private roots = 0;
  private bodies = 0;

  constructor(private readonly prefix: string) {}

  token(token: string) {
    if (token.startsWith('<!--') || token.startsWith('<?')) return;
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) return this.text(token);
    const tag = WORD_TAG.exec(token);
    if (!tag) invalid('O Word contém XML inválido.');
    const name = tag![1]!;
    if (token.startsWith('</')) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token) || this.stack.pop() !== name) invalid();
      this.close(name);
      return;
    }
    this.open(name, token);
    if (token.endsWith('/>')) {
      this.stack.pop();
      this.close(name);
    }
    if (this.rows.length > 10000) invalid('O Word excede 10 000 linhas.');
  }

  finished() {
    return !this.stack.length;
  }

  private text(token: string) {
    if (!this.inBody || !this.inText || this.ignored) return;
    const text = token.startsWith('<!') ? token.slice(9, -3) : xmlText(token);
    this.paragraph += text;
    if ((this.chars += text.length) > 2_000_000) invalid('O texto do Word excede o limite de importação.');
  }

  private open(name: string, token: string) {
    const p = this.prefix;
    if (!this.stack.length && (name !== p + 'document' || ++this.roots !== 1)) invalid();
    this.stack.push(name);
    if (this.stack.length > 100) invalid();
    if (this.ignored) this.ignored++;
    else if ([p + 'drawing', p + 'pict', p + 'object'].includes(name)) this.ignored = 1;
    if (name === p + 'body') {
      if (++this.bodies > 1) invalid();
      this.inBody = true;
    }
    if (this.inBody && !this.ignored) this.openContent(name.startsWith(p) ? name.slice(p.length) : '', token);
  }

  /** Elementos de conteúdo: tabelas simples, células (com colunas unidas), parágrafos, texto e quebras. */
  private openContent(local: string, token: string) {
    if (['ins', 'del', 'moveFrom', 'moveTo', 'altChunk', 'vMerge'].includes(local))
      invalid(
        'O Word tem revisões, células unidas verticalmente ou conteúdo incorporado. Aceite as revisões e exporte uma tabela simples antes de importar.',
      );
    if (local === 'tbl' && ++this.tables > 1)
      invalid('O Word contém tabelas dentro de outras tabelas. Exporte uma tabela simples.');
    switch (local) {
      case 'tr':
        if (this.tableRow) invalid();
        this.tableRow = [];
        break;
      case 'tc':
        this.inCell = true;
        this.cell = '';
        this.span = 1;
        break;
      case 'gridSpan': {
        this.span = Number(token.match(/(?:\w+:)?val\s*=\s*["'](\d+)["']/)?.[1]);
        if (!Number.isInteger(this.span) || this.span < 1 || this.span > 50) invalid();
        break;
      }
      case 'p':
        this.paragraph = '';
        break;
      case 't':
        this.inText = true;
        break;
      case 'tab':
        this.paragraph += '\t';
        break;
      case 'br':
      case 'cr':
        this.paragraph += ' ';
        break;
    }
  }

  private close(name: string) {
    if (this.ignored) {
      this.ignored--;
      return;
    }
    const local = name.startsWith(this.prefix) ? name.slice(this.prefix.length) : '';
    if (name !== this.prefix + local) return;
    switch (local) {
      case 't':
        this.inText = false;
        break;
      case 'p':
        if (this.inCell) this.cell += (this.cell ? ' ' : '') + this.paragraph.trim();
        else if (this.paragraph.trim()) this.rows.push([this.paragraph.trim()]);
        this.paragraph = '';
        break;
      case 'tc':
        if (!this.tableRow) invalid();
        this.tableRow!.push(this.cell.trim(), ...Array<string>(this.span - 1).fill(''));
        this.cell = '';
        this.inCell = false;
        this.span = 1;
        break;
      case 'tr':
        if (!this.tableRow) invalid();
        this.rows.push(this.tableRow!);
        this.tableRow = null;
        break;
      case 'tbl':
        this.tables--;
        break;
      case 'body':
        this.inBody = false;
        break;
    }
  }
}

/** Conserva as células vazias e os parágrafos. Não converte XML em HTML nem segue relações externas. */
export function wordDocumentRows(xml: string): string[][] {
  if (!xml || xml.length > DOCUMENT_XML_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml))
    return invalid('O texto Word é demasiado grande ou contém declarações XML não suportadas.');
  const reader = new WordReader(wordPrefix(xml));
  let at = 0;
  for (const match of xml.matchAll(WORD_TOKENS)) {
    if (match.index !== at) return invalid();
    at += match[0].length;
    reader.token(match[0]);
  }
  if (at !== xml.length || !reader.finished() || !reader.rows.some(r => r.some(Boolean)))
    return invalid('O Word não contém texto ou tabelas extraíveis. Documentos digitalizados precisam de OCR.');
  return reader.rows;
}

export const documentRowsCsv = (rows: string[][]): string =>
  rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(';')).join('\n');
