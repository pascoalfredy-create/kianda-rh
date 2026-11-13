import { financialBreakEvenPrice, financialScenarios, financialSensitivity } from './analysis.js';
import { creditDiagnosis, creditDiagnosisText } from './credit.js';
import type { FinancialAssumptions, FinancialResult, FinancialScenario } from './types.js';
import { validateFinancialAssumptions } from './validation.js';

export const FINANCIAL_SCENARIO_LABELS = { base: 'Base', otim: 'Optimista', pess: 'Pessimista' };
export const FINANCIAL_DRIVER_LABELS = { preco: 'Preço de venda', volume: 'Volume / produção', cvar: 'Custos variáveis', fixos: 'Custos fixos', capex: 'CAPEX', wacc: 'WACC' };
export const INTERPRETATION_NOTE_LIMIT = 1200;
export const INTERPRETATION_SECTION_PREFIX = 'Interpretação · ';
export const INTERPRETATION_NOTE_TITLE = 'Comentário do responsável';

const DRIVER_CHECKS = {
  preco: 'Confirme os preços com contratos, propostas ou dados de mercado.',
  volume: 'Valide procura, capacidade instalada e o ritmo de entrada em operação.',
  cvar: 'Confirme custos unitários e condições de fornecimento.',
  fixos: 'Reconcilie pessoal, serviços e restantes custos fixos com o orçamento.',
  capex: 'Confirme cotações, calendário de desembolsos e contingências.',
  wacc: 'Valide a taxa de desconto face à moeda, ao risco e à estrutura de financiamento.',
};

export function financialInterpretationNote(input: unknown, scenario: FinancialScenario): string {
  const note = (input as { interpretationNotes?: Partial<Record<FinancialScenario, unknown>> } | null)?.interpretationNotes?.[scenario];
  return typeof note === 'string' ? note.slice(0, INTERPRETATION_NOTE_LIMIT).trim() : '';
}

export function interpretFinancialResult(
  input: unknown, r: FinancialResult, currency: string,
  evidence?: { scenarios: ReturnType<typeof financialScenarios>; sensitivity: ReturnType<typeof financialSensitivity>; breakEven: number | null },
) {
  const m = validateFinancialAssumptions(input);
  const scenarios = evidence?.scenarios ?? financialScenarios(m);
  const sensitivity = evidence?.sensitivity ?? financialSensitivity(m, r.scenario);
  const breakEven = evidence ? evidence.breakEven : financialBreakEvenPrice(m, r.scenario);
  const n = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v: number) => `${n.format(v)} ${currency}`;
  const percent = (v: number) => `${n.format(v * 100)}%`;
  const ex = m.inicio === 'existente';
  const section = (title: string, text: string) => ({ title: INTERPRETATION_SECTION_PREFIX + title, text });
  const scenario = FINANCIAL_SCENARIO_LABELS[r.scenario];
  const pessimistic = scenarios.pess;
  const drivers = sensitivity.filter(s => s.impact != null && s.impact > 0);
  const driver = drivers[0];
  const unavailable = sensitivity.filter(s => s.impact == null);
  const credit = creditDiagnosis(m, r);

  const meaning = ex
    ? `O valor da empresa (EV) é ${money(r.ev)}. Após deduzir a dívida líquida de abertura de ${money(r.netDebt0)}, o valor dos capitais próprios é ${money(r.eqVal)}.`
    : `O VAL de ${money(r.npv)}, à taxa de desconto de ${percent(r.wacc)}, indica que o projecto ${r.npv > 0 ? 'cria valor económico' : r.npv < 0 ? 'destrói valor económico' : 'atinge o equilíbrio económico'} nas condições modeladas. ${r.irr == null ? 'A TIR do projecto está indisponível. Use o VAL e reveja o perfil dos fluxos de caixa.' : `A TIR do projecto é ${percent(r.irr)}.`}`;
  const stress = ex
    ? `No cenário pessimista, os capitais próprios valem ${money(pessimistic.eqVal)}`
    : `No cenário pessimista, o VAL é ${money(pessimistic.npv)}`;
  const delta = ex ? pessimistic.eqVal - r.eqVal : pessimistic.npv - r.npv;
  const driverText = driver && driver.low != null && driver.high != null
    ? `${FINANCIAL_DRIVER_LABELS[driver.driver]} regista a maior amplitude entre os testes válidos (variação isolada de ±${n.format(m.sens)}%). O ${ex ? 'EV' : 'VAL'} passa a ${money(driver.low)} com a redução e a ${money(driver.high)} com o aumento.${drivers[1]?.impact === driver.impact ? ' Há empate com outro pressuposto na amplitude calculada.' : ''}`
    : 'Os testes disponíveis não identificam um pressuposto dominante.';
  const missing = unavailable.length ? ` Teste incompleto para ${unavailable.map(s => FINANCIAL_DRIVER_LABELS[s.driver]).join(', ')}.` : '';
  const terminal = r.pvTv !== 0 ? `O valor actual da continuidade é ${money(r.pvTv)}. Sem essa parcela, o ${ex ? 'EV' : 'VAL'} seria ${money(r.npvSemTv)}. ` : '';
  const funding = r.fundingGap > 0
    ? `${m.capitalAutomatico ? 'Aportes adicionais modelados' : 'Necessidade adicional de financiamento'} de ${money(r.fundingGap)}. Confirme montantes, datas e compromissos de financiamento.`
    : 'O modelo não identifica necessidade adicional de financiamento.';
  const price = !ex && breakEven != null
    ? ` O VAL atinge o equilíbrio com o preço a ${percent(breakEven)} do preço do cenário activo, mantendo os restantes pressupostos.`
    : '';

  return [
    section('Significado do resultado', `Cenário ${scenario}, horizonte de ${r.H} anos. ${meaning}`),
    section('Pressuposto com maior impacto', driverText + missing),
    section('Cenário pessimista', stress + (r.scenario === 'pess' ? '.' : `, com variação de ${money(delta)} face ao cenário ${scenario}.`) + price),
    section('Financiamento e validações', [funding, credit ? creditDiagnosisText(m, r, credit) : '', terminal.trim(), driver ? DRIVER_CHECKS[driver.driver] : 'Reveja os pressupostos e a amplitude dos testes.', ...r.warnings.map(w => w.message)].filter(Boolean).join(' ')),
  ];
}
