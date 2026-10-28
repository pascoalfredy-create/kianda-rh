/** Contrato anual compatível com os pressupostos do protótipo Integra. Montantes de entrada/saída em unidades da moeda do projecto. */
export const FINANCIAL_ENGINE_VERSION = 'integra-1.0.0';
export const FINANCIAL_SECTORS = ['mineracao', 'petroleo', 'agro', 'comercio', 'servicos', 'industria', 'imobiliario', 'tecnologia'] as const;
export type FinancialSector = typeof FINANCIAL_SECTORS[number];
export type FinancialScenario = 'base' | 'otim' | 'pess';
export interface ScenarioFactors { preco: number; volume: number; opex: number; capex: number }
export interface FinancialRevenue { nome: string; unid: string; qtd: number; cresc: number; ramp: string; preco: number; esc: number }
export interface FinancialCapex { nome: string; ano: number; valor: number; vida: number }
export interface FinancialAssumptions {
  horizonte: number; anoBase: number; inicio: 'greenfield' | 'existente'; inicioOp: number; preOp: number;
  inflacao: number; ii: number; royalty: number; cvar: number; pessoal: number; fst: number; outros: number;
  manut: number; vidaManut: number; dso: number; dio: number; dpo: number; capitalInicial: number; payout: number; caixaMin: number;
  divida: { montante: number; taxa: number; prazo: number; carencia: number; ano: number; jurosDesembolso: number };
  wacc: { modo: 'manual' | 'capm'; rf: number; erp: number; beta: number; crp: number; kd: number; wd: number; manual: number };
  tv: { metodo: 'gordon' | 'multiplo' | 'nenhum'; g: number; mult: number };
  abertura: { imob: number; vidaRem: number; exist: number; clientes: number; caixa: number; fornec: number; divida: number; divTaxa: number; divPrazo: number };
  receitas: FinancialRevenue[]; capex: FinancialCapex[]; cenarios: Record<FinancialScenario, ScenarioFactors>; cen: FinancialScenario;
  cov: { dscr: number; ndEbitda: number; icr: number }; mult: { lo: number; hi: number }; sens: number; prejuizosAnos: number; capitalAutomatico: boolean;
  valorResidualLiquido: number; libertarFundoManeio: boolean;
}
export interface FinancialOverrides { cen?: FinancialScenario; preco?: number; volume?: number; cvar?: number; fixos?: number; capex?: number; wacc?: number }
export const FINANCIAL_SERIES = [
  'rev', 'cv', 'roy', 'pes', 'fst', 'out', 'ebitda', 'da', 'ebit', 'jur', 'ebt', 'imp', 'rl',
  'capex', 'capexExp', 'capexMan', 'ar', 'inv', 'ap', 'nwc', 'dnwc', 'cfo', 'cfi', 'draw', 'princ',
  'eqInj', 'eqAuto', 'div', 'cff', 'cash', 'debt', 'imobB', 'depAc', 'imob', 'cap', 'res', 'assets', 'le', 'check',
  'fcff', 'fcfe', 'equityCashFlow', 'cfads', 'ds', 'taxU', 'unfunded',
] as const;
export type FinancialSeries = typeof FINANCIAL_SERIES[number];
export type IrrStatus = 'ok' | 'no_sign_change' | 'non_conventional' | 'outside_range';
export interface IrrResult { value: number | null; status: IrrStatus }
export interface FinancialResult {
  engineVersion: string; H: number; years: number[]; scenario: FinancialScenario; sc: ScenarioFactors;
  k: Record<FinancialSeries, number[]> & { qty: number[]; dscr: (number | null)[] };
  lines: Record<string, number[]>;
  wacc: number; ke: number; tv: number; pvTv: number; residual: number; terminalWorkingCapital: number;
  valuationFlows: { project: number[]; equity: number[] | null }; terminalEquityValue: number;
  npv: number; npvSemTv: number; irr: number | null; irrEq: number | null; irrStatus: IrrStatus | 'not_applicable'; irrEqStatus: IrrStatus | 'not_funded' | 'not_applicable';
  pb: number | null; pbD: number | null; pbDuration: ReturnType<typeof import('./math.js').financialDuration>;
  pbDDuration: ReturnType<typeof import('./math.js').financialDuration>;
  pi: number | null; pvCapex: number; ev: number; netDebt0: number; eqVal: number; bookEq: number;
  fundingGap: number; unfundedGap: number; fullyFunded: boolean; totalCapex: number;
  hasDebt: boolean; repY: number[]; serviceYears: number[]; minDscr: number | null; avgDscr: number | null;
  llcr: number | null; debtCap: number | null; ndE: (number | null)[]; icr: (number | null)[];
  covenants: { year: number; dscr: boolean | null; ndEbitda: boolean | null; icr: boolean | null }[];
  multiples: { year: number; ebitda: number; enterpriseLow: number | null; enterpriseHigh: number | null; equityLow: number | null; equityHigh: number | null };
  checks: { balance: boolean; cashFlow: boolean; maxBalanceDifference: number; maxCashFlowDifference: number };
  warnings: { code: string; message: string }[];
}
export class FinancialModelError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) { super('Pressupostos financeiros inválidos'); }
}
