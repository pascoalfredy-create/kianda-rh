const currency = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number) => `${currency.format(v * 1e6)} Kz`;
const pp = (v: number) => `${currency.format(v)} p.p.`;
const percent = (v: number) => `${currency.format(v * 100)}%`;
export const VALUATION_INTERPRETATION_TITLE = 'Interpretação dos resultados';

interface ValuationMethod { k: string; n: string; lo: number; mid: number; hi: number }
interface SensitivityTest { label: string; low: number; high: number; check: string }
export function interpretValuation({
  year, equity, methods, weights, dcfEquity, ev, terminal, tests, adverse,
}: {
  year: number; equity: number; methods: ValuationMethod[]; weights: Record<string, number>;
  dcfEquity: number; ev: number; terminal: number; tests: SensitivityTest[]; adverse: number;
}) {
  const active = methods.filter(m => (weights[m.k] ?? 0) > 0);
  const complete = active.length > 0 && active.every(m => [m.lo, m.mid, m.hi].every(Number.isFinite));
  const validTests = tests.filter(t => Number.isFinite(t.low) && Number.isFinite(t.high));
  const ranked = validTests.map(t => ({ ...t, spread: Math.abs(t.high - t.low) })).sort((a, b) => b.spread - a.spread);
  const driver = ranked[0];
  const dcfValid = Number.isFinite(dcfEquity);
  const lines = [
    complete && Number.isFinite(equity)
      ? `A 31/12/${year}, o valor ponderado dos capitais próprios é ${money(equity)}. Os métodos com peso positivo apresentam estimativas entre ${money(Math.min(...active.flatMap(m => [m.lo, m.hi])))} e ${money(Math.max(...active.flatMap(m => [m.lo, m.hi])))}. A faixa reúne os extremos dos métodos e testes utilizados.`
      : 'A síntese ponderada está indisponível. Atribua peso aos métodos suportados pelos dados e complete os pressupostos dos métodos seleccionados.',
  ];
  if (dcfValid && driver && driver.spread > 0) {
    const ties = ranked.filter(t => t.spread === driver.spread);
    lines.push(`No DCF, ${ties.map(t => t.label).join(' e ')} ${ties.length === 1 ? 'apresenta' : 'apresentam'} a maior amplitude (${money(driver.spread)}) entre as variações isoladas válidas de ±${pp(1)}.`);
  } else {
    lines.push('Os testes disponíveis não permitem identificar um pressuposto dominante no DCF.');
  }
  if (dcfValid && Number.isFinite(adverse)) {
    lines.push(`Com WACC ${pp(1)} acima e crescimento perpétuo ${pp(1)} abaixo, o DCF estima capitais próprios de ${money(adverse)}. A variação face ao DCF central é ${money(adverse - dcfEquity)}.`);
  } else {
    lines.push('O cenário de pressão do DCF está indisponível. Confirme a base de projecção e se o WACC supera o crescimento perpétuo.');
  }
  if (dcfValid && ev > 0 && Number.isFinite(terminal)) {
    lines.push(`A perpetuidade contribui com ${money(terminal)} para o EV (${percent(terminal / ev)}). Valide a capacidade de sustentar o fluxo de caixa após o horizonte explícito.`);
  }
  if (validTests.length < tests.length) {
    lines.push(`Testes indisponíveis para ${tests.filter(t => !validTests.includes(t)).map(t => t.label).join(', ')}.`);
  }
  if (complete && active.length > 1) {
    const central = active.map(m => m.mid);
    lines.push(`A diferença entre as estimativas centrais dos métodos ponderados é ${money(Math.max(...central) - Math.min(...central))}. Documente os pesos com base na qualidade dos dados e na aplicabilidade de cada método.`);
  }
  if (dcfValid && driver && driver.spread > 0) lines.push(driver.check);
  return lines;
}

export function interpretManagement(input: {
  period: string; revenue: number; budgetRevenue: number; ebitda: number; budgetEbitda: number;
  cash: number; cashMinimum: number; adverseDeviations: { l: string; eff: number }[];
  forecastLow: number | null; forecastMonth?: string;
} | null) {
  if (!input) return ['Sem meses reais encerrados. Introduza e encerre o primeiro mês para interpretar a execução face ao orçamento.'];
  const { period, revenue, budgetRevenue, ebitda, budgetEbitda, cash, cashMinimum, adverseDeviations, forecastLow, forecastMonth } = input;
  const budget = budgetRevenue > 0 ? ` (${percent(revenue / budgetRevenue - 1)} face ao orçamento)` : ' (sem base orçamental positiva para calcular a variação percentual)';
  const deviation = ebitda - budgetEbitda;
  const main = adverseDeviations.find(d => Number.isFinite(d.eff) && d.eff < 0);
  const cashDelta = cash - cashMinimum;
  return [
    `No acumulado até ${period}, a receita real foi de ${money(revenue)}${budget}. O EBITDA real foi de ${money(ebitda)}, com desvio de ${money(deviation)} face ao orçamento.`,
    main ? `${main.l} apresenta o maior desvio desfavorável entre as rubricas analisadas (${money(main.eff)}). Valide a origem do desvio e distinga efeitos recorrentes de ocorrências pontuais.`
      : 'Confirme se o orçamento e os meses reais têm a mesma cobertura de rubricas.',
    `A caixa no fecho foi de ${money(cash)}, com uma diferença de ${money(cashDelta)} face ao mínimo definido no orçamento.`,
    forecastLow != null && forecastMonth
      ? `Na previsão após o último fecho disponível, o saldo mais baixo é de ${money(forecastLow)} em ${forecastMonth}. ${forecastLow < cashMinimum ? 'Valide datas de recebimento, pagamentos e fontes de liquidez antes desse mês.' : 'Acompanhe cobranças e pagamentos para preservar a margem de liquidez.'}`
      : 'A previsão de meses seguintes está indisponível neste reporte.',
  ];
}
