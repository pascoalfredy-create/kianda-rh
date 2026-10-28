import { historicalAmount, parseHistoricalTrialBalance } from '@kianda/core';

export const PDF_IMPORT_VERSION = '6.4.299';
export const PDF_IMPORT_LIMIT = 10 * 1024 * 1024;
export const PDF_IMPORT_PAGES = 80;
export const PDF_IMPORT_URL = `/modeling-pdf/${PDF_IMPORT_VERSION}/pdf.min.mjs`;
export const PDF_WORKER_URL = `/modeling-pdf/${PDF_IMPORT_VERSION}/pdf.worker.min.mjs`;
export interface PdfTextItem { str: string; transform: number[]; width: number; height: number }
interface Cell { text: string; x: number; end: number; y: number; height: number }
type ColumnKey = 'account' | 'name' | 'debit' | 'credit' | 'signed' | 'side' | 'movement';
interface Column { key: ColumnKey; center: number }
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const problem = (message: string): never => { throw new Error(message); };
const cellText = (cells: Cell[]) => cells.map(c => c.text).join(' ').trim();
const csvCell = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** Coordenadas de texto, sem executar JavaScript, ligações ou anexos do documento. */
function pageRows(items: PdfTextItem[]): Cell[][] {
  const cells: Cell[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    if (!item.transform.every(Number.isFinite) || !Number.isFinite(item.width)) problem('O PDF contém coordenadas de texto inválidas.');
    if (Math.abs(item.transform[1]!) > 0.1 || Math.abs(item.transform[2]!) > 0.1) problem('O PDF tem texto rodado. Exporte o balancete na orientação de leitura.');
    // Alguns exportadores colocam uma linha inteira num item, com separadores largos.
    for (const match of item.str.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)) {
      const start = match.index!, length = item.str.length;
      cells.push({ text: match[0], x: item.transform[4]! + item.width * start / length, end: item.transform[4]! + item.width * (start + match[0].length) / length, y: item.transform[5]!, height: Math.abs(item.height) || 10 });
    }
  }
  cells.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Cell[][] = [];
  for (const cell of cells) {
    const row = rows.at(-1), previous = row?.[0];
    if (!previous || Math.abs(previous.y - cell.y) > Math.min(2.5, Math.max(1, cell.height * 0.22))) rows.push([cell]);
    else row!.push(cell);
  }
  return rows.map(r => r.sort((a, b) => a.x - b.x));
}

const labels: [RegExp, ColumnKey][] = [
  [/^(?:CONTA|CODIGO)(?: DA CONTA)?$/, 'account'], [/^(?:DESIGNACAO|DESCRICAO|NOME)(?: DA CONTA)?$/, 'name'],
  [/^(?:SALDO )?DEVEDOR$/, 'debit'], [/^(?:SALDO )?CREDOR$/, 'credit'], [/^SALDO$/, 'signed'],
  [/^(?:D\s*\/\s*C|D\s*-\s*C|NATUREZA)$/, 'side'], [/^(?:DEBITO|CREDITO)(?: ACUMULADO)?$/, 'movement'],
];
function header(row: Cell[]): Column[] | null {
  const columns: Column[] = [];
  for (let i = 0; i < row.length; i++) {
    let found = false;
    for (let n = Math.min(4, row.length - i); n > 0; n--) {
      const chunk = row.slice(i, i + n), text = norm(cellText(chunk));
      const key = labels.find(([re]) => re.test(text))?.[1];
      if (!key) continue;
      columns.push({ key, center: (chunk[0]!.x + chunk.at(-1)!.end) / 2 }); i += n - 1; found = true; break;
    }
    if (!found && /SALDO|DEBITO|CREDITO/.test(norm(row[i]!.text))) return null;
  }
  if (!columns.some(c => c.key === 'account') || !columns.some(c => c.key === 'name')) return null;
  const count = (key: ColumnKey) => columns.filter(c => c.key === key).length;
  if (count('account') !== 1 || count('name') !== 1 || ['debit', 'credit', 'signed', 'side'].some(k => count(k as ColumnKey) > 1)) problem('O PDF contém colunas de saldo ambíguas. Exporte apenas os saldos finais de um exercício.');
  if (!(count('debit') && count('credit')) && !count('signed')) return null;
  return columns.sort((a, b) => a.center - b.center);
}
function rowCells(row: Cell[], columns: Column[]): Map<ColumnKey, string> {
  const buckets = new Map<ColumnKey, Cell[]>();
  for (const cell of row) {
    const center = (cell.x + cell.end) / 2;
    const ix = columns.findIndex((c, i) => i === columns.length - 1 || center < (c.center + columns[i + 1]!.center) / 2);
    const key = columns[ix]!.key;
    buckets.set(key, [...buckets.get(key) || [], cell]);
  }
  return new Map([...buckets].map(([key, cells]) => [key, cellText(cells)]));
}

export interface PdfTrialBalance { text: string; accounts: number; pages: number; difference: number }
/** Só aceita uma tabela reconhecível de contas PGC e saldos finais. Não infere contas de movimentos bancários. */
export function trialBalanceFromPdfPages(pages: PdfTextItem[][]): PdfTrialBalance {
  if (!pages.length || pages.length > PDF_IMPORT_PAGES) problem(`O PDF admite até ${PDF_IMPORT_PAGES} páginas.`);
  const output = ['Conta;Designação;Saldo'], classTotals = new Map<string, number>();
  let columns: Column[] | null = null, characters = 0, rowsCount = 0;
  for (const [pageIndex, items] of pages.entries()) {
    if (items.length > 25_000) problem('O PDF tem demasiado texto numa página. Exporte um balancete mais curto.');
    const rows = pageRows(items);
    if (!rows.length) problem(`A página ${pageIndex + 1} não contém texto extraível. PDF digitalizados precisam de reconhecimento de texto (OCR).`);
    const pageText = norm(rows.map(cellText).join(' ')); characters += pageText.length;
    if (characters > 2_000_000) problem('O texto do PDF excede o limite de importação.');
    if (/VALORES? (?:EXPRESSOS? )?EM (?:MILHARES|MILHOES)|UNIDADE[^.]{0,20}(?:MILHARES|MILHOES)/.test(pageText)) problem('Exporte o PDF com valores em unidades, em vez de milhares ou milhões.');
    // Não usa as coordenadas de uma página anterior antes de confirmar o cabeçalho desta página.
    let foundHeader = false;
    for (const [rowIndex, row] of rows.entries()) {
      let next = header(row);
      // Cabeçalhos em duas linhas: Conta / Designação acima de Devedor / Credor.
      if (!next && rowIndex > 0 && row.some(c => /^(?:SALDO )?(?:DEVEDOR|CREDOR)$/.test(norm(c.text)))) {
        const prior = rows[rowIndex - 1]!.filter(c => /^(?:CONTA|CODIGO|DESIGNACAO|DESCRICAO|NOME)(?: DA CONTA)?$/.test(norm(c.text)));
        if (prior.length) next = header([...prior, ...row].sort((a, b) => a.x - b.x));
      }
      if (next) { columns = next; foundHeader = true; continue; }
      if (!columns || !foundHeader) continue;
      const values = rowCells(row, columns), code = values.get('account') || '', name = values.get('name') || '';
      if (/^(?:TOTAL|TOTAIS|TRANSPORTE|A TRANSPORTAR|PAGINA|CLASSE)\b/.test(norm(code + ' ' + name))) continue;
      const monetary = ['signed', 'debit', 'credit'].some(k => !!values.get(k as ColumnKey)?.trim());
      if (!/^\d[\d.\s-]*$/.test(code)) {
        if (monetary && /\d/.test([...values].filter(([k]) => ['signed', 'debit', 'credit'].includes(k)).map(([, v]) => v).join(''))) problem(`Página ${pageIndex + 1}: linha com montantes sem conta PGC reconhecível. Reveja o formato do PDF.`);
        continue;
      }
      if (!monetary || !name) problem(`Página ${pageIndex + 1}, conta ${code}: faltam designação ou saldos. Não foram importados valores parciais.`);
      const amount = (key: ColumnKey) => {
        const raw = values.get(key)?.trim() || '';
        return /^[-–—]$/.test(raw) ? 0 : historicalAmount(raw, `PDF.pagina${pageIndex + 1}.${code}`);
      };
      let cents: number;
      if (columns.some(c => c.key === 'debit')) {
        const debit = amount('debit'), credit = amount('credit');
        if (debit < 0 || credit < 0 || debit && credit) problem(`Conta ${code}: saldos devedor e credor inválidos.`);
        cents = debit - credit;
        if (columns.some(c => c.key === 'signed') && amount('signed') !== cents) problem(`Conta ${code}: as colunas de saldo não coincidem.`);
      } else {
        const suffix = /^(.*?)\s*([DC])$/i.exec(values.get('signed') || '');
        if (suffix && !columns.some(c => c.key === 'side')) {
          cents = historicalAmount(suffix[1]!, `PDF.pagina${pageIndex + 1}.${code}`);
          if (cents < 0) problem(`Conta ${code}: saldo com sinal e natureza D/C ambíguos.`);
          if (suffix[2]!.toUpperCase() === 'C') cents = -cents;
        } else cents = amount('signed');
        if (columns.some(c => c.key === 'side')) {
          const side = norm(values.get('side') || '');
          if (!['D', 'C', 'DEVEDOR', 'CREDOR'].includes(side) || cents < 0) problem(`Conta ${code}: indique claramente a natureza D/C do saldo.`);
          if (side === 'C' || side === 'CREDOR') cents = -cents;
        }
      }
      const canonical = code.replace(/[.\s-]/g, '');
      if (canonical.length === 1) {
        if (classTotals.has(canonical)) problem(`Total da classe ${canonical} repetido no PDF.`);
        classTotals.set(canonical, cents); continue;
      }
      output.push([code, name, (cents / 100).toFixed(2)].map(csvCell).join(';'));
      if (++rowsCount > 5000) problem('O limite é de 5 000 contas por balancete.');
    }
    if (!foundHeader) problem(`Página ${pageIndex + 1}: não foi possível identificar Conta, Designação e saldos finais. Exporte o PDF com cabeçalhos em todas as páginas. Extractos bancários sem contas PGC não permitem gerar demonstrações completas.`);
  }
  const text = output.join('\n');
  const parsed = parseHistoricalTrialBalance(text, 'PDF');
  for (const [prefix, total] of classTotals) {
    const sum = parsed.lines.filter(l => l.code.replace(/\D/g, '').startsWith(prefix)).reduce((s, l) => s + Math.round(l.v * 100), 0);
    if (sum !== total) problem(`O total da classe ${prefix} não corresponde às contas extraídas. Confira o PDF.`);
  }
  return { text, accounts: parsed.lines.length, pages: pages.length, difference: parsed.diff };
}

export async function extractPdfTrialBalance(buffer: ArrayBuffer, options: { signal?: AbortSignal; progress?: (page: number, total: number) => void } = {}): Promise<PdfTrialBalance> {
  if (!buffer.byteLength || buffer.byteLength > PDF_IMPORT_LIMIT) problem('O PDF admite até 10 MB.');
  if (!new TextDecoder('latin1').decode(buffer.slice(0, 1024)).includes('%PDF-')) problem('O ficheiro seleccionado não é um PDF válido.');
  options.signal?.throwIfAborted();
  let port: Worker | undefined, worker: import('pdfjs-dist').PDFWorker | undefined, task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let stopped = false, rejectInterrupted: (error: Error) => void;
  let timeout: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject;
    abort = () => reject(options.signal?.reason || new Error('Importação cancelada.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => reject(new Error('A leitura do PDF excedeu 45 segundos. Exporte um documento mais curto.')), 45_000);
  });
  try {
    return await Promise.race([(async () => {
      const pdfjs = await import(/* @vite-ignore */ PDF_IMPORT_URL) as typeof import('pdfjs-dist');
      if (stopped) throw new Error('Importação terminada.');
      options.signal?.throwIfAborted();
      port = new Worker(PDF_WORKER_URL, { type: 'module' });
      port.addEventListener('error', event => { event.preventDefault(); rejectInterrupted(new Error('Não foi possível iniciar o leitor PDF. Actualize a página e tente novamente.')); }, { once: true });
      worker = pdfjs.PDFWorker.create({ port });
      task = pdfjs.getDocument({ data: new Uint8Array(buffer), worker, disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, stopAtErrors: true, enableXfa: false, verbosity: 0 });
      const doc = await task.promise;
      if (doc.numPages > PDF_IMPORT_PAGES) problem(`O PDF admite até ${PDF_IMPORT_PAGES} páginas.`);
      const pages: PdfTextItem[][] = []; let characters = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        options.signal?.throwIfAborted(); options.progress?.(i, doc.numPages);
        const page = await doc.getPage(i), content = await page.getTextContent();
        if (content.items.length > 25_000) problem('O PDF tem demasiado texto numa página.');
        const items = content.items.filter((v): v is typeof v & PdfTextItem => 'str' in v);
        characters += items.reduce((sum, item) => sum + item.str.length, 0);
        if (characters > 2_000_000) problem('O texto do PDF excede o limite de importação.');
        pages.push(items); page.cleanup();
      }
      return trialBalanceFromPdfPages(pages);
    })(), interrupted]);
  } catch (error) {
    if ((error as Error).name === 'PasswordException') problem('O PDF está protegido por palavra-passe. Exporte uma cópia sem protecção para importar.');
    throw error;
  } finally {
    stopped = true;
    clearTimeout(timeout); if (abort) options.signal?.removeEventListener('abort', abort);
    void task?.destroy().catch(() => {}); worker?.destroy(); port?.terminate();
  }
}
