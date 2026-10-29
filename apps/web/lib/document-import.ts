import { DOCUMENT_LIMIT, DOCUMENT_XML_LIMIT, documentCrc32, documentRowsCsv, guessMapping, mappingProblem, parseDate, parseHistoricalTrialBalance, parseStatement, wordArchive, wordDocumentRows, type DocumentZipEntry } from '@kianda/core';
import { extractPdfContent, pdfPageRows, type PdfReadOptions, type PdfTextItem } from '../modeling/pdf-import';

const problem = (message: string): never => { throw new Error(message); };
export const decodeDocumentText = (buffer: ArrayBuffer) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return new TextDecoder('windows-1252').decode(buffer); }
};
export const documentFormat = (file: { name?: string; type?: string }): 'pdf' | 'word' | 'text' => /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf' ? 'pdf' : /\.docx$/i.test(file.name || '') || file.type?.includes('wordprocessingml') ? 'word' : 'text';

async function zipPart(entry: DocumentZipEntry, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = entry.compressed;
  else {
    let stream: DecompressionStream;
    try { stream = new DecompressionStream('deflate-raw'); } catch { return problem('Este navegador não consegue abrir o Word. Actualize-o ou guarde o documento como PDF.'); }
    const reader = new Blob([new Uint8Array(entry.compressed)]).stream().pipeThrough(stream).getReader();
    const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        signal?.throwIfAborted(); const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > entry.size || size > DOCUMENT_XML_LIMIT) return problem('O conteúdo expandido do Word excede o limite de importação.');
        chunks.push(next.value);
      }
      signal?.throwIfAborted(); bytes = new Uint8Array(size); let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  if (bytes.length !== entry.size || documentCrc32(bytes) !== entry.crc) return problem('O Word está danificado. A leitura não foi concluída.');
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export async function extractWordRows(buffer: ArrayBuffer, signal?: AbortSignal): Promise<string[][]> {
  signal?.throwIfAborted();
  const entries = wordArchive(new Uint8Array(buffer));
  const types = await zipPart(entries.get('[content_types].xml')!, signal);
  if (!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) return problem('Seleccione um Word DOCX, sem macros.');
  const xml = await zipPart(entries.get('word/document.xml')!, signal);
  signal?.throwIfAborted();
  return wordDocumentRows(xml);
}

export async function extractWordTrialBalance(buffer: ArrayBuffer, options: PdfReadOptions = {}) {
  const rows = await extractWordRows(buffer, options.signal);
  // A tabela deve começar pelo cabeçalho PGC; títulos de identificação antes dela não são contas.
  const start = rows.findIndex(row => row.some(cell => /^(?:CONTA|C[ÓO]DIGO)(?: DA CONTA)?$/i.test(cell.trim())));
  const text = start >= 0 ? documentRowsCsv(rows.slice(start).filter(row => row.length > 1)) : rows.every(row => row.length === 1) ? rows.map(row => row[0]).join('\n') : documentRowsCsv(rows);
  const parsed = parseHistoricalTrialBalance(text, 'Word');
  return { text, accounts: parsed.lines.length, difference: parsed.diff, scope: parsed.basis === 'accumulated' ? 'accumulated' : 'final' };
}

/** Uma página só usa os seus próprios cabeçalhos; valores não reconhecidos nunca são inferidos. */
export function bankStatementFromPdfPages(pages: PdfTextItem[][]): string {
  const output: string[][] = []; let expected: string[] | null = null;
  for (const [index, items] of pages.entries()) {
    const rows = pdfPageRows(items);
    if (!rows.length) return problem(`A página ${index + 1} não contém texto extraível. Documentos digitalizados precisam de OCR.`);
    let columns: ReturnType<typeof pdfPageRows>[number] | null = null, mapping: ReturnType<typeof guessMapping> = {};
    for (const row of rows) {
      const labels = row.map(c => c.text), candidate = guessMapping(labels);
      if (!mappingProblem(candidate)) {
        if (expected && JSON.stringify(expected) !== JSON.stringify(labels)) return problem('As colunas do extracto mudam entre páginas. Exporte um extracto com um formato único.');
        columns = row; mapping = candidate;
        if (!expected) { expected = labels; output.push(labels); }
        continue;
      }
      if (!columns) continue;
      const cells = columns.map(() => '');
      for (const cell of row) {
        const center = (cell.x + cell.end) / 2, description = mapping.description!;
        const i = Math.abs(cell.x - columns[description]!.x) < 2 ? description : columns.findIndex((c, n) => n === columns!.length - 1 || center < ((c.x + c.end) / 2 + (columns![n + 1]!.x + columns![n + 1]!.end) / 2) / 2);
        cells[i] += (cells[i] ? ' ' : '') + cell.text;
      }
      if (!parseDate(cells[mapping.date!] || '')) {
        const label = cells.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        if (/SALDO (?:ANTERIOR|INICIAL|FINAL|TRANSPORTADO)|^TOTAL|^PAG(?:INA)?\b/.test(label)) continue;
        const money = [mapping.amount, mapping.debit, mapping.credit].some(i => i !== undefined && /\d/.test(cells[i] || ''));
        if (money) return problem(`Página ${index + 1}: movimento com data ilegível. A importação não foi concluída.`);
        if (cells[mapping.description!] && cells.every((c, i) => !c || i === mapping.description) && output.length > 1) output.at(-1)![mapping.description!] += ' ' + cells[mapping.description!];
        continue;
      }
      output.push(cells);
    }
    if (!columns) return problem(`Página ${index + 1}: não foi possível reconhecer Data, Descritivo e Valor ou Débito/Crédito. Exporte o extracto com cabeçalhos em todas as páginas.`);
  }
  const text = documentRowsCsv(output), parsed = parseStatement(text);
  if (!parsed.rows.length || parsed.problems.length) return problem(parsed.problems[0]?.message || 'Não foram encontrados movimentos bancários no PDF.');
  return text;
}

export async function readStatementDocument(file: File, options: PdfReadOptions = {}): Promise<string> {
  if (!file.size || file.size > DOCUMENT_LIMIT) return problem('O documento admite até 10 MB e não pode estar vazio.');
  if (/\.doc$/i.test(file.name)) return problem('Guarde o documento Word antigo (.doc) como Word (.docx) ou PDF antes de importar.');
  const buffer = await file.arrayBuffer(); options.signal?.throwIfAborted();
  const format = documentFormat(file);
  const wordRows = format === 'word' ? await extractWordRows(buffer, options.signal) : null;
  const text = format === 'pdf' ? await extractPdfContent(buffer, bankStatementFromPdfPages, options) : wordRows ? wordRows.every(row => row.length === 1) ? wordRows.map(row => row[0]).join('\n') : documentRowsCsv(wordRows) : decodeDocumentText(buffer);
  if (text.length > 2_000_000) return problem('O texto do extracto excede o limite de importação.');
  return text;
}
