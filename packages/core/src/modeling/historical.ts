import { FinancialModelError } from './types.js';
import { financialTemplate } from './templates.js';
import { validateFinancialAssumptions } from './validation.js';
import { CLOSING_INCOME_KEYS, historicalAccountDescends, historicalClosingIncome } from './historical-closing.js';

export const FINANCIAL_HISTORICAL_VERSION = 'integra-history-3';
export interface HistoricalPeriod { from: string; to: string }
export interface FinancialHistoricalInput { empresa: string; anos: [string, string]; N1: string; N: string; pctCP: number; moeda: 'Kz' | 'USD' | 'EUR'; periods?: { N?: HistoricalPeriod; N1?: HistoricalPeriod } }
export interface HistoricalAccount { code: string; g: string; nome: string; v: number }
export interface HistoricalTrialBalance { lines: HistoricalAccount[]; diff: number; ignoredParents: number; basis: 'balance' | 'accumulated' }
const groups = new Set('11 12 13 14 18 19 21 22 23 24 25 26 27 28 29 31 32 33 34 35 36 37 38 39 41 42 43 44 45 48 49 51 52 53 54 55 56 57 58 61 62 63 64 65 66 67 68 69 71 72 73 75 76 77 78 79 81 82 83 84 85 86 87 88 89'.split(' '));
const fail = (path: string, message: string): never => { throw new FinancialModelError([{ path, message }]); };
const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const minor = (v: number) => Math.round(v * 100);
const safe = (v: number, path: string) => Number.isSafeInteger(v) ? v || 0 : fail(path, 'Montante fora do intervalo seguro.');
const round = (v: number) => safe(minor(v), 'balancete') / 100;

/** Valores monetários estritos, em cêntimos. Nunca converte texto inválido em zero. */
export function historicalAmount(value: string, path = 'balancete'): number {
  let s = value.trim().replace(/^(?:Kz|AOA|USD|EUR)\s*/i, '').replace(/\s*(?:Kz|AOA|USD|EUR)$/i, '').replace(/[\s\u00a0\u202f]/g, '');
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  if (/^\(.*\)$/.test(s)) s = s.slice(1, -1); else s = s.replace(/^[+-]/, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return fail(path, 'Valor monetário inválido.');
  let whole = s, fraction = '';
  if (s.includes(',') && s.includes('.')) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.', thousands = decimal === ',' ? '.' : ',';
    const pieces = s.split(decimal);
    if (pieces.length !== 2 || !/^\d{1,2}$/.test(pieces[1]!)) return fail(path, 'Use até duas casas decimais.');
    const grouped = pieces[0]!.split(thousands);
    if (!/^\d{1,3}$/.test(grouped[0]!) || grouped.slice(1).some((p) => !/^\d{3}$/.test(p))) return fail(path, 'Separador de milhares inválido.');
    whole = grouped.join(''); fraction = pieces[1]!;
  } else if (/[.,]/.test(s)) {
    const pieces = s.split(/[.,]/), last = pieces.at(-1)!;
    if (pieces.length === 2 && last.length <= 2) { whole = pieces[0]!; fraction = last; }
    else if (/^\d{1,3}$/.test(pieces[0]!) && pieces.slice(1).every((p) => /^\d{3}$/.test(p))) whole = pieces.join('');
    else return fail(path, 'Separadores ou casas decimais inválidos.');
  }
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return fail(path, 'Montante fora do intervalo seguro.');
  return Number(cents) * (negative ? -1 : 1);
}

function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? '\n';
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === '"' && !cell.trim() && !closed) { cell = ''; quoted = true; }
    else if (c === delimiter || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== delimiter) { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed && c.trim()) fail('balancete', 'Texto depois de uma célula CSV entre aspas.'); cell += c; }
  }
  if (quoted) fail('balancete', 'Aspas CSV por fechar.');
  if (rows.length > 5001) fail('balancete', 'O limite é de 5 000 contas por balancete.');
  return rows;
}
export function parseHistoricalTrialBalance(text: string, path = 'N'): HistoricalTrialBalance {
  if (typeof text !== 'string' || !text.trim()) return fail(path, `O balancete ${path === 'N1' ? 'comparativo N−1' : path === 'N' ? 'do período actual (N)' : path} está vazio. Carregue o ficheiro e confirme a leitura antes de analisar.`);
  if (text.length > 250_000) return fail(path, 'O texto do balancete excede 250 000 caracteres.');
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/).find((v) => v.trim())!;
  const counts = new Map([[';', 0], ['\t', 0], [',', 0]]); let quoted = false;
  for (let i = 0; i < first.length; i++) {
    if (first[i] === '"') { if (quoted && first[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && counts.has(first[i]!)) counts.set(first[i]!, counts.get(first[i]!)! + 1);
  }
  const delimiter = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!)[0]!;
  const rows = csvRows(text, delimiter), header = rows[0]!.map(norm);
  const account = header.findIndex((v) => /^(?:CONTA|CODIGO)(?: DA CONTA)?$/.test(v)), hasHeader = account >= 0;
  const index = (re: RegExp) => { const matches = header.flatMap((v, i) => re.test(v) ? [i] : []); if (matches.length > 1) fail(path, 'Colunas de saldo ambíguas.'); return matches[0] ?? -1; };
  const name = hasHeader ? index(/^(?:DESIGNACAO|DESCRICAO|NOME)(?: DA CONTA)?$/) : 1;
  const sd = hasHeader ? index(/^(?:SALDO )?DEVEDOR$/) : -1, sc = hasHeader ? index(/^(?:SALDO )?CREDOR$/) : -1;
  const d = hasHeader ? index(/^DEBITO$/) : -1, cr = hasHeader ? index(/^CREDITO$/) : -1, signed = hasHeader ? index(/^SALDO$/) : rows[0]!.length === 3 ? 2 : -1;
  const debit = sd >= 0 || sc >= 0 ? sd : d, credit = sd >= 0 || sc >= 0 ? sc : cr;
  if (hasHeader && signed < 0 && (debit < 0 || credit < 0)) return fail(path, 'Indique Saldo Devedor e Saldo Credor, Débito e Crédito acumulados, ou Saldo com sinal.');
  const accounts = new Map<string, { code: string; g: string; nome: string; cents: number }>();
  for (const [i, row] of rows.slice(hasHeader ? 1 : 0).entries()) {
    const raw = row[hasHeader ? account : 0] ?? '', linePath = `${path}.linha${i + (hasHeader ? 2 : 1)}`;
    if (/^(?:TOTAL|TOTAIS|TOTAL GERAL|TOTAL DO BALANCETE|TRANSPORTE)$/i.test(raw)) continue;
    if (!/^\d[\d.\s-]*$/.test(raw)) return fail(linePath, 'Código de conta inválido.');
    const code = raw.replace(/[.\s-]/g, '');
    if (code.length < 2 || code.length > 18) return fail(linePath, 'Use contas PGC com pelo menos dois dígitos.');
    if (accounts.has(code)) return fail(linePath, `Conta ${raw} repetida.`);
    const g = code.slice(0, 2);
    const at = (ix: number) => { if (ix < 0 || ix >= row.length) return fail(linePath, 'Faltam colunas de saldo.'); return historicalAmount(row[ix]!, linePath); };
    let cents: number;
    if (signed >= 0 && debit < 0) cents = at(signed);
    else {
      const dr = at(hasHeader ? debit : 2), co = at(hasHeader ? credit : 3);
      if (dr < 0 || co < 0 || (sd >= 0 || sc >= 0 || !hasHeader) && dr > 0 && co > 0) return fail(linePath, 'Os saldos devedor/credor devem ser não negativos e apenas um pode estar preenchido.');
      cents = safe(dr - co, linePath);
    }
    if (!groups.has(g)) {
      if (cents !== 0) return fail(linePath, ['82', '83', '84', '85', '86', '88'].includes(g) ? 'Use um balancete antes do apuramento de resultados, com as classes 6 e 7.' : `A conta ${raw} não tem classificação PGC suportada.`);
      continue;
    }
    accounts.set(code, { code: raw, g, nome: name >= 0 ? row[name] ?? '' : '', cents });
  }
  const codes = [...accounts.keys()].sort(), leaves = codes.filter((v, i) => {
    for(let j=i+1;j<codes.length&&codes[j]!.startsWith(v);j++)if(historicalAccountDescends(codes[j]!,v))return false;
    return true;
  });
  if (!leaves.length) return fail(path, 'Nenhuma conta PGC encontrada.');
  const descendantTotals = new Map<string, number>();
  for (const code of leaves) for (let n = 2; n < code.length; n++) { const parent = code.slice(0, n); if (accounts.has(parent)&&historicalAccountDescends(code,parent)) descendantTotals.set(parent, safe((descendantTotals.get(parent) ?? 0) + accounts.get(code)!.cents, path)); }
  for (const [parent, total] of descendantTotals) if (accounts.get(parent)!.cents !== total) return fail(path, `A conta-mãe ${accounts.get(parent)!.code} não corresponde às subcontas. Inclua todas as subcontas ou apenas o total.`);
  const lines = leaves.map((v) => { const a = accounts.get(v)!; return { code: a.code, g: a.g, nome: a.nome, v: a.cents / 100 }; });
  return { lines, diff: leaves.reduce((s, v) => safe(s + accounts.get(v)!.cents, path), 0) / 100, ignoredParents: accounts.size - leaves.length, basis: hasHeader && sd < 0 && sc < 0 && d >= 0 ? 'accumulated' : 'balance' };
}

function classify(p: HistoricalTrialBalance, pctCP: number) {
  const group = (...gs: string[]) => p.lines.filter((l) => gs.includes(l.g)).reduce((s, l) => safe(s + minor(l.v), 'balancete'), 0);
  const split = (gs: string[], debit: boolean) => p.lines.filter((l) => gs.includes(l.g) && (debit ? l.v > 0 : l.v < 0)).reduce((s, l) => safe(s + minor(l.v), 'balancete'), 0);
  const imobB = group('11', '12', '14'), amort = group('18'), invFin = group('13', '19');
  const exist = group('21', '22', '23', '24', '25', '26', '27', '28', '29'), clientes = split(['31'], true) + group('38');
  const oAct = split(['32', '33', '34', '35', '36', '37', '39'], true), oPas = -split(['31', '34', '35', '36', '37'], false);
  const caixa = group('41', '42', '43', '44', '45', '48', '49'), fornec = -split(['32'], false), emprest = -split(['33'], false), prov = -split(['39'], false);
  const closing = historicalClosingIncome(p.lines);
  const P = { vendas: -group('61'), prest: -group('62'), oProv: -group('63', '64', '65'), cev: group('71'), pes: group('72'), amort: group('73'), oCus: group('75'), fst: p.lines.filter((l) => l.code.replace(/\D/g, '').startsWith('752')).reduce((s, l) => s + minor(l.v), 0), pFin: -group('66', '67'), cFin: group('76', '77'), pNop: -group('68'), cNop: group('78'), pExt: -group('69'), cExt: group('79'), imp: 0, vn: 0, mb: 0, ro: 0, ebitda: 0, rf: 0, rnop: 0, rext: 0, rai: 0, rl: 0 };
  for (const key of CLOSING_INCOME_KEYS) P[key] = safe(P[key] + closing.amounts[key], 'balancete');
  P.vn = P.vendas + P.prest; P.mb = P.vn - P.cev; P.ro = P.vn + P.oProv - P.cev - P.pes - P.amort - P.oCus; P.ebitda = P.ro + P.amort;
  P.rf = P.pFin - P.cFin; P.rnop = P.pNop - P.cNop; P.rext = P.pExt - P.cExt; P.rai = P.ro + P.rf + P.rnop + P.rext; P.rl = P.rai - P.imp;
  const income = { stage: closing.active ? 'closing' : 'before-closing', complete: closing.unknown.length === 0 && P.rl === closing.incomeBalance + closing.retainedTransfer, serviceCostsKnown: !closing.active || closing.amounts.oCus === 0, retainedTransfer: closing.retainedTransfer / 100, unknownAccounts: closing.unknown };
  if (!income.complete) P.rl = closing.incomeBalance + closing.retainedTransfer;
  const anc = imobB + amort + invFin, ac = exist + clientes + oAct + caixa, empCP = Math.round(emprest * pctCP / 100), empLP = emprest - empCP;
  const capital = -group('51', '52', '53', '54'), reservas = -group('55', '56', '57', '58'), rt = -group('81', '89'), balanceResult = closing.incomeBalance, cp = capital + reservas + rt + balanceResult;
  const pnc = empLP + prov, pc = fornec + empCP + oPas, passivo = pnc + pc, activo = anc + ac, cpp = cp + passivo;
  const B = { imobB, amort, invFin, anc, exist, clientes, oAct, caixa, ac, activo, fornec, emprest, estado: -split(['34'], false), oPas, prov, empCP, empLP, pnc, pc, passivo, capital, reservas, rt, rl: balanceResult, cp, cpp, check: activo - cpp };
  return { income, B: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, safe(v, 'balancete') / 100])) as { [K in keyof typeof B]: number }, P: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, safe(v, 'balancete') / 100])) as { [K in keyof typeof P]: number } };
}
type Statements = ReturnType<typeof classify>;
const div = (a: number, b: number): number | null => b > 0 && Number.isFinite(a / b) ? a / b || 0 : null;
function ratios({ B, P, income }: Statements, previous: Statements | null, days = 365) {
  const avg = (n: number, before: number | undefined) => before === undefined ? n : (n + before) / 2;
  const pmr = income.complete ? div(avg(B.clientes, previous?.B.clientes) * days, P.vn) : null, pme = income.complete ? div(avg(B.exist, previous?.B.exist) * days, P.cev) : null;
  const purchases = P.cev + (previous ? B.exist - previous.B.exist : 0) + P.fst, pmp = income.complete && income.serviceCostsKnown ? div(avg(B.fornec, previous?.B.fornec) * days, purchases) : null;
  const fm = round(B.cp + B.pnc - B.anc), nfm = round(B.exist + B.clientes + B.oAct - B.fornec - B.oPas);
  return { lg: div(B.ac, B.pc), lr: div(B.ac - B.exist, B.pc), li: div(B.caixa, B.pc), af: div(B.cp, B.activo), end: div(B.passivo, B.activo), solv: div(B.cp, B.passivo), dle: income.complete && days >= 365 ? div(B.emprest - B.caixa, P.ebitda) : null, icr: income.complete ? div(P.ebitda, P.cFin) : null, mb: income.complete ? div(P.mb, P.vn) : null, me: income.complete ? div(P.ebitda, P.vn) : null, mo: income.complete ? div(P.ro, P.vn) : null, ml: income.complete ? div(P.rl, P.vn) : null, roa: income.complete ? div(P.ro, avg(B.activo, previous?.B.activo)) : null, roe: div(P.rl, avg(B.cp, previous?.B.cp)), rot: income.complete ? div(P.vn, avg(B.activo, previous?.B.activo)) : null, pmr, pme, pmp, cc: pmr === null || pme === null || pmp === null ? null : pmr + pme - pmp, fm, nfm, tl: round(fm - nfm) };
}
export const HISTORICAL_RATIO_DEFINITIONS: [string, keyof ReturnType<typeof ratios>, string, string, [number, number]][] = [
  ['Liquidez', 'lg', 'Liquidez geral', 'x', [1.2, 1]], ['Liquidez', 'lr', 'Liquidez reduzida', 'x', [1, 0.7]], ['Liquidez', 'li', 'Liquidez imediata', 'x', [0.2, 0.1]],
  ['Estrutura', 'af', 'Autonomia financeira', '%', [0.35, 0.2]], ['Estrutura', 'end', 'Endividamento', '%i', [0.65, 0.8]], ['Estrutura', 'solv', 'Solvabilidade', 'x', [0.5, 0.25]], ['Estrutura', 'dle', 'Dívida líquida / EBITDA', 'xi', [2.5, 4]], ['Estrutura', 'icr', 'Cobertura de juros', 'x', [4, 2]],
  ['Rendibilidade', 'mb', 'Margem bruta', '%', [0.2, 0.1]], ['Rendibilidade', 'me', 'Margem EBITDA', '%', [0.1, 0.05]], ['Rendibilidade', 'mo', 'Margem operacional', '%', [0.07, 0.03]], ['Rendibilidade', 'ml', 'Margem líquida', '%', [0.04, 0.01]], ['Rendibilidade', 'roa', 'ROA (RO/activo)', '%', [0.08, 0.04]], ['Rendibilidade', 'roe', 'ROE', '%', [0.15, 0.08]], ['Rendibilidade', 'rot', 'Rotação do activo', 'x', [1.5, 0.8]],
  ['Actividade', 'pmr', 'Prazo médio de recebimento', 'di', [45, 75]], ['Actividade', 'pme', 'Prazo médio de existências', 'di', [45, 90]], ['Actividade', 'pmp', 'Prazo médio de pagamento', 'd', [45, 25]], ['Actividade', 'cc', 'Ciclo de conversão de caixa', 'di', [30, 60]],
];
export function historicalRatioStatus(v: number | null, thresholds: [number, number], inverse: boolean): 'g' | 'a' | 'r' | 'n' {
  return v === null || !Number.isFinite(v) ? 'n' : inverse ? v <= thresholds[0] ? 'g' : v <= thresholds[1] ? 'a' : 'r' : v >= thresholds[0] ? 'g' : v >= thresholds[1] ? 'a' : 'r';
}
export function validateHistoricalInput(value: unknown): FinancialHistoricalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('historico', 'Dados históricos obrigatórios.');
  const v = value as FinancialHistoricalInput;
  if (typeof v.empresa !== 'string' || v.empresa.trim().length > 200) return fail('empresa', 'Nome da empresa até 200 caracteres.');
  if (typeof v.N !== 'string' || typeof v.N1 !== 'string' || v.N.length > 250_000 || v.N1.length > 250_000) return fail('N', 'Cada balancete admite até 250 000 caracteres.');
  if (!v.N.trim()) return fail('N', v.N1.trim() ? 'Carregou apenas o comparativo. Coloque o balancete que pretende analisar no campo Balancete N (obrigatório); o comparativo é opcional.' : 'O balancete N está vazio. Carregue o documento do período actual no campo Balancete N (obrigatório).');
  if (!Array.isArray(v.anos) || v.anos.length !== 2 || v.anos.some((y) => typeof y !== 'string' || !/^(?:19|20|21)\d{2}$/.test(y))) return fail('anos', 'Indique exercícios entre 1900 e 2199.');
  if (typeof v.pctCP !== 'number' || !Number.isFinite(v.pctCP) || v.pctCP < 0 || v.pctCP > 100) return fail('pctCP', 'Percentagem de empréstimos de curto prazo entre 0 e 100.');
  if (!['Kz', 'USD', 'EUR'].includes(v.moeda)) return fail('moeda', 'Use Kz, USD ou EUR.');
  const periods: NonNullable<FinancialHistoricalInput['periods']> = {};
  if (v.periods !== undefined) {
    if (!v.periods || typeof v.periods !== 'object' || Array.isArray(v.periods)) return fail('periods', 'Indique os períodos de referência dos documentos.');
    for (const key of ['N', 'N1'] as const) if (v.periods[key] !== undefined) {
      const p = v.periods[key], year = v.anos[key === 'N' ? 1 : 0];
      const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
      if (!p || !validDate(p.from) || !validDate(p.to) || p.from > p.to || !p.from.startsWith(year + '-') || !p.to.startsWith(year + '-')) return fail(`periods.${key}`, 'O período deve ter datas válidas dentro do exercício indicado.');
      periods[key] = { from: p.from, to: p.to };
    }
  }
  const input: FinancialHistoricalInput = { empresa: v.empresa.trim(), anos: [...v.anos], N1: v.N1.trim(), N: v.N.trim(), pctCP: v.pctCP, moeda: v.moeda, ...(Object.keys(periods).length ? { periods } : {}) };
  if (input.N1) {
    if(input.anos[0]===input.anos[1]&&(!periods.N||!periods.N1))return fail('periods','Para comparar documentos do mesmo ano, indique as duas datas de referência, por exemplo 31/07/2026 e 31/08/2026.');
    const before=periodOf(input,'N1').to,current=periodOf(input,'N').to;
    if(before===current)return fail('periods.N1','Os dois documentos têm a mesma data de referência. Para analisar um único balancete, carregue-o apenas no campo N e deixe o comparativo vazio.');
    if(before>current)return fail('periods.N1','A data do comparativo deve ser anterior à data do balancete N. Confirme as referências ou troque os documentos de campo.');
  }
  return input;
}
/** Referência do formulário: ano completo, data ISO ou data portuguesa, sem alterar os saldos. */
export function parseHistoricalReference(value: string, previous?: HistoricalPeriod): { year: string; period?: HistoricalPeriod } | null {
  const raw=value.trim();
  if(/^(?:19|20|21)\d{2}$/.test(raw))return {year:raw};
  const portuguese=/^(\d{2})\/(\d{2})\/((?:19|20|21)\d{2})$/.exec(raw);
  const date=portuguese?`${portuguese[3]}-${portuguese[2]}-${portuguese[1]}`:raw;
  if(!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;
  const year=date.slice(0,4),from=previous?.from.startsWith(year+'-')&&previous.from<=date?previous.from:year+'-01-01';
  return {year,period:{from,to:date}};
}
export function historicalPeriodLabel(input: FinancialHistoricalInput, key: 'N' | 'N1'): string {
  const period = input.periods?.[key];
  return period ? `${period.from.split('-').reverse().join('/')} a ${period.to.split('-').reverse().join('/')}` : input.anos[key === 'N' ? 1 : 0];
}
function periodOf(input: FinancialHistoricalInput, key: 'N' | 'N1'): HistoricalPeriod {
  const year = input.anos[key === 'N' ? 1 : 0];
  return input.periods?.[key] || { from: year + '-01-01', to: year + '-12-31' };
}
function periodDays(input: FinancialHistoricalInput, key: 'N' | 'N1') { const p = input.periods?.[key]; return p ? Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1 : 365; }
export function analyzeFinancialHistory(value: unknown) {
  const input = validateHistoricalInput(value), pN = parseHistoricalTrialBalance(input.N), p1 = input.N1 ? parseHistoricalTrialBalance(input.N1, 'N1') : null;
  const previous = periodOf(input, 'N1'), current = periodOf(input, 'N');
  const contiguous = Date.parse(previous.to) + 86400000 === Date.parse(current.from);
  const cN = classify(pN, input.pctCP), c1 = p1 ? classify(p1, input.pctCP) : null, days = periodDays(input, 'N'), rN = ratios(cN, contiguous ? c1 : null, days), r1 = c1 ? ratios(c1, null, periodDays(input, 'N1')) : null;
  const warnings = ['O fluxo de caixa é uma estimativa a partir de dois balancetes. Reavaliações, alienações, câmbio e movimentos sem caixa exigem ajustamentos com o diário contabilístico. A reconciliação algébrica não confirma os fluxos reais.', 'Prazos em dias sem IVA: saldos médios quando há comparativo; pagamentos estimados sobre compras e FST identificados. Limiares de diagnóstico indicativos, a ajustar ao sector.'];
  for (const [label, p, c] of [['N', pN, cN], ['N−1', p1, c1]] as const) if (p && c) {
    if (p.basis === 'accumulated') warnings.push(`Balancete ${label}: Débito/Crédito tratados como totais acumulados que incluem a abertura; movimentos isolados do período não são saldos finais.`);
    if (c.income.stage === 'closing') warnings.push(`Balancete ${label} com apuramento: demonstração de resultados reconstituída pelas contas de origem e de apuramento PGC, sem somar novamente transferências e resultados da conta 88.`);
    if (!c.income.complete) warnings.push(`Balancete ${label}: detalhe de proveitos e custos insuficiente para reconstituir a DR completa. Apresenta-se o resultado líquido e o Balanço; indicadores dependentes desse detalhe ficam indisponíveis.`);
    if (!c.income.serviceCostsKnown) warnings.push(`Balancete ${label}: os outros custos apurados não discriminam FST. O prazo médio de pagamento e o ciclo de caixa ficam indisponíveis.`);
    if (c.income.retainedTransfer !== 0) warnings.push(`Balancete ${label}: existe transferência da conta 88 para resultados transitados; o resultado da DR não é somado novamente ao capital próprio.`);
    if (p.diff !== 0 || c.B.check !== 0) warnings.push(`Balancete ${label} desequilibrado: diferença de ${p.diff} ${input.moeda}. Corrija antes de criar um modelo.`);
    if (!p.lines.some((l) => /^[67]/.test(l.g) && l.v !== 0) && c.income.stage !== 'closing') warnings.push(`Balancete ${label} sem movimentos das classes 6 e 7: a demonstração de resultados não está completa.`);
    if (c.B.caixa < 0) warnings.push(`Balancete ${label}: meios monetários com saldo credor. Reveja descobertos bancários e saldos de caixa; não foram reclassificados automaticamente.`);
  }
  if (input.periods?.N) warnings.push(`Período N: ${historicalPeriodLabel(input, 'N')} (${days} dias). Valores e rendibilidades do período, sem anualização automática; os prazos usam estes dias.`);
  if(p1){const previousDays=periodDays(input,'N1');if(previousDays!==days)warnings.push('Os períodos comparados têm durações diferentes. As variações de proveitos e custos comparam os montantes apresentados, sem os anualizar ou ajustar pela duração.');}
  if (cN.income.stage === 'closing' && pN.lines.some(l => /^[67]/.test(l.g) && l.v !== 0)) warnings.push('Existem saldos nas classes 6/7 e contas de apuramento. Confira se há regularizações posteriores ao apuramento; a análise mantém ambos os saldos, sem compensações artificiais.');
  const diagnostics = HISTORICAL_RATIO_DEFINITIONS.map(([, key, label, format, thresholds]) => ({ key, label, format, value: rN[key], status: historicalRatioStatus(rN[key], thresholds, format.includes('i')) }));
  let cashFlow = null;
  if (c1 && !contiguous) warnings.push('Os saldos comparativos não correspondem ao início do período N. O fluxo de caixa estimado requer um balancete de abertura coerente com esse período.');
  if (c1 && contiguous && cN.income.complete) {
    const B = cN.B, P = cN.P, before = c1.B;
    const dEx = round(B.exist - before.exist), dCl = round(B.clientes - before.clientes), dOA = round(B.oAct - before.oAct), dFo = round(B.fornec - before.fornec), dOP = round(B.oPas - before.oPas), dPr = round(B.prov - before.prov);
    const cfo = round(P.rl + P.amort - dEx - dCl - dOA + dFo + dOP + dPr), investment = round(B.anc - before.anc + P.amort), cfi = -investment;
    const dEmp = round(B.emprest - before.emprest), dCap = round(B.capital - before.capital), otherEquity = round(B.cp - before.cp - P.rl - dCap), cff = round(dEmp + dCap + otherEquity);
    cashFlow = { dEx, dCl, dOA, dFo, dOP, dPr, cfo, investment, cfi, dEmp, dCap, otherEquity, cff, change: round(B.caixa - before.caixa), difference: round(B.caixa - before.caixa - cfo - cfi - cff) };
  }
  return { engineVersion: FINANCIAL_HISTORICAL_VERSION, input, pN, p1, cN, c1, rN, r1, cashFlow, diagnostics, warnings };
}
export type FinancialHistoricalAnalysis = ReturnType<typeof analyzeFinancialHistory>;

/** Ponto de partida explícito. Não transforma hipóteses de crescimento/dívida em factos históricos. */
export function financialModelFromHistory(value: unknown) {
  const a = analyzeFinancialHistory(value), { B, P } = a.cN;
  if (!a.cN.income.complete) return fail('N', 'A modelagem exige o detalhe dos proveitos e custos, indisponível neste balancete apurado.');
  const period = periodOf(a.input, 'N');
  if (!period.from.endsWith('-01-01') || !period.to.endsWith('-12-31')) return fail('N', 'Os valores são de um período intercalar. Prepare uma base anual revista antes de criar um modelo de projecção anual.');
  if (a.pN.diff !== 0 || B.check !== 0) return fail('N', 'Corrija o desequilíbrio do balancete antes de criar um modelo.');
  if (P.vn <= 0 || P.cev < 0 || P.cev > P.vn || P.pes < 0 || P.oCus < 0) return fail('N', 'A receita e os custos históricos não cabem no modelo simplificado. Reveja as contas.');
  if (B.invFin !== 0 || B.prov !== 0) return fail('N', 'A abertura simplificada não distingue investimentos financeiros e provisões de longo prazo. Prepare a modelagem específica destas rubricas.');
  if ([B.anc, B.exist, B.clientes, B.oAct, B.caixa, B.fornec, B.oPas, B.emprest].some((n) => n < 0)) return fail('N', 'A abertura contém saldos negativos que exigem reclassificação.');
  const sector = P.cev / P.vn > 0.5 ? 'comercio' : 'servicos', template = financialTemplate(sector), m = template.assumptions;
  m.inicio = 'existente'; m.anoBase = Number(a.input.anos[1]); m.inicioOp = 1; m.cen = 'base';
  m.receitas = [{ nome: cNAccountSource(a), unid: 'índice', qtd: 1, preco: P.vn, cresc: 0, ramp: '100', esc: 0 }];
  m.cvar = P.cev / P.vn * 100; m.pessoal = P.pes; m.fst = P.fst; m.outros = round(P.oCus - P.fst); m.royalty = 0;
  m.capex = []; m.manut = 0; m.divida.montante = 0; m.payout = 0; m.caixaMin = 0;
  m.dso = (B.clientes + B.oAct) / P.vn * 365; m.dio = P.cev > 0 ? B.exist / P.cev * 365 : 0;
  m.dpo = P.cev + P.fst > 0 ? (B.fornec + B.oPas) / (P.cev + P.fst) * 365 : 0;
  m.abertura = { ...m.abertura, imob: B.anc, exist: B.exist, clientes: round(B.clientes + B.oAct), caixa: B.caixa, fornec: round(B.fornec + B.oPas), divida: B.emprest };
  const assumptions = validateFinancialAssumptions(m);
  const notes = ['Clientes incluem outros activos correntes; fornecedores incluem outros passivos correntes. A agregação mantém o capital próprio de abertura.', 'Rever inflação, imposto, CAPEX de manutenção, vida útil remanescente, taxa e prazo da dívida e taxa de desconto. Estes valores não são comprovados pelos balancetes.', 'A projecção de receitas parte do volume de negócios reconstituído a partir das contas de origem e, quando aplicável, de apuramento PGC, sem crescimento ou aumento de preço. Outros proveitos e resultados não recorrentes não são projectados automaticamente.'];
  return { name: `${a.input.empresa || 'Empresa'} — avaliação`.slice(0, 200), sector, currency: a.input.moeda, assumptions: { ...assumptions, historicalBasis: { engineVersion: a.engineVersion, year: a.input.anos[1], notes } }, notes };
}
function cNAccountSource(a: FinancialHistoricalAnalysis) { return a.cN.income.stage === 'closing' ? 'Volume de negócios histórico (61/62 e apuramento PGC)' : 'Volume de negócios histórico (61/62)'; }
