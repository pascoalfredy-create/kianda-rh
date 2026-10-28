import { financialBreakEvenPrice, financialScenarios, financialSensitivity } from './analysis.js';
import { runFinancialModel } from './engine.js';
import { validateFinancialAssumptions } from './validation.js';
import type { FinancialAssumptions, FinancialResult, FinancialScenario, FinancialSeries } from './types.js';

export const FINANCIAL_REPORT_VERSION = 'integra-reports-1';
export const FINANCIAL_REPORT_KEYS = ['sumario', 'comite', 'credito', 'avaliacao', 'demonstracoes', 'cenarios', 'divida'] as const;
export type FinancialReportKey = typeof FINANCIAL_REPORT_KEYS[number];
export const FINANCIAL_DOCUMENT_KEYS = [...FINANCIAL_REPORT_KEYS, 'analise'] as const;
export type FinancialDocumentKey = typeof FINANCIAL_DOCUMENT_KEYS[number];
export type ReportFormat = 'money' | 'percent' | 'ratio' | 'integer' | 'text';
export interface ReportCell { value: string | number | null; format: ReportFormat }
export interface ReportTable { kind: 'table'; title: string; columns: string[]; rows: { cells: ReportCell[]; total?: boolean }[]; chronological?: boolean; startNewPage?: boolean }
export interface ReportMetrics { kind: 'metrics'; items: { label: string; cell: ReportCell; note?: string }[] }
export interface ReportParagraph { kind: 'paragraph'; title?: string; text: string }
export interface ReportChart { kind: 'chart'; title: string; labels: string[]; series: { name: string; color: string; values: (number | null)[] }[]; format: 'money' | 'ratio'; reference?: number }
export interface ReportTornado { kind: 'tornado'; title: string; center: number; rows: { label: string; low: number; high: number }[] }
export type ReportBlock = ReportTable | ReportMetrics | ReportParagraph | ReportChart | ReportTornado;
export interface FinancialReport { key: FinancialDocumentKey; title: string; subtitle: string; landscape: boolean; currency?: string; entityName?: string; blocks: ReportBlock[] }
export interface FinancialReportSource {
  modelId: string; projectName: string; sector: string; currency: string; companyName: string; companyNif: string;
  promoter?: string; promoterNif?: string; revision: number; sourceHash: string; historicalHash?: string; asOf: string; state: 'draft' | 'approved'; versionId?: string; versionNumber?: number; versionLabel?: string; approvedByName?: string;
}
export interface FinancialReportDocument { source: FinancialReportSource; reports: Partial<Record<FinancialDocumentKey, FinancialReport>> }
export interface FinancialReportBundle {
  schemaVersion: 1; reportVersion: string; source: FinancialReportSource; assumptions: FinancialAssumptions;
  inputAssumptions: Record<string, unknown>; result: FinancialResult; scenarios: Record<FinancialScenario, FinancialResult>;
  sensitivity: ReturnType<typeof financialSensitivity>; breakEvenPriceMultiplier: number | null;
  personnelSources: { source: string; fromPeriod: string; toPeriod: string; importedAt: string }[];
  historical?: import('./historical.js').FinancialHistoricalAnalysis;
  reports: Record<FinancialReportKey, FinancialReport> & Partial<Record<'analise', FinancialReport>>;
}
export const FINANCIAL_REPORT_TITLES: Record<FinancialReportKey, string> = {
  sumario: 'Sumário executivo', comite: 'Memorando para comité de investimento', credito: 'Memorando de crédito', avaliacao: 'Relatório de avaliação',
  demonstracoes: 'Demonstrações financeiras projectadas', cenarios: 'Análise de cenários e sensibilidade', divida: 'Quadro de serviço da dívida',
};
const cell = (value: string | number | null, format: ReportFormat = 'text'): ReportCell => ({ value, format });
const money = (value: number | null) => cell(value, 'money');
const pct = (value: number | null) => cell(value, 'percent');
const ratio = (value: number | null) => cell(value, 'ratio');
const text = (title: string, value: string): ReportParagraph => ({ kind: 'paragraph', title, text: value });
const table = (title: string, columns: string[], rows: ReportTable['rows'], chronological = false): ReportTable => ({ kind: 'table', title, columns, rows, chronological });
const row = (label: string, values: ReportCell[], total = false) => ({ cells: [cell(label), ...values], total });
const sum = (v: number[]) => v.reduce((s, n) => s + n, 0);
const status = (v: boolean | null) => v === null ? 'Não aplicável' : v ? 'Cumpre' : 'Não cumpre';
const SCENARIO_LABELS = { base: 'Base', otim: 'Optimista', pess: 'Pessimista' };
const DRIVER_LABELS = { preco: 'Preço de venda', volume: 'Volume / produção', cvar: 'Custos variáveis', fixos: 'Custos fixos', capex: 'CAPEX', wacc: 'WACC' };

/** Dados de apresentação congeláveis: nenhum renderizador recalcula uma versão aprovada. */
export function buildFinancialReportBundle(input: unknown, source: FinancialReportSource, personnelSources: FinancialReportBundle['personnelSources'] = []): FinancialReportBundle {
  const m = validateFinancialAssumptions(input), r = runFinancialModel(m), k = r.k, ex = m.inicio === 'existente';
  const scenarios = financialScenarios(m), sensitivity = financialSensitivity(m), breakEven = financialBreakEvenPrice(m);
  const years = r.years.map(String), picked = [...new Set([1, Math.min(3, r.H), Math.min(5, r.H), r.H])];
  const seriesTable = (title: string, specs: [string, FinancialSeries, boolean?, boolean?][], indices = r.years.map((_, i) => i)) => table(title, ['Rubrica', ...indices.map((i) => String(r.years[i]))], specs.map(([label, key, negative, total]) => row(label, indices.map((t) => money(k[key][t]! * (negative ? -1 : 1))), total)), true);
  const metrics: ReportMetrics = { kind: 'metrics', items: [
    { label: ex ? 'Valor da empresa (EV)' : 'VAL do projecto', cell: money(r.npv), note: `WACC ${(r.wacc * 100).toFixed(2).replace('.', ',')}%` },
    { label: ex ? 'Valor do capital próprio' : 'TIR do projecto', cell: ex ? money(r.eqVal) : pct(r.irr) },
    { label: ex ? 'Capital próprio contabilístico' : 'TIR do accionista', cell: ex ? money(r.bookEq) : pct(r.irrEq) },
    { label: 'Payback', cell: cell(r.pbDuration ? `${r.pbDuration.years} anos e ${r.pbDuration.months} meses` : 'Não disponível') },
    { label: 'DSCR mínimo', cell: ratio(r.minDscr), note: r.hasDebt ? `Covenant ${m.cov.dscr.toFixed(2).replace('.', ',')}x` : 'Sem dívida' },
    { label: m.capitalAutomatico ? 'Capital adicional modelado' : 'Necessidade por financiar', cell: money(r.fundingGap) },
  ] };
  const verdict = ex ? `O DCF estima o valor da empresa e deduz a dívida líquida de abertura para obter o valor do capital próprio.` : r.npv > 0 ? 'O projecto apresenta VAL positivo aos pressupostos e à taxa de desconto utilizados.' : r.npv < 0 ? 'O projecto apresenta VAL negativo aos pressupostos e à taxa de desconto utilizados.' : 'O VAL está no limiar de equilíbrio.';
  const funding = r.fullyFunded ? r.fundingGap > 0 ? 'O equilíbrio de caixa pressupõe aportes adicionais identificados no financiamento.' : 'O modelo não identifica necessidade adicional de financiamento.' : 'Existe défice por financiar. A caixa negativa assinala essa necessidade e a TIR do accionista não é apresentada.';
  const debtComment = !r.hasDebt ? 'Não há dívida no modelo.' : r.minDscr === null ? 'A cobertura do serviço da dívida não é calculável no horizonte.' : r.minDscr < m.cov.dscr ? 'O DSCR fica abaixo do covenant em pelo menos um ano; reveja o montante, o prazo ou a carência.' : 'O DSCR cumpre o limite modelado em todos os períodos avaliados.';
  const notes = [
    text('Notas de cálculo', 'Projecção anual. VAL inclui o fluxo do ano 0. O payback exclui o valor terminal. A TIR do accionista usa aportes, dividendos e valor final realizável. Valores indisponíveis são apresentados como n/d.'),
    ...(r.warnings.length ? [text('Pontos a considerar', r.warnings.map((w) => w.message).join(' '))] : []),
    ...(personnelSources.length ? [text('Histórico de importações de pessoal', personnelSources.map((p) => `${p.source === 'budget' ? 'Orçamento aprovado' : 'Custo real'} de ${p.fromPeriod} a ${p.toPeriod}, importado em ${p.importedAt.slice(0, 10)}.`).join(' '))] : []),
  ];
  const overview = seriesTable('Indicadores-chave', [['Volume de negócios', 'rev'], ['EBITDA', 'ebitda'], ['Resultado líquido', 'rl'], ['Fluxo livre da empresa (FCFF)', 'fcff'], ['Caixa no fim do ano', 'cash']], picked);
  const chart: ReportChart = { kind: 'chart', title: 'Evolução das receitas, EBITDA e resultado líquido', labels: years.slice(1), series: [{ name: 'Receitas', color: '#1d4e89', values: k.rev.slice(1) }, { name: 'EBITDA', color: '#2a9d8f', values: k.ebitda.slice(1) }, { name: 'Resultado líquido', color: '#64748b', values: k.rl.slice(1) }], format: 'money' };
  const tornado: ReportTornado = { kind: 'tornado', title: `Impacto no VAL (${m.sens}% para menos e para mais)`, center: r.npv, rows: sensitivity.map((s) => ({ label: DRIVER_LABELS[s.driver], low: s.low, high: s.high })) };
  const investments = table('Investimento e financiamento', ['Componente', 'Valor'], [row('CAPEX de expansão', [money(r.totalCapex)]), row('CAPEX de manutenção', [money(sum(k.capexMan))]), row('Capital realizado', [money(sum(k.eqInj))]), row('Aportes adicionais modelados', [money(sum(k.eqAuto))]), row('Desembolsos de dívida', [money(sum(k.draw))]), row('Caixa mínima', [money(m.caixaMin)])]);
  const assumptions = table('Pressupostos-chave', ['Pressuposto', 'Valor'], [
    row('Horizonte', [cell(`${m.horizonte} anos`)]), row('Início da operação', [cell(ex ? 'Empresa em actividade' : `Ano ${m.inicioOp}`)]), row('Inflação dos custos', [pct(m.inflacao / 100)]),
    row('Custos variáveis / receitas', [pct(m.cvar / 100)]), row('Royalties / receitas', [pct(m.royalty / 100)]), row('Custo anual inicial com pessoal', [money(m.pessoal)]),
    row('Imposto sobre o resultado (pressuposto)', [pct(m.ii / 100)]), row('Recebimento / existências / pagamento', [cell(`${m.dso} / ${m.dio} / ${m.dpo} dias`)]), row('WACC', [pct(r.wacc)]),
    ...m.receitas.map((v) => row(`${v.nome} - quantidade e preço`, [cell(`${v.qtd} ${v.unid} x ${v.preco} ${source.currency}`)])),
  ]);
  const sensitivityTable = table('Sensibilidade do VAL', ['Variável', 'VAL (-)', 'VAL (+)', 'Amplitude'], sensitivity.map((s) => row(DRIVER_LABELS[s.driver], [money(s.low), money(s.high), money(s.impact)])));
  const creditYears = r.years.map((_, i) => i).filter((i) => i > 0 && (k.ds[i]! > 0 || k.debt[i]! > 0 || k.debt[i - 1]! > 0));
  const debt = table('Plano de serviço da dívida', ['Ano', 'Saldo inicial', 'Desembolso', 'Juros', 'Capital', 'Serviço', 'Saldo final', 'CFADS', 'DSCR'], r.years.map((y, t) => ({ cells: [cell(y, 'integer'), money(t ? k.debt[t - 1]! : ex ? m.abertura.divida : 0), money(k.draw[t]!), money(k.jur[t]!), money(k.princ[t]!), money(k.ds[t]!), money(k.debt[t]!), money(k.cfads[t]!), ratio(k.dscr[t]!)] })));
  const covenants = table('Covenants por ano', ['Ano', 'DSCR', 'Dívida líquida / EBITDA', 'EBITDA / juros'], r.covenants.map((v) => ({ cells: [cell(v.year, 'integer'), cell(status(v.dscr)), cell(status(v.ndEbitda)), cell(status(v.icr))] })));
  const dscrChart: ReportChart = { kind: 'chart', title: 'Cobertura do serviço da dívida', labels: creditYears.map((i) => String(r.years[i])), series: [{ name: 'DSCR', color: '#1d4e89', values: creditYears.map((i) => k.dscr[i]!) }], reference: m.cov.dscr, format: 'ratio' };
  const decision = text('Conclusão', `${verdict} ${funding} ${debtComment}`);
  const make = (key: FinancialReportKey, blocks: ReportBlock[], landscape = false): FinancialReport => ({ key, title: FINANCIAL_REPORT_TITLES[key], subtitle: `${source.projectName} - cenário ${SCENARIO_LABELS[r.scenario].toLowerCase()}`, landscape, blocks });
  const reports = {} as Record<FinancialReportKey, FinancialReport>;
  reports.sumario = make('sumario', [text('Objecto', `${ex ? 'Avaliação de empresa existente' : 'Estudo de viabilidade'} no sector de ${source.sector}, com horizonte de ${m.horizonte} anos.`), metrics, chart, overview, decision]);
  reports.comite = make('comite', [text('1. Objecto e recomendação', `${verdict} ${funding} ${debtComment}`), assumptions, investments, overview, metrics, tornado, sensitivityTable, text('Riscos e condições', `${funding} ${debtComment} O preço de equilíbrio corresponde a ${breakEven === null ? 'um valor indisponível no intervalo pesquisado' : (breakEven * 100).toFixed(2) + '% do preço do cenário'}.`), text('Deliberação do comité', '[ ] Aprovar   [ ] Aprovar com condições   [ ] Rejeitar   [ ] Adiar. A deliberação e as condições ficam a preencher pelo comité.'), ...notes]);
  reports.credito = make('credito', [text('Mutuário e operação', `${source.promoter || source.companyName}, NIF ${(source.promoter ? source.promoterNif : source.companyNif) || 'não indicado'}. ${r.hasDebt ? 'Financiamento da actividade e do investimento modelados.' : 'O modelo não inclui empréstimos.'}`), table('Condições do financiamento novo', ['Condição', 'Valor'], [row('Montante', [money(m.divida.montante)]), row('Taxa anual', [pct(m.divida.taxa / 100)]), row('Prazo / carência', [cell(`${m.divida.prazo} / ${m.divida.carencia} anos`)]), row('Desembolso', [cell(r.years[m.divida.ano]!, 'integer')])]), investments, debt, ...(r.hasDebt ? [dscrChart] : []), table('Indicadores de crédito', ['Indicador', 'Resultado'], [row('DSCR mínimo', [ratio(r.minDscr)]), row('DSCR médio', [ratio(r.avgDscr)]), row('LLCR', [ratio(r.llcr)]), row('Capacidade de endividamento indicativa', [money(r.debtCap)])]), covenants, text('Garantias propostas', 'Garantias e condições contratuais por definir com o financiador.'), decision, ...notes], true);
  reports.avaliacao = make('avaliacao', [seriesTable('Fluxos livres para avaliação', [['EBITDA', 'ebitda'], ['Imposto sobre EBIT', 'taxU', true], ['CAPEX', 'capex', true], ['Variação do fundo de maneio', 'dnwc', true], ['FCFF', 'fcff', false, true]]), table('Taxa de desconto e avaliação', ['Componente', 'Valor'], [row('Custo do capital próprio (Ke)', [pct(r.ke)]), row('WACC', [pct(r.wacc)]), row('VA dos FCFF explícitos', [money(r.npvSemTv)]), row('VA do valor terminal de continuidade', [money(r.pvTv)]), row('Residual líquido no fim do horizonte', [money(r.residual)]), row('Libertação do fundo de maneio no fim', [money(r.terminalWorkingCapital)]), row(ex ? 'Valor da empresa (EV)' : 'VAL do projecto', [money(r.npv)], true), ...(ex ? [row('Dívida líquida de abertura', [money(r.netDebt0)]), row('Valor do capital próprio', [money(r.eqVal)], true)] : []), row('EV / EBITDA - mínimo', [money(r.multiples.enterpriseLow)]), row('EV / EBITDA - máximo', [money(r.multiples.enterpriseHigh)])]), text('Bases da avaliação', `Valor terminal: ${m.tv.metodo}. Os múltiplos usam o EBITDA do ano ${r.multiples.year}. Em projectos finitos, residual e libertação de fundo de maneio entram apenas uma vez no fluxo final.`), decision, ...notes], true);
  reports.demonstracoes = make('demonstracoes', [
    seriesTable('Demonstração de resultados projectada', [['Classe 6 - Volume de negócios', 'rev', false, true], ['71 - Custo das existências consumidas', 'cv', true], ['75 - Royalties', 'roy', true], ['72 - Custos com o pessoal', 'pes', true], ['75.2 - Fornecimentos e serviços de terceiros', 'fst', true], ['75 - Outros custos operacionais', 'out', true], ['EBITDA', 'ebitda', false, true], ['73 - Amortizações', 'da', true], ['Resultado operacional', 'ebit', false, true], ['76 - Custos financeiros', 'jur', true], ['Resultado antes de impostos', 'ebt', false, true], ['87 - Imposto sobre os lucros', 'imp', true], ['88 - Resultado líquido', 'rl', false, true]]),
    seriesTable('Balanço projectado', [['Classe 1 - Imobilizado líquido', 'imob'], ['Classe 2 - Existências', 'inv'], ['31 - Clientes', 'ar'], ['Classe 4 - Meios monetários', 'cash'], ['Total do activo', 'assets', false, true], ['51 - Capital e aportes', 'cap'], ['81/88 - Resultados acumulados', 'res'], ['33 - Empréstimos obtidos', 'debt'], ['32 - Fornecedores', 'ap'], ['Total do capital próprio e passivo', 'le', false, true], ['Diferença de reconciliação', 'check']]),
    seriesTable('Fluxos de caixa - método indirecto', [['Resultado líquido', 'rl'], ['Amortizações', 'da'], ['Variação do fundo de maneio', 'dnwc', true], ['Fluxo operacional', 'cfo', false, true], ['CAPEX / fluxo de investimento', 'cfi', false, true], ['Capital inicial realizado', 'eqInj'], ['Aportes adicionais modelados', 'eqAuto'], ['Desembolsos de dívida', 'draw'], ['Reembolsos de dívida', 'princ', true], ['Dividendos', 'div', true], ['Fluxo de financiamento', 'cff', false, true], ['Caixa no fim do ano', 'cash', false, true], ['FCFF', 'fcff'], ['FCFE potencial', 'fcfe'], ['CFADS', 'cfads']]), ...notes,
  ], true);
  reports.demonstracoes.blocks.filter((b): b is ReportTable => b.kind === 'table').slice(1).forEach((b) => { b.startNewPage = true; });
  const steps = [-0.2, -0.1, 0, 0.1, 0.2];
  reports.cenarios = make('cenarios', [table('Cenários', ['Cenário', 'Preço (x)', 'Volume (x)', 'Opex (x)', 'CAPEX (x)', 'VAL', 'TIR', 'DSCR mín.', 'Capital adicional'], (['base', 'otim', 'pess'] as const).map((c) => row(SCENARIO_LABELS[c], [ratio(m.cenarios[c].preco), ratio(m.cenarios[c].volume), ratio(m.cenarios[c].opex), ratio(m.cenarios[c].capex), money(scenarios[c].npv), pct(scenarios[c].irr), ratio(scenarios[c].minDscr), money(scenarios[c].fundingGap)]))), tornado, sensitivityTable,
    table('Matriz preço x volume - VAL', ['Volume / preço', ...steps.map((p) => `${p >= 0 ? '+' : ''}${p * 100}%`)], steps.map((v) => row(`${v >= 0 ? '+' : ''}${v * 100}%`, steps.map((p) => money(runFinancialModel(m, { volume: 1 + v, preco: 1 + p }).npv))))),
    table('Pontos de equilíbrio', ['Variável', 'Resultado'], [row('Preço que anula o VAL / preço do cenário', [pct(breakEven)]), ...m.receitas.map((v) => row(`${v.nome} - preço de equilíbrio por ${v.unid}`, [money(breakEven === null ? null : v.preco * breakEven * r.sc.preco)]))]), ...notes,
  ], true);
  reports.divida = make('divida', [text('Condições', r.hasDebt ? `Empréstimos novos e de abertura. Juros no ano do desembolso: ${m.divida.jurosDesembolso}% do juro anual da dívida nova.` : 'Sem dívida no modelo.'), debt, ...(r.hasDebt ? [dscrChart] : []), table('Totais do financiamento', ['Componente', 'Valor'], [row('Desembolsos', [money(sum(k.draw))]), row('Juros', [money(sum(k.jur))]), row('Capital reembolsado', [money(sum(k.princ))]), row('Serviço da dívida', [money(sum(k.ds))])]), covenants, ...notes], true);
  const conversion = (input as Record<string, unknown>).currencyConversion as import('./currency.js').FinancialCurrencyConversion | undefined;
  if (conversion && typeof conversion.from === 'string' && typeof conversion.to === 'string' && typeof conversion.rate === 'number' && Number.isFinite(conversion.rate) && typeof conversion.rateDate === 'string' && typeof conversion.source === 'string') {
    for (const report of Object.values(reports)) report.blocks.push(text('Conversão monetária', `1 ${conversion.from} = ${conversion.rate} ${conversion.to}, taxa de ${conversion.rateDate}. Fonte: ${conversion.source}. Conversão fixa dos montantes; inflação, juros e taxa de desconto conservam os pressupostos definidos e exigem revisão para a moeda de análise.`));
  }
  return { schemaVersion: 1, reportVersion: FINANCIAL_REPORT_VERSION, source: { ...source }, assumptions: m, inputAssumptions: structuredClone(input as Record<string, unknown>), result: r, scenarios, sensitivity, breakEvenPriceMultiplier: breakEven, personnelSources: personnelSources.map((v) => ({ ...v })), reports };
}
