import { HISTORICAL_RATIO_DEFINITIONS, historicalRatioStatus, type FinancialHistoricalAnalysis } from './historical.js';
import type { FinancialReport, ReportCell, ReportTable, ReportBlock } from './reports.js';
const c = (value: string | number | null, format: ReportCell['format'] = 'text'): ReportCell => ({ value, format });
/** Apenas apresentação dos dados históricos, sem simular receitas ou investimento. */
export function buildFinancialHistoricalReport(a: FinancialHistoricalAnalysis): FinancialReport {
  const two = a.c1 !== null, columns = ['Rubrica', ...(two ? [a.input.anos[0]] : []), a.input.anos[1]];
  const table = (title: string, rows: [string, (v: typeof a.cN) => number, boolean?][]): ReportTable => ({ kind: 'table', title, columns, rows: rows.map(([label, f, total]) => ({ cells: [c(label), ...(a.c1 ? [c(f(a.c1), 'money')] : []), c(f(a.cN), 'money')], total })) });
  const blocks: ReportBlock[] = [
    { kind: 'paragraph', title: 'Origem e âmbito', text: `Análise de ${a.input.empresa || 'empresa não identificada'}, exercícios ${two ? a.input.anos.join(' e ') : a.input.anos[1]}. Balancetes antes do apuramento de resultados. Empréstimos de curto prazo: ${a.input.pctCP}%, conforme indicação do utilizador.` },
    { kind: 'table', title: 'Verificações da origem', columns: ['Exercício', 'Contas', 'Débito − crédito', 'Activo − capital próprio − passivo'], rows: [...(a.p1 && a.c1 ? [{ p: a.p1, s: a.c1, y: a.input.anos[0] }] : []), { p: a.pN, s: a.cN, y: a.input.anos[1] }].map(({ p, s, y }) => ({ cells: [c(y), c(p.lines.length, 'integer'), c(p.diff, 'money'), c(s.B.check, 'money')] })) },
    table('Balanço histórico', [
      ['Imobilizações brutas (11/12/14)', v => v.B.imobB], ['Amortizações acumuladas (18)', v => v.B.amort], ['Investimentos financeiros líquidos (13/19)', v => v.B.invFin], ['Activo não corrente', v => v.B.anc, true],
      ['Existências líquidas', v => v.B.exist], ['Clientes líquidos', v => v.B.clientes], ['Outros activos correntes', v => v.B.oAct], ['Meios monetários', v => v.B.caixa], ['Activo corrente', v => v.B.ac, true], ['Total do activo', v => v.B.activo, true],
      ['Capital e prémios', v => v.B.capital], ['Reservas', v => v.B.reservas], ['Resultados transitados e dividendos antecipados', v => v.B.rt], ['Resultado líquido', v => v.B.rl], ['Capital próprio', v => v.B.cp, true],
      ['Empréstimos de médio/longo prazo', v => v.B.empLP], ['Provisões de longo prazo', v => v.B.prov], ['Passivo não corrente', v => v.B.pnc, true], ['Fornecedores', v => v.B.fornec], ['Empréstimos de curto prazo', v => v.B.empCP], ['Outros passivos correntes', v => v.B.oPas], ['Passivo corrente', v => v.B.pc, true], ['Total do passivo', v => v.B.passivo, true], ['Total do capital próprio e passivo', v => v.B.cpp, true],
    ]),
    table('Demonstração de resultados histórica', [
      ['Vendas (61)', v => v.P.vendas], ['Prestações de serviços (62)', v => v.P.prest], ['Volume de negócios', v => v.P.vn, true], ['Outros proveitos operacionais (63–65)', v => v.P.oProv], ['Custo das existências (71)', v => -v.P.cev], ['Custos com pessoal (72)', v => -v.P.pes], ['Outros custos operacionais (75)', v => -v.P.oCus], ['EBITDA', v => v.P.ebitda, true], ['Amortizações (73)', v => -v.P.amort], ['Resultado operacional', v => v.P.ro, true], ['Resultado financeiro', v => v.P.rf], ['Resultado não operacional', v => v.P.rnop], ['Resultado extraordinário', v => v.P.rext], ['Resultado antes de impostos', v => v.P.rai, true], ['Imposto sobre os lucros (87)', v => -v.P.imp], ['Resultado líquido', v => v.P.rl, true],
    ]),
  ];
  if (a.cashFlow && a.c1) {
    const f = a.cashFlow;
    blocks.push({ kind: 'table', title: 'Fluxo de caixa estimado — método indirecto', columns: ['Rubrica', a.input.anos[1]], rows: ([
      ['Resultado líquido', a.cN.P.rl], ['Amortizações', a.cN.P.amort], ['Variação de existências', -f.dEx], ['Variação de clientes', -f.dCl], ['Variação de outros activos correntes', -f.dOA], ['Variação de fornecedores', f.dFo], ['Variação de outros passivos correntes', f.dOP], ['Variação de provisões', f.dPr], ['Fluxo operacional estimado', f.cfo, true], ['Investimento líquido estimado', f.cfi, true], ['Variação de empréstimos', f.dEmp], ['Variação de capital', f.dCap], ['Distribuições e outros movimentos de capital próprio, líquidos', f.otherEquity], ['Fluxo de financiamento estimado', f.cff, true], ['Variação de meios monetários', f.change, true], ['Diferença de reconciliação', f.difference], ['Meios monetários no início', a.c1.B.caixa], ['Meios monetários no fim', a.cN.B.caixa, true],
    ] as [string, number, boolean?][]).map(([label, value, total]) => ({ cells: [c(label), c(value, 'money')], total })) });
  } else blocks.push({ kind: 'paragraph', title: 'Fluxos de caixa', text: 'Carregue o exercício anterior para estimar a variação de caixa. Um único balancete não permite calcular estes fluxos.' });
  blocks.push({ kind: 'table', title: 'Rácios e diagnóstico', columns: ['Área / indicador', ...(two ? [a.input.anos[0]] : []), a.input.anos[1], 'Leitura indicativa'], rows: HISTORICAL_RATIO_DEFINITIONS.map(([group, key, label, format, thresholds]) => {
    const fmt = format.startsWith('%') ? 'percent' : format.startsWith('d') ? 'integer' : 'ratio', status = historicalRatioStatus(a.rN[key], thresholds, format.includes('i'));
    return { cells: [c(`${group}: ${label}${format.startsWith('d') ? ' (dias)' : ''}`), ...(a.r1 ? [c(a.r1[key], fmt)] : []), c(a.rN[key], fmt), c({ g: 'Favorável', a: 'Atenção', r: 'Desfavorável', n: 'Não calculável' }[status])] };
  }) });
  blocks.push({ kind: 'paragraph', title: 'Notas de interpretação', text: a.warnings.join(' ') });
  return { key: 'analise', title: 'Relatório de análise económico-financeira', subtitle: a.input.empresa, landscape: false, currency: a.input.moeda, entityName: a.input.empresa || undefined, blocks };
}
