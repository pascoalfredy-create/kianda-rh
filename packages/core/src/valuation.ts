/**
 * Kianda Valora — contrato de dados das análises (demonstrações, orçamento, tesouraria e avaliação).
 * O motor de cálculo corre no navegador (interface aprovada); aqui ficam os limites comerciais,
 * a estrutura mínima que o servidor aceita e a análise em branco.
 * Unidade: milhões de Kz (Mkz). Classificação: PGC Angola (Dec. 82/01) — classe 6 proveitos, classe 7 custos.
 */

import { cyclePrice, CYCLES, type BillingCycle } from './licensing.js';
import { kz } from './money.js';

export const VALUATION_DATA_VERSION = 3;
export const VALUATION_INCLUDED_USERS = 5;
/** Limite por omissão quando não há plano gravado (licenças antigas ou activação manual sem plano). */
export const VALUATION_TRIAL_ANALYSES = 3;
export const VALUATION_PRICE_PUBLISHED = true;
/** Utilizador além dos 5 incluídos, por mês do ciclo, sem desconto. */
export const VALUATION_EXTRA_USER_MONTHLY_MINOR = kz(10_000);
/**
 * Licenciado por análises activas (uma análise = uma entidade analisada), sem relação com o efectivo do RH nem com sectores.
 * Uma análise restaurada e de novo arquivada no mesmo mês continua a ocupar a vaga até ao fim do mês (sem rotação de clientes).
 * Semestral −10% e anual −15% à vista, como os outros módulos (`cyclePrice`).
 */
export const VALUATION_PLANS = [
  // Chaves estáveis (gravadas em licenças e pedidos); nomes e limites seguem os segmentos de cliente.
  { key: 'essencial', label: 'Essencial', audience: 'A própria empresa e até duas participadas', analysisLimit: 3, monthlyMinor: kz(32_900) },
  { key: 'pme', label: 'PME / Grupo', audience: 'Grupos pequenos', analysisLimit: 10, monthlyMinor: kz(52_900) },
  { key: 'corporate', label: 'Corporate', audience: 'Grupos e consultoras pequenas', analysisLimit: 20, monthlyMinor: kz(72_900) },
  { key: 'enterprise40', label: 'Profissional', audience: 'Consultoras e contabilistas', analysisLimit: 40, monthlyMinor: kz(92_900) },
  { key: 'unlimited', label: 'Ilimitado', audience: 'Bancos, auditoras e fundos', analysisLimit: null, monthlyMinor: kz(129_900) },
] as const;
export type ValuationPlanKey = typeof VALUATION_PLANS[number]['key'];
export const VALUATION_PLAN_KEYS = VALUATION_PLANS.map(p => p.key) as unknown as readonly [ValuationPlanKey, ...ValuationPlanKey[]];

/** Preço de um ciclo do plano; os extras somam 10 000 Kz por utilizador e mês do ciclo, sem desconto. */
export function valuationPlanPrice(planKey: string, cycle: BillingCycle, extraUsers = 0) {
  if (!Number.isSafeInteger(extraUsers) || extraUsers < 0 || extraUsers > 100_000) throw new RangeError('Número de utilizadores extra inválido');
  const plan = VALUATION_PLANS.find(p => p.key === planKey);
  if (!plan) return null;
  const months = CYCLES[cycle].months;
  const extraMinor = extraUsers * VALUATION_EXTRA_USER_MONTHLY_MINOR * months;
  const base = cyclePrice({ key: plan.key, label: plan.label, minEmployees: 0, maxEmployees: null, monthlyMinor: plan.monthlyMinor }, cycle)!;
  return { grossMinor: base.grossMinor + extraMinor, discountMinor: base.discountMinor, totalMinor: base.totalMinor + extraMinor, extraMinor };
}
export const VALUATION_MAX_BYTES = 1_000_000;

/** Rubricas de resultados (movimento do período). */
export const VALUATION_FLOW_KEYS = ['v61', 'v62', 'v63', 'c71', 'c72', 'c73', 'c75', 'p66', 'c76', 'imp'] as const;
/** Resultados não operacionais e extraordinários (68/69 e 78/79): opcionais nas análises gravadas antes de 11/11/2026. */
export const VALUATION_OPTIONAL_FLOW_KEYS = ['p68', 'c78'] as const;
/** Rubricas de balanço (saldo final). */
export const VALUATION_BALANCE_KEYS = ['imob', 'amort', 'invfin', 'exist', 'clientes', 'outdev', 'caixa', 'capital', 'reservas', 'empMLP', 'empCP', 'fornec', 'estado', 'outcred'] as const;
/** Histórico anual: o imposto não é pedido (calcula-se à taxa da análise). */
export const VALUATION_HISTORY_FLOW_KEYS = ['v61', 'v62', 'v63', 'c71', 'c72', 'c75', 'c73', 'p66', 'c76'] as const;

export interface ValuationCapacity {
  analysisLimit: number | null; includedUsers: number; extraUsers: number; userLimit: number;
  activeAnalyses: number; enabledUsers: number; canCreateAnalysis: boolean; canAddUser: boolean;
}

export function valuationCapacity(limits: { analysisLimit: number | null; extraUsers: number }, activeAnalyses: number, enabledUsers: number): ValuationCapacity {
  for (const value of [limits.extraUsers, activeAnalyses, enabledUsers, ...(limits.analysisLimit === null ? [] : [limits.analysisLimit])]) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Limite inválido');
  if (limits.analysisLimit !== null && limits.analysisLimit < 1) throw new RangeError('O contrato deve incluir pelo menos uma análise');
  const userLimit = VALUATION_INCLUDED_USERS + limits.extraUsers;
  return { analysisLimit: limits.analysisLimit, includedUsers: VALUATION_INCLUDED_USERS, extraUsers: limits.extraUsers, userLimit, activeAnalyses, enabledUsers,
    canCreateAnalysis: limits.analysisLimit === null || activeAnalyses < limits.analysisLimit, canAddUser: enabledUsers < userLimit };
}

export interface ValuationBlankOptions { entity: string; lastClosedYear: number; historyYears?: number; nif?: string }

const zeros = (n: number) => Array.from({ length: n }, () => 0);
const emptyMonths = () => Array.from({ length: 12 }, () => null as number | null);

/**
 * Análise em branco: exercícios encerrados a zero, orçamento neutro e sem meses reais.
 * Os pressupostos de mercado (taxa sem risco, prémios) ficam como ponto de partida editável.
 */
export function blankValuationData(options: ValuationBlankOptions) {
  const n = options.historyYears ?? 3;
  if (!Number.isInteger(n) || n < 2 || n > 10) throw new RangeError('Indique entre 2 e 10 exercícios encerrados.');
  if (!Number.isInteger(options.lastClosedYear) || options.lastClosedYear < 1990 || options.lastClosedYear > 2099) throw new RangeError('Último exercício encerrado inválido.');
  const entity = options.entity.trim();
  if (!entity) throw new RangeError('Indique a entidade analisada.');
  const years = Array.from({ length: n }, (_, i) => options.lastClosedYear - n + 1 + i);
  return {
    v: VALUATION_DATA_VERSION,
    ex: options.lastClosedYear + 1,
    years,
    dr: Object.fromEntries(VALUATION_HISTORY_FLOW_KEYS.map(k => [k, zeros(n)])),
    bal: Object.fromEntries(VALUATION_BALANCE_KEYS.map(k => [k, zeros(n)])),
    tax: 25,
    orc: {
      vendas: 0, saz: Array.from({ length: 12 }, (_, i) => (i < 8 ? 8.33 : 8.34)), p62: 0, p63: 0, mb: 0,
      salBase: 0, inss: 8, subFer: 50, mesFer: 7, subNat: 50, mesNat: 12,
      fseFix: 0, fseVar: 0, amortBase: 0, capex: [], taxa: 0, amortMLP: 0, loans: [],
      linha: false, linhaLim: 0, cxMin: 0, txApl: 0,
      pmr: 30, pmp: 30, pms: 30, ivaAb: 0, iiV: 0, iiM: 5, divV: 0, divM: 6,
    },
    fecho: 0,
    real: Object.fromEntries([...VALUATION_FLOW_KEYS, ...VALUATION_OPTIONAL_FLOW_KEYS, ...VALUATION_BALANCE_KEYS].map(k => [k, emptyMonths()])),
    var: { c71: 0, c72: 0, c75: 0 },
    dcf: { anchor: true, g: [10, 10, 9, 8, 8], mTarget: 15, da: 3, capex: 4, rf: 17, beta: 1, erp: 6.5, crp: 2.5, kd: 21, wd: 30, gT: 8, mid: true },
    peers: [],
    disc: 25,
    imo: [],
    eq: [],
    w: { dcf: 60, ev: 0, evs: 0, pe: 0, nav: 40 },
    meta: { ent: entity, prep: 'Direcção Financeira', dest: 'Conselho de Administração', nif: options.nif?.trim() ?? '' },
    rnotes: {},
  };
}

export type ValuationData = ReturnType<typeof blankValuationData>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validação estrutural no servidor: garante que qualquer análise guardada abre no motor.
 * Devolve a primeira falha em português, ou null.
 */
export function valuationDataIssue(data: unknown): string | null {
  if (!isObject(data)) return 'Análise inválida.';
  if (JSON.stringify(data).length > VALUATION_MAX_BYTES) return 'A análise excede o tamanho máximo (1 MB).';
  if (data.v !== VALUATION_DATA_VERSION) return 'Versão de dados não suportada.';
  const years = data.years;
  if (!Array.isArray(years) || years.length < 2 || years.length > 10 || !years.every((y, i) => Number.isInteger(y) && y >= 1990 && y <= 2099 && (i === 0 || y === years[i - 1] + 1))) return 'Os exercícios encerrados devem ser 2 a 10 anos consecutivos.';
  if (data.ex !== undefined && data.ex !== years[years.length - 1] + 1) return 'O exercício corrente deve ser o ano seguinte ao último encerrado.';
  const series = (group: unknown, keys: readonly string[], length: number, nullable: boolean, label: string) => {
    if (!isObject(group)) return `${label}: estrutura em falta.`;
    for (const key of keys) {
      const row = group[key];
      if (!Array.isArray(row) || row.length !== length || !row.every(v => finite(v) || (nullable && v === null))) return `${label}: valores inválidos em ${key}.`;
    }
    return null;
  };
  const issue = series(data.dr, VALUATION_HISTORY_FLOW_KEYS, years.length, false, 'Histórico de resultados')
    ?? series(data.bal, VALUATION_BALANCE_KEYS, years.length, false, 'Histórico de balanço')
    ?? series(data.real, [...VALUATION_FLOW_KEYS, ...VALUATION_BALANCE_KEYS], 12, true, 'Dados reais mensais')
    ?? (isObject(data.real) ? series(data.real, VALUATION_OPTIONAL_FLOW_KEYS.filter(k => k in (data.real as object)), 12, true, 'Dados reais mensais') : null);
  if (issue) return issue;
  if (!Number.isInteger(data.fecho) || (data.fecho as number) < 0 || (data.fecho as number) > 12) return 'O mês de fecho deve estar entre 0 e 12.';
  if (!finite(data.tax) || data.tax < 0 || data.tax > 100) return 'Taxa de imposto inválida.';
  const orc = data.orc;
  if (!isObject(orc) || !Array.isArray(orc.saz) || orc.saz.length !== 12 || !orc.saz.every(finite) || !Array.isArray(orc.capex) || !Array.isArray(orc.loans)) return 'Orçamento incompleto.';
  if (!isObject(data.dcf) || !Array.isArray((data.dcf as Record<string, unknown>).g) || ((data.dcf as Record<string, unknown>).g as unknown[]).length !== 5) return 'Pressupostos de avaliação incompletos.';
  for (const list of ['peers', 'imo', 'eq'] as const) if (!Array.isArray(data[list]) || (data[list] as unknown[]).length > 200) return 'Listas de comparáveis ou activos inválidas.';
  if (!isObject(data.w)) return 'Ponderações da síntese em falta.';
  return null;
}

/** Custos com o pessoal de um mês (conta 72) em Mkz, a partir dos montantes do processamento em cêntimos de Kz. */
export function personnelCostMkz(grossMinor: number, employerSocialSecurityMinor: number): number {
  if (!Number.isSafeInteger(grossMinor) || !Number.isSafeInteger(employerSocialSecurityMinor)) throw new RangeError('Montantes inválidos');
  return Math.round((grossMinor + employerSocialSecurityMinor) / 1e8 * 1000) / 1000;
}
