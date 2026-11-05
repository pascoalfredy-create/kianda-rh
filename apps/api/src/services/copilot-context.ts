import { runFinancialModel, valuationDataIssue, type PlatformModule, type ValuationData } from '@kianda/core';

export interface CopilotFinancialContext { revision: number; unit: string; figures: Record<string, number | boolean | null | number[]>; notes: string[] }
/** Só números e rótulos definidos no servidor; nomes, NIF, notas e documentos não entram no contexto de IA. */
export function modelingCopilotContext(assumptions: unknown, currency: string, revision: number): CopilotFinancialContext {
  const r = runFinancialModel(assumptions);
  return { revision, unit: currency, figures: { years: r.years, val: r.npv, tirProjecto: r.irr, tirAccionista: r.irrEq, wacc: r.wacc, valorTerminalActualizado: r.pvTv, valorEmpresa: r.ev, dscrMinimo: r.minDscr, llcr: r.llcr, capexTotal: r.totalCapex, faltaFinanciamento: r.unfundedGap, receitas: r.k.rev, ebitda: r.k.ebitda, caixa: r.k.cash, fluxoLivreEmpresa: r.k.fcff, balancoFecha: r.checks.balance, caixaReconcilia: r.checks.cashFlow }, notes: [`Cenário ${r.scenario === 'otim' ? 'optimista' : r.scenario === 'pess' ? 'pessimista' : 'base'} dos pressupostos guardados.`, r.irrStatus !== 'ok' ? `Estado da TIR do projecto: ${r.irrStatus}` : 'TIR com raiz identificada pelo motor.', !r.fullyFunded ? 'O modelo apresenta necessidades de financiamento por cobrir.' : 'Financiamento coberto nos pressupostos actuais.'] };
}

/** Histórico do Valora, nas mesmas unidades e definições de receita/EBITDA/activo/passivo da interface. */
export function valuationCopilotContext(data: unknown, revision: number): CopilotFinancialContext {
  const issue = valuationDataIssue(data); if (issue) throw new Error(issue);
  const d = data as unknown as ValuationData, i = d.years.length - 1;
  const f = (k: keyof ValuationData['dr']) => d.dr[k]![i]!;
  const b = (k: keyof ValuationData['bal']) => d.bal[k]![i]!;
  const revenue = f('v61') + f('v62'), ebitda = revenue + f('v63') - f('c71') - f('c72') - f('c75');
  const ebit = ebitda - f('c73'), beforeTax = ebit + f('p66') - f('c76'), profit = beforeTax - Math.max(0, beforeTax * d.tax / 100);
  const currentAssets = b('exist') + b('clientes') + b('outdev') + b('caixa'), assets = b('imob') - b('amort') + b('invfin') + currentAssets;
  const currentLiabilities = b('empCP') + b('fornec') + b('estado') + b('outcred'), liabilities = currentLiabilities + b('empMLP'), equity = b('capital') + b('reservas') + profit;
  return { revision, unit: 'Milhões de Kz (Mkz)', figures: { anoHistorico: d.years[i]!, receitas: revenue, ebitda, resultadoOperacional: ebit, resultadoLiquidoCalculado: profit, taxaImpostoPressupostaPct: d.tax, activo: assets, passivo: liabilities, capitalProprioComResultado: equity, diferencaBalanco: assets - liabilities - equity, caixa: b('caixa'), dividaLiquida: b('empCP') + b('empMLP') - b('caixa'), liquidezGeral: currentLiabilities > 0 ? currentAssets / currentLiabilities : null, margemEbitda: revenue > 0 ? ebitda / revenue : null, mesesReaisEncerrados: d.fecho, caixaMinimaOrcamento: d.orc.cxMin }, notes: ['Resumo do último exercício histórico guardado; não inclui DCF, previsões ou meses reais ainda não analisados.', 'O resultado histórico usa a taxa de imposto pressuposta na análise; confirme o imposto e o balancete de origem.', Math.abs(assets - liabilities - equity) >= .5 ? 'O balanço histórico apresenta diferença; reveja a reconciliação antes da conclusão.' : 'Diferença do balanço histórico inferior a 0,5 Mkz; confirme a precisão no mapa.'] };
}
export const copilotContextFor = (module: PlatformModule, input: Record<string, unknown>, unit: string, revision: number) => module === 'modeling' ? modelingCopilotContext(input, unit, revision) : valuationCopilotContext(input, revision);
