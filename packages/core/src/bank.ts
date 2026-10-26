import type { Minor } from './money.js';

/**
 * Conciliação bancária de pessoal: leitura de extractos (CSV exportado do homebanking) e correspondência
 * entre movimentos a débito e os pagamentos de salários, INSS e IRT.
 *
 * Os bancos angolanos exportam formatos diferentes (BAI, BFA, BIC, Atlântico, BPC…): cabeçalhos com linhas de
 * identificação da conta antes da tabela, valor numa coluna com sinal ou em Débito/Crédito separados, ordem
 * cronológica crescente ou decrescente, números "1.234.567,89" ou "1 234 567,89". O leitor detecta tudo isto e
 * a interface deixa corrigir a correspondência das colunas.
 */

export interface StatementMapping {
  date: number;
  description: number;
  /** Coluna única com sinal (negativo = saída). */
  amount?: number;
  /** Ou colunas separadas de débito (saídas) e crédito (entradas). */
  debit?: number;
  credit?: number;
  balance?: number;
  reference?: number;
}

export interface StatementRow { line: number; date: string; description: string; reference: string | null; amountMinor: Minor; balanceMinor: Minor | null }

export interface ParsedStatement {
  separator: string;
  headerRow: number;
  headers: string[];
  mapping: StatementMapping | null;
  rows: StatementRow[];
  problems: { line: number; message: string }[];
  from: string | null;
  to: string | null;
  inflowMinor: Minor;
  outflowMinor: Minor;
  /** Verificação de saldos (só quando há coluna de saldo): saldo anterior + movimento = saldo da linha. */
  balance: { openingMinor: Minor; closingMinor: Minor; ok: boolean; breaks: number[] } | null;
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Lê CSV com aspas, separador detectado automaticamente (; , ou tabulação). */
export function parseCsv(text: string, separator?: string): { rows: string[][]; separator: string } {
  const t = text.replace(/^﻿/, '');
  const sample = t.split(/\r?\n/).slice(0, 40).join('\n');
  const sep = separator ?? ([';', '\t', ','] as const).map((s) => [s, sample.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; }
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  // Linhas vazias mantêm-se para os números de linha corresponderem ao ficheiro.
  return { rows, separator: sep };
}

/**
 * Valor monetário em cêntimos. Aceita "1.234.567,89", "1 234 567,89", "1,234,567.89", "-1234.5", "(1.000,00)",
 * "1.000,00 D" / "C", "Kz 1.000,00". Um único ponto seguido de exactamente 3 dígitos é separador de milhares
 * (convenção angolana: "1.500" = mil e quinhentos).
 */
export function parseAmount(raw: string): Minor | null {
  let s = raw.replace(/[  \s]/g, '').toUpperCase().replace(/^(KZ|AOA)|(KZ|AOA)$/g, '');
  if (s === '' || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/D$/.test(s)) { neg = true; s = s.slice(0, -1); } else if (/C$/.test(s)) s = s.slice(0, -1);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let int = s;
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const d = Math.max(lastDot, lastComma);
    int = s.slice(0, d); dec = s.slice(d + 1);
  } else if (lastComma >= 0) {
    if (s.split(',').length === 2 && /,\d{1,2}$/.test(s)) { int = s.slice(0, lastComma); dec = s.slice(lastComma + 1); }
  } else if (lastDot >= 0) {
    if (s.split('.').length === 2 && !/\.\d{3}$/.test(s)) { int = s.slice(0, lastDot); dec = s.slice(lastDot + 1); }
  }
  int = int.replace(/[.,]/g, '');
  if (!/^\d*$/.test(int) || !/^\d{0,2}$/.test(dec)) return null;
  const minor = Number(int || '0') * 100 + Number(dec.padEnd(2, '0') || '0');
  return neg ? -minor : minor;
}

/** Data AAAA-MM-DD a partir de dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, dd/mm/aa, aaaa-mm-dd (com ou sem hora) ou número de série do Excel. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number; let m: number; let d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (r) { y = +r[1]!; m = +r[2]!; d = +r[3]!; } else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/.exec(s))) {
    d = +r[1]!; m = +r[2]!; y = +r[3]!; if (y < 100) y += 2000;
  } else if (/^\d{5}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return dt.toISOString().slice(0, 10);
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const HEADER_HINTS: Record<keyof StatementMapping, RegExp> = {
  date: /^(DATA( (MOV(IMENTO)?|OPERACAO|LANC(AMENTO)?|CONTABILISTICA))?|DT\.? ?(MOV|OPER|LANC)\.?|DATE|BOOKING DATE)$/,
  description: /^(DESCRI(CAO|TIVO)|DESCRITIVO|MOVIMENTO|HISTORICO|DESIGNACAO|DETALHES?|DESCRIPTION|NARRATIVA|OPERACAO)$/,
  amount: /^(MONTANTE|VALOR|IMPORTANCIA|AMOUNT|VALOR \((KZ|AOA)\)|MONTANTE \((KZ|AOA)\))$/,
  debit: /^(DEBITO|DEBITOS|SAIDAS?|DEBIT|VALOR A DEBITO|DEB\.?)$/,
  credit: /^(CREDITO|CREDITOS|ENTRADAS?|CREDIT|VALOR A CREDITO|CRED\.?)$/,
  balance: /^(SALDO( (CONTABILISTICO|DISPONIVEL|APOS MOVIMENTO|FINAL))?|BALANCE)$/,
  reference: /^(REF(ERENCIA|\.)?|N\.?º? ?(DOC(UMENTO)?|OPERACAO|REF)|DOCUMENTO|NUM(ERO)? DOC(UMENTO)?|REFERENCE)$/,
};

/** Correspondência automática das colunas a partir dos cabeçalhos. */
export function guessMapping(headers: string[]): Partial<StatementMapping> {
  const out: Partial<StatementMapping> = {};
  const h = headers.map((x) => strip(x).replace(/[:*.º°]/g, '').trim());
  for (const key of Object.keys(HEADER_HINTS) as (keyof StatementMapping)[]) {
    const i = h.findIndex((x, j) => HEADER_HINTS[key].test(x) && !Object.values(out).includes(j));
    if (i >= 0) out[key] = i;
  }
  // "Data valor" só serve de data se não houver data de movimento.
  if (out.date === undefined) { const i = h.findIndex((x) => /^DATA( )?VALOR$/.test(x)); if (i >= 0) out.date = i; }
  return out;
}

export function mappingProblem(m: Partial<StatementMapping> | null): string | null {
  if (!m || m.date === undefined) return 'Indique a coluna da data';
  if (m.description === undefined) return 'Indique a coluna do descritivo';
  if (m.amount === undefined && m.debit === undefined && m.credit === undefined) return 'Indique a coluna do valor (ou as colunas de débito e crédito)';
  return null;
}

function balanceBreaks(rows: StatementRow[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) if (rows[i]!.balanceMinor !== rows[i - 1]!.balanceMinor! + rows[i]!.amountMinor) out.push(rows[i]!.line);
  return out;
}

/** Lê o extracto. Sem mapping, detecta a linha de cabeçalho (até à 30.ª) e as colunas. */
export function parseStatement(text: string, opts: { mapping?: StatementMapping; headerRow?: number } = {}): ParsedStatement {
  const { rows: all, separator } = parseCsv(text);
  let headerRow = opts.headerRow ?? -1;
  if (headerRow < 0) {
    let best = 0;
    for (let i = 0; i < Math.min(30, all.length); i++) {
      const g = guessMapping(all[i]!);
      const score = Object.keys(g).length + (g.date !== undefined ? 1 : 0);
      if (score > best && g.date !== undefined && (g.amount !== undefined || g.debit !== undefined || g.credit !== undefined)) { best = score; headerRow = i; }
    }
  }
  const headers = headerRow >= 0 ? all[headerRow]! : (all[0] ?? []).map((_, i) => `Coluna ${i + 1}`);
  const guessed = headerRow >= 0 ? guessMapping(headers) : {};
  const mapping = opts.mapping ?? (mappingProblem(guessed) ? null : (guessed as StatementMapping));
  const empty: ParsedStatement = { separator, headerRow, headers, mapping, rows: [], problems: [], from: null, to: null, inflowMinor: 0, outflowMinor: 0, balance: null };
  if (!mapping) return { ...empty, problems: [{ line: 0, message: mappingProblem(guessed) ?? 'Cabeçalho não reconhecido' }] };

  const problems: ParsedStatement['problems'] = [];
  let rows: StatementRow[] = [];
  for (let i = headerRow + 1; i < all.length; i++) {
    const r = all[i]!;
    if (!r.some((c) => c !== '')) continue;
    const line = i + 1;
    const cell = (k?: number) => (k === undefined ? '' : (r[k] ?? '').trim());
    const date = parseDate(cell(mapping.date));
    const desc = cell(mapping.description);
    if (!date) {
      // Linhas de rodapé (totais, saldo final) não têm data: ignoram-se em silêncio quando não têm valor.
      if (cell(mapping.date) && /\d/.test(cell(mapping.date))) problems.push({ line, message: `Data ilegível: "${cell(mapping.date)}"` });
      continue;
    }
    let amount: number | null;
    if (mapping.amount !== undefined) amount = parseAmount(cell(mapping.amount));
    else {
      const d = parseAmount(cell(mapping.debit));
      const c = parseAmount(cell(mapping.credit));
      amount = d === null && c === null ? null : Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    if (amount === null) { problems.push({ line, message: 'Valor em falta ou ilegível' }); continue; }
    if (amount === 0) continue;
    const bal = mapping.balance !== undefined ? parseAmount(cell(mapping.balance)) : null;
    rows.push({ line, date, description: desc || '(sem descritivo)', reference: cell(mapping.reference) || null, amountMinor: amount, balanceMinor: bal });
  }

  let balance: ParsedStatement['balance'] = null;
  if (rows.length && rows.every((r) => r.balanceMinor !== null)) {
    const rev = [...rows].reverse();
    const asc = balanceBreaks(rows);
    const desc = balanceBreaks(rev);
    const useRev = desc.length < asc.length || (desc.length === asc.length && rows[0]!.date > rows[rows.length - 1]!.date);
    const breaks = useRev ? desc : asc;
    if (useRev) rows = rev;
    balance = { openingMinor: rows[0]!.balanceMinor! - rows[0]!.amountMinor, closingMinor: rows[rows.length - 1]!.balanceMinor!, ok: breaks.length === 0, breaks };
  } else if (rows.length > 1 && rows[0]!.date > rows[rows.length - 1]!.date) rows = [...rows].reverse();

  const dates = rows.map((r) => r.date).sort();
  return {
    separator, headerRow, headers, mapping, rows, problems,
    from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
    inflowMinor: rows.filter((r) => r.amountMinor > 0).reduce((s, r) => s + r.amountMinor, 0),
    outflowMinor: rows.filter((r) => r.amountMinor < 0).reduce((s, r) => s - r.amountMinor, 0),
    balance,
  };
}

/** Impressão digital de um movimento, para não importar duas vezes o mesmo movimento quando os extractos se sobrepõem. */
export function lineFingerprint(r: Pick<StatementRow, 'date' | 'amountMinor' | 'description' | 'balanceMinor'>): string {
  return `${r.date}|${r.amountMinor}|${strip(r.description).replace(/[^A-Z0-9]/g, '')}|${r.balanceMinor ?? ''}`;
}

/** Que linhas do extracto são novas: movimentos idênticos repetidos contam-se (dois débitos iguais no mesmo dia são dois). */
export function newRows<T extends StatementRow>(rows: T[], existing: Map<string, number>): { fresh: T[]; duplicates: number } {
  const seen = new Map<string, number>();
  const fresh: T[] = [];
  for (const r of rows) {
    const f = lineFingerprint(r);
    const n = (seen.get(f) ?? 0) + 1;
    seen.set(f, n);
    if (n > (existing.get(f) ?? 0)) fresh.push(r);
  }
  return { fresh, duplicates: rows.length - fresh.length };
}

// ——— Correspondência ———

export type PaymentKind = 'salaries' | 'inss' | 'irt' | 'expense';
export interface OpenBankLine { id: string; date: string; description: string; reference: string | null; amountMinor: Minor }
/** Pagamento registado no Kianda ou obrigação por pagar. `parts` = líquidos individuais (salários pagos por transferências separadas). */
export interface ExpectedPayment { key: string; kind: PaymentKind; period: string; amountMinor: Minor; date: string; reference: string | null; parts?: Minor[] }
export interface PaymentMatch { key: string; lineIds: string[]; rule: 'valor_exacto' | 'transferencias_individuais'; score: number; auto: boolean }

const KEYWORDS: Record<PaymentKind, string[]> = {
  salaries: ['SALAR', 'VENCIM', 'ORDENAD', 'REMUNER', 'FOLHA'],
  inss: ['INSS', 'SEG SOCIAL', 'SEGURANCA SOCIAL', 'CONTRIB'],
  irt: ['IRT', 'AGT', 'IMPOSTO', 'RUP', 'DLI'],
  expense: ['REEMB', 'DESPESA', 'AJUDA', 'DESLOC', 'ND-'],
};
const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / DAY;

/** Pontuação de um movimento face a um pagamento esperado (0 = incompatível). O valor tem de ser exacto. */
export function paymentScore(l: OpenBankLine, p: ExpectedPayment, window: { before: number; after: number }): number {
  if (l.amountMinor >= 0 || -l.amountMinor !== p.amountMinor) return 0;
  const gap = days(l.date, p.date);
  if (gap < -window.before || gap > window.after) return 0;
  const text = strip(`${l.description} ${l.reference ?? ''}`);
  let s = 50;
  if (KEYWORDS[p.kind].some((k) => text.includes(k))) s += 25;
  const [y, m] = p.period.split('-') as [string, string];
  if ([`${m}/${y}`, `${m}-${y}`, `${m}/${y.slice(2)}`, `${y}${m}`, `${y}-${m}`].some((r) => text.includes(r))) s += 15;
  else if (/\b(0[1-9]|1[0-2])[/-](20)?\d{2}\b/.test(text)) s -= 30; // refere outro período
  if (p.reference && p.reference.length >= 4 && text.replace(/\s/g, '').includes(strip(p.reference).replace(/\s/g, ''))) s += 40;
  return s - Math.min(10, Math.abs(gap));
}

/**
 * Propõe correspondências. Regras, por ordem:
 * 1. Valor exacto (um movimento = um pagamento), dentro da janela de datas. Automática só sem ambiguidade:
 *    o movimento é o único candidato do pagamento e o pagamento o único do movimento, ou a pontuação
 *    destaca-se (palavras-chave/referência) por 20 pontos.
 * 2. Transferências individuais (salários): cada líquido corresponde a um débito com o mesmo valor; aceita-se
 *    quando todos os líquidos são encontrados — é sempre automática, porque o conjunto confirma-se a si próprio.
 */
export function matchPayments(lines: OpenBankLine[], expected: ExpectedPayment[], window = { before: 5, after: 10 }): PaymentMatch[] {
  const debits = lines.filter((l) => l.amountMinor < 0);
  const used = new Set<string>();
  const out: PaymentMatch[] = [];
  const pairs = expected.flatMap((p) => debits.map((l) => ({ p, l, s: paymentScore(l, p, window) }))).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const byPayment = new Map<string, typeof pairs>();
  const byLine = new Map<string, typeof pairs>();
  for (const x of pairs) {
    byPayment.set(x.p.key, [...(byPayment.get(x.p.key) ?? []), x]);
    byLine.set(x.l.id, [...(byLine.get(x.l.id) ?? []), x]);
  }
  const done = new Set<string>();
  for (const x of pairs) {
    if (done.has(x.p.key) || used.has(x.l.id)) continue;
    const pc = byPayment.get(x.p.key)!.filter((y) => !used.has(y.l.id));
    const lc = byLine.get(x.l.id)!.filter((y) => !done.has(y.p.key));
    const second = Math.max(pc[1]?.s ?? 0, lc[1]?.s ?? 0);
    const auto = (pc.length === 1 && lc.length === 1) || x.s - second >= 20;
    out.push({ key: x.p.key, lineIds: [x.l.id], rule: 'valor_exacto', score: x.s, auto });
    if (auto) { used.add(x.l.id); done.add(x.p.key); }
  }
  // Sugestões não automáticas não reservam o movimento; ficam só as melhores por pagamento.
  const result = out.filter((m) => m.auto || !done.has(m.key)).filter((m, i, a) => a.findIndex((n) => n.key === m.key) === i);

  for (const p of expected) {
    if (done.has(p.key) || !p.parts?.length) continue;
    const parts = p.parts.filter((v) => v > 0);
    if (parts.length < 2 || parts.reduce((s, v) => s + v, 0) !== p.amountMinor) continue;
    const pool = debits.filter((l) => !used.has(l.id) && (() => { const g = days(l.date, p.date); return g >= -window.before && g <= window.after; })());
    const taken = new Set<string>();
    const ids: string[] = [];
    for (const v of [...parts].sort((a, b) => b - a)) {
      const cand = pool.filter((l) => !taken.has(l.id) && -l.amountMinor === v).sort((a, b) => Math.abs(days(a.date, p.date)) - Math.abs(days(b.date, p.date)))[0];
      if (!cand) break;
      taken.add(cand.id); ids.push(cand.id);
    }
    if (ids.length === parts.length) {
      ids.forEach((id) => used.add(id)); done.add(p.key);
      const i = result.findIndex((m) => m.key === p.key);
      if (i >= 0) result.splice(i, 1);
      result.push({ key: p.key, lineIds: ids, rule: 'transferencias_individuais', score: 90, auto: true });
    }
  }
  return result;
}

/** Pagamentos registados sem movimento bancário correspondente há mais de `graceDays` dias. */
export function missingProof(paidOn: string, today: string, graceDays = 5): boolean {
  return days(today, paidOn) > graceDays;
}
