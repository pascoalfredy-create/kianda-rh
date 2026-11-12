/**
 * Importação de balancetes mensais para o Valora (real mensal e controlo orçamental).
 *
 * Corrige os defeitos encontrados nas auditorias de 5–8/11/2026:
 * - a unidade de origem é obrigatória (Kz, milhares ou milhões) e a conversão para o modelo (milhões de Kz) faz-se uma vez;
 * - a precisão é mantida ao cêntimo (sem arredondar a 0,1 milhões);
 * - contas-mãe com subcontas no mesmo ficheiro não são somadas (fica o nível mais detalhado);
 * - os sinais seguem a natureza das contas: um saldo de natureza contrária fica negativo e é assinalado;
 * - o ano das colunas tem de ser o do exercício analisado;
 * - movimentos acumulados das classes 6 e 7 podem ser convertidos em movimentos do mês;
 * - aceita Excel (com escolha da folha), CSV/TXT, Word (DOCX) e PDF com texto.
 */
import { DOCUMENT_LIMIT, parseCsv } from '@kianda/core';
import { decodeDocumentText, extractWordRows } from '../lib/document-import';
import { readXlsxRows, readXlsxWorkbookInfo } from '../lib/employee-xlsx';
import { extractPdfContent, pdfPageRows, type PdfTextItem } from '../modeling/pdf-import';

export type BalanceCell = string | number | boolean | null;
export const BALANCE_IMPORT_ACCEPT = '.xlsx,.csv,.txt,.pdf,.docx';
export const BALANCE_UNITS = { kz: 1, mil: 1e3, milhoes: 1e6 } as const;
export type BalanceUnit = keyof typeof BALANCE_UNITS;

/** Prefixos PGC → rubrica do modelo (o prefixo mais longo ganha). */
export const BALANCE_MAP: [string, string][] = [['61', 'v61'], ['62', 'v62'], ['63', 'v63'], ['64', 'v63'], ['65', 'v63'], ['66', 'p66'], ['67', 'p66'], ['71', 'c71'], ['72', 'c72'], ['73', 'c73'], ['75', 'c75'], ['76', 'c76'], ['77', 'c76'], ['68', 'p68'], ['69', 'p68'], ['78', 'c78'], ['79', 'c78'],
  ['11', 'imob'], ['12', 'imob'], ['14', 'imob'], ['18', 'amort'], ['13', 'invfin'], ['19', 'invfin'], ['2', 'exist'], ['29', 'exist'], ['31', 'clientes'], ['38', 'clientes'], ['39', 'outcred'], ['49', 'caixa'], ['32', 'fornec'], ['33', 'empMLP'], ['34', 'estado'], ['35', 'outcred'], ['36', 'outcred'], ['37', 'outcred'], ['4', 'caixa'],
  ['51', 'capital'], ['52', 'reservas'], ['53', 'reservas'], ['54', 'reservas'], ['55', 'reservas'], ['56', 'reservas'], ['57', 'reservas'], ['58', 'reservas'], ['59', 'reservas'], ['81', 'reservas'], ['87', 'imp']];
export const BALANCE_IGNORED = ['82', '83', '84', '85', '86', '88', '89'];
/** Provisões que abatem ao activo (saldo credor reduz a rubrica): investimentos financeiros, existências, clientes e aplicações de tesouraria. */
const CONTRA_ASSET = ['19', '29', '38', '49'];
/** Contas de natureza credora (saldo normal a crédito): proveitos, passivos e capital. As amortizações acumuladas (18) também. */
const CREDIT_NORMAL = ['18', '19', '29', '32', '33', '38', '39', '49', '51', '52', '53', '54', '55', '56', '57', '58', '59', '61', '62', '63', '64', '65', '66', '67', '68', '69', '81'];
const MIXED = ['34', '35', '36', '37'];
const FLOW_PREFIX = /^(?:[67]|87)/;
/** Chaves das rubricas do modelo, aceites no lugar da conta (ex.: «empCP», que não tem conta PGC própria). */
export const BALANCE_KEYS = ['v61', 'v62', 'v63', 'c71', 'c72', 'c73', 'c75', 'p66', 'c76', 'p68', 'c78', 'imp', 'imob', 'amort', 'invfin', 'exist', 'clientes', 'outdev', 'caixa', 'capital', 'reservas', 'empMLP', 'empCP', 'fornec', 'estado', 'outcred'];
const FLOW_KEYS = new Set(['v61', 'v62', 'v63', 'c71', 'c72', 'c73', 'c75', 'p66', 'c76', 'p68', 'c78', 'imp']);
const CREDIT_KEYS = new Set(['v61', 'v62', 'v63', 'p66', 'p68', 'amort', 'empMLP', 'empCP', 'fornec', 'estado', 'outcred', 'capital', 'reservas']);

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Mês (0–11) e ano (se indicado) de um cabeçalho: «Jan», «janeiro 2026», «2026-01», «01/2026», «jan-26», «M1». */
export function monthHeader(h: unknown): { month: number; year: number | null } | null {
  const s = String(h ?? '').toLowerCase().trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return +m[2]! >= 1 && +m[2]! <= 12 ? { month: +m[2]! - 1, year: +m[1]! } : null;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return +m[1]! >= 1 && +m[1]! <= 12 ? { month: +m[1]! - 1, year: +m[2]! } : null;
  m = s.match(/^m?(\d{1,2})$/);
  if (m) return +m[1]! >= 1 && +m[1]! <= 12 ? { month: +m[1]! - 1, year: null } : null;
  for (let i = 0; i < 12; i++) {
    if (s.startsWith(MONTHS_PT[i]!) || s.startsWith(MONTHS_EN[i]!)) {
      const y = s.match(/(\d{4}|\d{2})\s*$/);
      const year = y ? (y[1]!.length === 2 ? 2000 + +y[1]! : +y[1]!) : null;
      return { month: i, year };
    }
  }
  return null;
}

/** Número escrito à portuguesa ou com ponto decimal; parênteses e sinal final «-» como negativo. */
export function balanceNumber(v: BalanceCell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s  ]/g, '').replace(/kz$/i, '');
  if (!s || s === '-' || s === '—') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = (s.match(/,/g)!.length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export interface BalanceOptions {
  unit: BalanceUnit | '';
  /** Saldos credores com sinal negativo (convenção de balancete). Sem esta convenção, os valores vêm todos positivos. */
  signed: boolean;
  /** Classes 6 e 7 em acumulado do ano (convertidas para movimentos do mês). */
  cumulative: boolean;
  /** Exercício da análise: colunas de outro ano são recusadas. */
  year: number;
  /** Mês seleccionado para um ficheiro ERP com coluna de saldo final (1–12). */
  erpMonth?: number;
  /** O saldo final das contas de resultados corresponde apenas ao movimento do mês escolhido. */
  erpMonthly?: boolean;
  mapping?: Readonly<Record<string, string>>;
}
export interface BalanceLine {
  code: string; desc: string; key: string; total: number; contrary: boolean;
  movements?: { month: number; previous: number; current: number; movement: number }[];
}
export interface BalanceResult {
  error?: string;
  /** Valores por rubrica e mês, em milhões de Kz (unidade interna do modelo), com precisão ao cêntimo. */
  acc: Record<string, Record<number, number>>;
  lines: BalanceLine[];
  ignored: string[];
  /** Contas-mãe não somadas porque o ficheiro traz as subcontas. */
  parents: string[];
  months: number[];
  warnings: string[];
  /** Controlo por mês: resultado (6 − 7, em Kz) e diferença de balanço (activo − passivo − capital − resultado acumulado, em Kz). */
  control: { month: number; resultKz: number; differenceKz: number | null }[];
}

const empty = (error: string): BalanceResult => ({ error, acc: {}, lines: [], ignored: [], parents: [], months: [], warnings: [], control: [] });
const round8 = (v: number) => Math.round(v * 1e8) / 1e8; // 1e-8 milhões = 1 cêntimo

function rubric(code: string, natural: number): { key: string | null; value: number; contrary?: boolean } {
  const d = code.replace(/[^\d]/g, '');
  if (!d) return { key: null, value: 0 };
  if (BALANCE_IGNORED.some((p) => d.startsWith(p))) return { key: null, value: 0 };
  const m = BALANCE_MAP.filter(([p]) => d.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
  if (!m) return { key: null, value: 0 };
  // 34–37: saldo devedor vai para «Estado e outros devedores», credor para a rubrica do passivo.
  if (MIXED.some((p) => d.startsWith(p))) return natural >= 0 ? { key: 'outdev', value: natural } : { key: m[1], value: -natural };
  // Provisão de natureza credora: abate à rubrica do activo; só é contrária se vier com saldo devedor.
  if (CONTRA_ASSET.some((p) => d.startsWith(p))) return { key: m[1], value: -natural, contrary: natural < 0 };
  return { key: m[1], value: natural, contrary: natural < 0 };
}

const digitsOf = (code: string) => code.match(/^(\d+(?:[.\s-]\d+)*)(?:\s*[-–—]?\s+[A-Za-zÀ-ÿ].*)?$/)?.[1]?.replace(/\D/g, '') ?? '';
const keyOf = (code: string) => BALANCE_KEYS.find(k => k.toLowerCase() === code.toLowerCase());
const normalise = (value: BalanceCell) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
const closingColumn = (row: BalanceCell[]) => row.findIndex((value, i) => i > 0 && /^(saldo final|saldo actual|saldo atual|saldo acumulado)$/.test(normalise(value)));
function balanceHeader(row: BalanceCell[]) {
  const code = normalise(row[0] ?? null);
  const accountColumn = !code || /\b(conta|codigo|rubrica|pgc|account|code)\b/.test(code);
  return accountColumn && (closingColumn(row) > 0 || row.some((c, i) => i > 0 && monthHeader(c)));
}

export function isErpBalance(rows: BalanceCell[][]) {
  const header = rows.find(balanceHeader);
  return header !== undefined && closingColumn(header) > 0;
}

export function parseBalance(rows: BalanceCell[][], opts: BalanceOptions): BalanceResult {
  if (!opts.unit || !(opts.unit in BALANCE_UNITS)) return empty('Indique a unidade dos valores do ficheiro (Kz, milhares de Kz ou milhões de Kz) antes de pré-visualizar.');
  const factor = BALANCE_UNITS[opts.unit] / 1e6;
  const hi = rows.findIndex(balanceHeader);
  if (hi < 0) return empty('Indique colunas de meses (Jan, Fev, 2026-01) ou uma coluna «Saldo final» no balancete.');
  const hdr = rows[hi]!;
  const finalCol = closingColumn(hdr);
  const erp = finalCol > 0;
  const month = (opts.erpMonth ?? 0) - 1;
  if (erp && (!Number.isInteger(month) || month < 0 || month > 11)) return empty('Seleccione o mês do saldo final no balancete do ERP.');
  const cols = erp
    ? [[finalCol, { month, year: opts.year }]] as const
    : hdr.flatMap((value, i) => { const m = i > 0 ? monthHeader(value) : null; return m ? [[i, m] as const] : []; });
  const other = cols.find(([, m]) => m.year !== null && m.year !== opts.year);
  if (other) return empty(`O ficheiro tem colunas de ${other[1].year}; esta análise é do exercício ${opts.year}. Escolha o balancete do exercício certo.`);
  const months = [...new Set(cols.map(([, m]) => m.month))].sort((a, b) => a - b);
  if (months.length !== cols.length) return empty('O cabeçalho repete o mesmo mês. Deixe uma coluna por mês.');
  const descCol = hdr.length > 1 && !monthHeader(hdr[1]) && finalCol !== 1 ? 1 : -1;
  const cumulative = erp ? !opts.erpMonthly : opts.cumulative;
  const priorCol = erp && cumulative && month > 0
    ? hdr.findIndex((value, i) => i > 0 && normalise(value) === 'saldo do mes anterior')
    : -1;
  const sourceCols = priorCol > 0 ? [...cols, [priorCol, { month: month - 1, year: opts.year }] as const] : cols;

  type Raw = { code: string; digits: string; desc: string; values: Record<number, number>; key?: string };
  const raw = new Map<string, Raw>(), ignored: string[] = [], warnings: string[] = [];
  for (const r of rows.slice(hi + 1)) {
    const code = String(r[0] ?? '').trim();
    if (!code) continue;
    if (balanceHeader(r)) {
      if (JSON.stringify(r.map(normalise)) !== JSON.stringify(hdr.map(normalise))) return empty('O ficheiro tem cabeçalhos diferentes. Use uma só estrutura de colunas por importação.');
      continue;
    }
    const key = keyOf(code), digits = key ? '' : digitsOf(code);
    const desc = descCol > 0 ? String(r[descCol] ?? '') : '';
    if (!digits && !key) { ignored.push(code); continue; }
    const id = key ?? digits, existing = raw.get(id);
    const values: Record<number, number> = existing?.values ?? {};
    for (const [i, m] of sourceCols) {
      const cell = r[i] ?? null;
      if (!String(cell ?? '').trim() || ['-', '—', '–'].includes(String(cell).trim())) continue;
      const value = balanceNumber(cell), mkz = value === null ? NaN : round8(value * factor);
      if (!Number.isSafeInteger(Math.round(mkz * 1e8))) return empty(`Valor inválido na conta ${code}, ${MONTHS_PT[m.month]}. Verifique o número e a unidade.`);
      if (values[m.month] !== undefined) return empty(`A conta ${code} aparece mais de uma vez em ${MONTHS_PT[m.month]}. Confirme o detalhe antes de importar.`);
      values[m.month] = mkz;
    }
    if (Object.keys(values).length) raw.set(id, { code, digits, desc, values, key });
  }

  // Verifica cada subtotal contra os seus filhos imediatos antes de usar apenas o detalhe.
  const children = new Map<string, string[]>(), ancestors: string[] = [];
  for (const code of [...raw.values()].map(x => x.digits).filter(Boolean).sort()) {
    while (ancestors.length && !code.startsWith(ancestors.at(-1)!)) ancestors.pop();
    const parent = ancestors.at(-1);
    if (parent) {
      const list = children.get(parent) ?? [];
      list.push(code);
      children.set(parent, list);
    }
    ancestors.push(code);
  }
  for (const [code, childCodes] of children) {
    const parent = raw.get(code)!;
    for (const [, { month: m }] of sourceCols) {
      const value = parent.values[m];
      if (value === undefined) continue;
      const childrenTotal = childCodes.reduce((sum, child) => sum + (raw.get(child)!.values[m] ?? 0), 0);
      const diff = Math.round((value - childrenTotal) * 1e8) / 100;
      if (diff !== 0) return empty(`Subtotal da conta ${parent.code} em ${MONTHS_PT[m]} difere das subcontas em ${diff.toLocaleString('pt-PT')} Kz. Inclua todo o detalhe ou importe apenas o subtotal.`);
    }
  }
  const parents = [...children.keys()].map(code => raw.get(code)!.code);
  const acc: Record<string, Record<number, number>> = {}, lines: BalanceLine[] = [];
  for (const x of raw.values()) {
    if (children.has(x.digits)) continue;
    const mapped = x.key ?? keyOf(opts.mapping?.[x.digits] ?? '');
    const credit = mapped ? CREDIT_KEYS.has(mapped) : CREDIT_NORMAL.some(p => x.digits.startsWith(p));
    const flow = mapped ? FLOW_KEYS.has(mapped) : FLOW_PREFIX.test(x.digits);
    const mixed = !mapped && MIXED.some(p => x.digits.startsWith(p));
    const movements: NonNullable<BalanceLine['movements']> = [];
    let key: string | null = null, total = 0, contrary = false;
    for (const m of months) {
      let value = x.values[m];
      if (value === undefined) continue;
      if (cumulative && flow && m > 0) {
        const previous = x.values[m - 1];
        if (previous === undefined) return empty(`Falta o saldo acumulado de ${MONTHS_PT[m - 1]} na conta ${x.code} para calcular o movimento de ${MONTHS_PT[m]}. Inclua o mês anterior ou um saldo explícito de 0 quando aplicável.`);
        movements.push({ month: m, previous, current: value, movement: round8(value - previous) });
        value -= previous;
      }
      // No modo de natureza normal, um negativo é um estorno. Contas mistas positivas representam credores.
      const natural = (opts.signed ? credit : mixed) ? -value : value;
      const got = mapped ? { key: mapped, value: natural, contrary: natural < 0 } : rubric(x.digits, natural);
      if (!got.key) break;
      key = got.key;
      contrary ||= !!got.contrary;
      const target = acc[key] ??= {};
      target[m] = round8((target[m] ?? 0) + got.value);
      total += got.value;
    }
    if (key) lines.push({ code: x.code, desc: x.desc, key, total: round8(total), contrary, ...(movements.length ? { movements } : {}) });
    else ignored.push(x.code + (x.desc ? ' ' + x.desc : ''));
  }
  const contraryLines = lines.filter(l => l.contrary);
  if (contraryLines.length) warnings.push(`${contraryLines.length} conta(s) com saldo de natureza contrária ou estorno. Confirme a classificação: ${contraryLines.slice(0, 5).map(l => l.code).join(', ')}.`);
  if (parents.length) warnings.push(`${parents.length} conta(s)-mãe reconciliadas com o detalhe e excluídas para evitar duplicação.`);
  if (!lines.length) return { ...empty('Nenhuma conta do ficheiro corresponde às rubricas do modelo. Confirme a coluna de contas PGC.'), ignored, parents };

  const get = (k: string, m: number) => acc[k]?.[m] ?? 0;
  let cumulativeResult = 0;
  const control = months.map((m, index) => {
    const proveitos = get('v61', m) + get('v62', m) + get('v63', m) + get('p66', m) + get('p68', m);
    const custos = get('c71', m) + get('c72', m) + get('c73', m) + get('c75', m) + get('c76', m) + get('c78', m) + get('imp', m);
    const result = proveitos - custos;
    cumulativeResult += result;
    const activo = get('imob', m) - get('amort', m) + get('invfin', m) + get('exist', m) + get('clientes', m) + get('outdev', m) + get('caixa', m);
    const passivo = get('empMLP', m) + get('empCP', m) + get('fornec', m) + get('estado', m) + get('outcred', m);
    const capital = get('capital', m) + get('reservas', m);
    const hasAssets = ['imob', 'amort', 'invfin', 'exist', 'clientes', 'outdev', 'caixa'].some(k => acc[k]?.[m] !== undefined);
    const hasClaims = ['empMLP', 'empCP', 'fornec', 'estado', 'outcred', 'capital', 'reservas'].some(k => acc[k]?.[m] !== undefined);
    const canReconcile = hasAssets && hasClaims && index === m;
    const differenceKz = canReconcile ? Math.round((activo - passivo - capital - cumulativeResult) * 1e8) / 100 || 0 : null;
    return { month: m, resultKz: Math.round(result * 1e8) / 100, differenceKz };
  });
  return { acc, lines, ignored, parents, months, warnings, control };
}

/** Linhas de uma tabela em PDF com texto: colunas pelo cabeçalho que tem meses. */
export function balanceRowsFromPdf(pages: PdfTextItem[][]): string[][] {
  const out: string[][] = [];
  let header: ReturnType<typeof pdfPageRows>[number] | null = null;
  for (const [index, page] of pages.entries()) {
    const rows = pdfPageRows(page);
    if (!rows.length) throw new Error(`A página ${index + 1} não contém texto seleccionável. Use Excel, Word, CSV ou um PDF com texto (um PDF digitalizado precisa de OCR).`);
    for (const row of rows) {
      const cellsText = row.map(c => c.text);
      if (balanceHeader(cellsText)) {
        if (header && JSON.stringify(header.map(c => normalise(c.text))) !== JSON.stringify(cellsText.map(normalise))) {
          throw new Error('As páginas do PDF têm cabeçalhos diferentes. Importe uma tabela com as mesmas colunas em todas as páginas.');
        }
        if (!header) out.push(cellsText);
        header = row;
        continue;
      }
      if (!header) continue;
      const cells = header.map(() => '');
      for (const cell of row) {
        const center = (cell.x + cell.end) / 2;
        const c = header.findIndex((col, i) => i === header!.length - 1 || center < (col.end + header![i + 1]!.x) / 2);
        cells[c] += (cells[c] ? ' ' : '') + cell.text;
      }
      out.push(cells);
    }
  }
  if (!header) throw new Error('O PDF deve ter um cabeçalho com os meses ou uma coluna «Saldo final».');
  return out;
}

export interface BalanceDocument { rows: BalanceCell[][]; sheets: string[] }
export async function readBalanceDocument(file: File, sheetIndex = 0): Promise<BalanceDocument> {
  if (!file.size || file.size > DOCUMENT_LIMIT) throw new Error('Seleccione um ficheiro com dados, até 10 MB.');
  if (/\.(xls|xlsm|doc)$/i.test(file.name)) throw new Error('Guarde o Excel como .xlsx ou CSV, ou o Word como .docx, antes de importar.');
  if (!/\.(xlsx|csv|txt|pdf|docx)$/i.test(file.name)) throw new Error('Seleccione Excel (.xlsx), CSV, PDF com texto ou Word (.docx).');
  const buffer = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) {
    const info = await readXlsxWorkbookInfo(buffer);
    const rows = (await readXlsxRows(buffer, { sheetIndex, maxRows: 5000, maxColumns: 64 })).map((r) => r.map((v) => (typeof v === 'boolean' ? String(v) : v)));
    return { rows, sheets: info.sheets };
  }
  if (/\.docx$/i.test(file.name)) return { rows: await extractWordRows(buffer), sheets: [] };
  if (/\.pdf$/i.test(file.name)) return { rows: await extractPdfContent(buffer, balanceRowsFromPdf), sheets: [] };
  return { rows: parseCsv(decodeDocumentText(buffer)).rows, sheets: [] };
}
