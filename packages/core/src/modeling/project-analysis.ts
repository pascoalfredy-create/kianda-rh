import { HISTORICAL_RATIO_DEFINITIONS, historicalRatioStatus } from './historical.js';
import type { FinancialReport, ReportBlock, ReportCell, ReportTable } from './reports.js';
import type { FinancialResult } from './types.js';

/**
 * Análise económico-financeira das demonstrações projectadas do próprio projecto, ano a ano no horizonte.
 * Usa apenas o resultado do modelo: não recebe balancetes nem outra informação externa.
 */
export type ProjectRatioKey = typeof HISTORICAL_RATIO_DEFINITIONS[number][1];
export type ProjectRatioStatus = 'g' | 'a' | 'r' | 'n';
export interface ProjectRatioRow { group: string; key: ProjectRatioKey; label: string; format: string; values: (number | null)[]; statuses: ProjectRatioStatus[]; favourable: number; measured: number }
export interface ProjectAnalysis { years: number[]; indices: number[]; rows: ProjectRatioRow[]; diagnosis: { area: string; text: string; status: ProjectRatioStatus }[]; notes: string[] }

const div = (a: number, b: number): number | null => b > 0 && Number.isFinite(a / b) ? a / b || 0 : null;
const avg = (k: number[], t: number) => t > 0 ? (k[t]! + k[t - 1]!) / 2 : k[t]!;

export function projectRatios(r: FinancialResult, t: number): Record<ProjectRatioKey, number | null> {
  const k = r.k, days = 365;
  const ac = k.inv[t]! + k.ar[t]! + k.cash[t]!, nextRepayment = t < r.H ? k.princ[t + 1]! : 0, pc = k.ap[t]! + nextRepayment;
  const cp = k.cap[t]! + k.res[t]!, passivo = k.debt[t]! + k.ap[t]!, rev = k.rev[t]!, cpAvg = (cp + (t > 0 ? k.cap[t - 1]! + k.res[t - 1]! : cp)) / 2;
  const purchases = k.cv[t]! + k.fst[t]! + (t > 0 ? k.inv[t]! - k.inv[t - 1]! : k.inv[t]!);
  const pmr = div(avg(k.ar, t) * days, rev), pme = div(avg(k.inv, t) * days, k.cv[t]!), pmp = div(avg(k.ap, t) * days, purchases);
  return {
    lg: div(ac, pc), lr: div(ac - k.inv[t]!, pc), li: div(k.cash[t]!, pc),
    af: div(cp, k.assets[t]!), end: div(passivo, k.assets[t]!), solv: div(cp, passivo), dle: div(k.debt[t]! - k.cash[t]!, k.ebitda[t]!), icr: div(k.ebitda[t]!, k.jur[t]!),
    mb: div(rev - k.cv[t]!, rev), me: div(k.ebitda[t]!, rev), mo: div(k.ebit[t]!, rev), ml: div(k.rl[t]!, rev),
    roa: div(k.ebit[t]!, avg(k.assets, t)), roe: cpAvg > 0 ? k.rl[t]! / cpAvg : null, rot: div(rev, avg(k.assets, t)),
    pmr, pme, pmp, cc: pmr === null || pme === null || pmp === null ? null : pmr + pme - pmp,
    fm: null, nfm: null, tl: null,
  } as Record<ProjectRatioKey, number | null>;
}

const AREA_TEXT: Record<string, [string, string, string]> = {
  Liquidez: ['A liquidez cobre as obrigações de curto prazo na generalidade do horizonte.', 'A liquidez é apertada em parte do horizonte; acompanhe a tesouraria e o calendário de reembolsos.', 'A liquidez é insuficiente na maior parte do horizonte: as obrigações de curto prazo excedem os activos correntes.'],
  Estrutura: ['A estrutura de financiamento é equilibrada e a dívida é suportada pelo EBITDA.', 'A estrutura de financiamento depende bastante de capitais alheios em alguns anos.', 'O endividamento é elevado face aos capitais próprios ou ao EBITDA; reveja o montante, o prazo ou os aportes.'],
  Rendibilidade: ['As margens e a rendibilidade dos capitais são favoráveis na generalidade do horizonte.', 'A rendibilidade é moderada: parte dos anos fica abaixo das referências.', 'A rendibilidade fica abaixo das referências na maior parte do horizonte.'],
  Actividade: ['Os prazos de recebimento, existências e pagamento geram um ciclo de caixa contido.', 'O ciclo de caixa absorve fundo de maneio relevante em alguns anos.', 'O ciclo de caixa é longo e absorve fundo de maneio significativo.'],
};

export function analyzeFinancialProjection(r: FinancialResult): ProjectAnalysis {
  const indices = r.years.map((_, t) => t).filter((t) => t > 0), per = indices.map((t) => projectRatios(r, t));
  const rows: ProjectRatioRow[] = HISTORICAL_RATIO_DEFINITIONS.map(([group, key, label, format, thresholds]) => {
    const values = per.map((p) => p[key]), statuses = values.map((v) => historicalRatioStatus(v, thresholds, format.includes('i')));
    return { group, key, label, format, values, statuses, favourable: statuses.filter((s) => s === 'g').length, measured: statuses.filter((s) => s !== 'n').length };
  });
  const diagnosis = Object.keys(AREA_TEXT).map((area) => {
    const own = rows.filter((row) => row.group === area), measured = own.reduce((s, row) => s + row.measured, 0), good = own.reduce((s, row) => s + row.favourable, 0);
    const bad = own.reduce((s, row) => s + row.statuses.filter((v) => v === 'r').length, 0);
    const status: ProjectRatioStatus = measured === 0 ? 'n' : good / measured >= 0.6 ? 'g' : bad / measured > 0.4 ? 'r' : 'a';
    const text = status === 'n' ? 'Sem dados suficientes no horizonte para calcular estes indicadores.' : AREA_TEXT[area]![status === 'g' ? 0 : status === 'a' ? 1 : 2];
    return { area, text, status };
  });
  const notes = [
    'Indicadores calculados sobre as demonstrações projectadas do próprio projecto, ano a ano, sem informação externa.',
    'Passivo corrente estimado como fornecedores mais o reembolso de dívida previsto para o ano seguinte. Prazos em dias sobre saldos médios, sem IVA.',
    'Limiares de leitura indicativos, a ajustar ao sector e à fase do projecto (os primeiros anos de operação tendem a apresentar indicadores mais fracos).',
  ];
  return { years: indices.map((t) => r.years[t]!), indices, rows, diagnosis, notes };
}

const c = (value: string | number | null, format: ReportCell['format'] = 'text'): ReportCell => ({ value, format });
const fmtOf = (format: string): ReportCell['format'] => format.startsWith('%') ? 'percent' : format.startsWith('d') ? 'integer' : 'ratio';
const STATUS_LABEL: Record<ProjectRatioStatus, string> = { g: 'Favorável', a: 'Atenção', r: 'Desfavorável', n: 'Não calculável' };

/** Relatório de análise económico-financeira preenchido com o projecto (cenário do resultado). */
export function buildFinancialProjectionAnalysisReport(r: FinancialResult, projectName: string, scenarioLabel: string): FinancialReport {
  const a = analyzeFinancialProjection(r), k = r.k, years = a.years.map(String);
  const series = (title: string, specs: [string, (t: number) => number, boolean?][]): ReportTable => ({ kind: 'table', title, columns: ['Rubrica', ...years], chronological: true, rows: specs.map(([label, f, total]) => ({ cells: [c(label), ...a.indices.map((t) => c(f(t), 'money'))], total })) });
  const first = a.indices[0] ?? 0, last = a.indices[a.indices.length - 1] ?? 0;
  const ratioOf = (key: ProjectRatioKey) => a.rows.find((row) => row.key === key)!;
  const minOf = (key: ProjectRatioKey) => { const v = ratioOf(key).values.filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
  const maxOf = (key: ProjectRatioKey) => { const v = ratioOf(key).values.filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; };
  const blocks: ReportBlock[] = [
    { kind: 'paragraph', title: 'Objecto e âmbito', text: `Análise económico-financeira das demonstrações projectadas de ${projectName}, de ${a.years[0] ?? '—'} a ${a.years[a.years.length - 1] ?? '—'}, no cenário ${scenarioLabel}. Toda a informação provém dos pressupostos e resultados do próprio projecto.` },
    { kind: 'metrics', items: [
      { label: `Volume de negócios ${r.years[last]}`, cell: c(k.rev[last]!, 'money'), note: `${r.years[first]}: ${new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(k.rev[first]!)}` },
      { label: `Margem EBITDA ${r.years[last]}`, cell: c(ratioOf('me').values[ratioOf('me').values.length - 1] ?? null, 'percent') },
      { label: `ROE ${r.years[last]}`, cell: c(ratioOf('roe').values[ratioOf('roe').values.length - 1] ?? null, 'percent') },
      { label: 'Liquidez geral mínima', cell: c(minOf('lg'), 'ratio') },
      { label: 'Dívida líquida / EBITDA máxima', cell: c(maxOf('dle'), 'ratio') },
    ] },
    series('Demonstração de resultados (síntese)', [['Volume de negócios', (t) => k.rev[t]!], ['EBITDA', (t) => k.ebitda[t]!, true], ['Amortizações', (t) => -k.da[t]!], ['Resultado operacional', (t) => k.ebit[t]!, true], ['Custos financeiros', (t) => -k.jur[t]!], ['Imposto', (t) => -k.imp[t]!], ['Resultado líquido', (t) => k.rl[t]!, true]]),
    series('Balanço (síntese)', [['Imobilizado líquido', (t) => k.imob[t]!], ['Existências e clientes', (t) => k.inv[t]! + k.ar[t]!], ['Meios monetários', (t) => k.cash[t]!], ['Total do activo', (t) => k.assets[t]!, true], ['Capital próprio', (t) => k.cap[t]! + k.res[t]!, true], ['Empréstimos', (t) => k.debt[t]!], ['Fornecedores', (t) => k.ap[t]!], ['Total do passivo', (t) => k.debt[t]! + k.ap[t]!, true]]),
    series('Fluxos de caixa (síntese)', [['Fluxo operacional', (t) => k.cfo[t]!], ['Fluxo de investimento', (t) => k.cfi[t]!], ['Fluxo de financiamento', (t) => k.cff[t]!], ['Caixa no fim do ano', (t) => k.cash[t]!, true]]),
    { kind: 'table', title: 'Rácios por ano', columns: ['Área / indicador', ...years, 'Anos favoráveis'], chronological: true, startNewPage: true, rows: a.rows.map((row) => ({ cells: [c(`${row.group}: ${row.label}${row.format.startsWith('d') ? ' (dias)' : ''}`), ...row.values.map((v) => c(v, fmtOf(row.format))), c(row.measured ? `${row.favourable} de ${row.measured}` : STATUS_LABEL.n)] })) },
    { kind: 'table', title: 'Diagnóstico por área', columns: ['Área', 'Leitura', 'Comentário'], rows: a.diagnosis.map((d) => ({ cells: [c(d.area), c(STATUS_LABEL[d.status]), c(d.text)] })) },
    { kind: 'paragraph', title: 'Notas de interpretação', text: a.notes.join(' ') },
  ];
  return { key: 'analise', title: 'Relatório de análise económico-financeira', subtitle: `${projectName} - cenário ${scenarioLabel}`, landscape: true, blocks };
}
