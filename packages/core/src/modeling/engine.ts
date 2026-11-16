import { financialDuration, financialIrr, financialNpv, financialPayback } from './math.js';
import {
  FINANCIAL_ENGINE_VERSION,
  FINANCIAL_SERIES,
  FinancialModelError,
  type FinancialAssumptions,
  type FinancialOverrides,
  type FinancialResult,
  type FinancialSeries,
} from './types.js';
import { validateFinancialAssumptions, validateFinancialOverrides } from './validation.js';

/** Os fluxos e demonstrações são construídos em cêntimos inteiros. Taxas, volumes e desconto mantêm precisão fraccionária. */
function minor(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded))
    throw new FinancialModelError([
      {
        path: 'calculo',
        message: 'Montante fora do intervalo de precisão suportado; reveja valores, crescimento e horizonte',
      },
    ]);
  return rounded === 0 ? 0 : rounded;
}
const amount = (value: number) => minor(value * 100);

/** Prejuízo do ano t pode ser utilizado nos n anos seguintes; FIFO, sem crédito fiscal de caixa. */
export function financialTaxes(bases: readonly number[], rate: number, years: number): number[] {
  if (
    bases.some(v => !Number.isSafeInteger(v)) ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 1 ||
    !Number.isInteger(years) ||
    years < 0 ||
    years > 20
  )
    throw new RangeError('Bases ou parâmetros fiscais inválidos');
  const pool: { remaining: number; expires: number }[] = [];
  return bases.map((base, t) => {
    if (base < 0) {
      if (years > 0) pool.push({ remaining: -base, expires: t + years });
      return 0;
    }
    let taxable = base;
    for (const loss of pool) {
      if (loss.expires < t || loss.remaining <= 0) continue;
      const used = Math.min(taxable, loss.remaining);
      taxable -= used;
      loss.remaining -= used;
      if (!taxable) break;
    }
    return minor(taxable * rate);
  });
}

/** Função pura, independente de RH, persistência, browser e apresentação. */
export function runFinancialModel(input: unknown, overrides: FinancialOverrides = {}): FinancialResult {
  const m = validateFinancialAssumptions(input),
    ov = validateFinancialOverrides(overrides);
  return calculate(m, ov);
}

function calculate(m: FinancialAssumptions, ov: FinancialOverrides): FinancialResult {
  const L = createLedger(m, ov);
  const { ke, wacc } = discountRate(m, ov);
  const { lines, qty } = projectRevenues(L);
  operatingCosts(L);
  investmentAndDepreciation(L);
  debtSchedule(L);
  const tax = taxSchedule(L);
  workingCapital(L);
  const funding = cashAndBalance(L, tax.taxUPaid);
  const value = valuation(L, wacc, tax.nextYearTax);
  const debt = debtMetrics(L, funding.dscr);
  modelWarnings(L, value);
  const result = assembleResult(L, { ke, wacc, lines, qty, ...funding, ...value, ...debt });
  addCovenantsAndMultiples(result, m);
  assertFinite(result);
  return result;
}

/** Séries anuais (em cêntimos) e parâmetros do cenário partilhados pelos passos do cálculo. */
function createLedger(m: FinancialAssumptions, ov: FinancialOverrides) {
  const H = m.horizonte,
    T = H + 1,
    zeros = () => Array<number>(T).fill(0);
  const k = Object.fromEntries(FINANCIAL_SERIES.map(key => [key, zeros()])) as Record<FinancialSeries, number[]>;
  const scenario = ov.cen ?? m.cen,
    sc = m.cenarios[scenario];
  const ex = m.inicio === 'existente';
  const warnings: FinancialResult['warnings'] = [];
  return {
    m,
    H,
    T,
    zeros,
    k,
    a: (key: FinancialSeries, t: number) => k[key][t]!,
    set: (key: FinancialSeries, t: number, v: number) => {
      k[key][t] = minor(v);
    },
    scenario,
    sc,
    pM: sc.preco * (ov.preco ?? 1),
    vM: sc.volume * (ov.volume ?? 1),
    cvM: sc.opex * (ov.cvar ?? 1),
    fM: sc.opex * (ov.fixos ?? 1),
    kM: sc.capex * (ov.capex ?? 1),
    ex,
    st: ex ? 1 : m.inicioOp,
    ab: m.abertura,
    d: m.divida,
    warnings,
    warn: (code: string, message: string) => {
      warnings.push({ code, message });
    },
  };
}
type Ledger = ReturnType<typeof createLedger>;

/** Custo do capital próprio (CAPM com prémio de risco país) e WACC, manual ou calculado. */
function discountRate(m: FinancialAssumptions, ov: FinancialOverrides) {
  const ke = (m.wacc.rf + m.wacc.beta * m.wacc.erp + m.wacc.crp) / 100;
  const wacc =
    (m.wacc.modo === 'manual'
      ? m.wacc.manual / 100
      : ke * (1 - m.wacc.wd / 100) + ((m.wacc.kd / 100) * (1 - m.ii / 100) * m.wacc.wd) / 100) * (ov.wacc ?? 1);
  if (m.tv.metodo === 'gordon' && wacc - m.tv.g / 100 <= 1e-12)
    throw new FinancialModelError([
      { path: 'tv.g', message: 'O crescimento perpétuo deve ser inferior ao WACC, incluindo no cenário seleccionado' },
    ]);
  return { ke, wacc };
}

/** Receitas por linha: quantidade (rampa de arranque e crescimento) × preço (escalada) × cenário. */
function projectRevenues(L: Ledger) {
  const { m, H, st, ex, vM, pM } = L;
  const lines: Record<string, number[]> = {},
    qty = L.zeros();
  for (const [i, r] of m.receitas.entries()) {
    const ramp = r.ramp
        .trim()
        .split(/[,;\s]+/)
        .map(v => Number(v) / 100),
      line = L.zeros();
    for (let t = st; t <= H; t++) {
      const j = t - st;
      const q = r.qtd * (ex ? 1 : (ramp[j] ?? 1)) * (1 + r.cresc / 100) ** j * vM;
      if (!Number.isFinite(q))
        throw new FinancialModelError([{ path: `receitas.${i}`, message: 'Volume fora do intervalo suportado' }]);
      line[t] = amount(q * r.preco * (1 + r.esc / 100) ** (t - 1) * pM);
      L.set('rev', t, L.a('rev', t) + line[t]!);
      if (i === 0) qty[t] = q;
    }
    lines[String(i)] = line;
  }
  return { lines, qty };
}

/** Custos variáveis, royalties e custos fixos (com inflação e fase pré-operacional) até ao EBITDA. */
function operatingCosts(L: Ledger) {
  const { m, H, st, a, set, cvM, fM } = L;
  for (let t = 1; t <= H; t++) {
    const inflation = (1 + m.inflacao / 100) ** (t - 1),
      preOp = t >= st ? 1 : m.preOp / 100;
    set('cv', t, ((a('rev', t) * m.cvar) / 100) * cvM);
    set('roy', t, (a('rev', t) * m.royalty) / 100);
    set('pes', t, amount(m.pessoal * inflation * fM * preOp));
    set('fst', t, amount(m.fst * inflation * fM * preOp));
    set('out', t, amount(m.outros * inflation * fM * preOp));
    set('ebitda', t, a('rev', t) - a('cv', t) - a('roy', t) - a('pes', t) - a('fst', t) - a('out', t));
  }
}

/** Investimento de expansão e de manutenção, amortizações em linha recta e EBIT. */
function investmentAndDepreciation(L: Ledger) {
  const { m, H, st, ex, ab, a, set, kM } = L;
  const depreciate = (value: number, first: number, life: number) => {
    const annual = minor(value / life);
    let remaining = value;
    for (let t = first; t < first + life && t <= H; t++) {
      const dep = t === first + life - 1 ? remaining : Math.min(annual, remaining);
      set('da', t, a('da', t) + dep);
      remaining -= dep;
    }
  };
  for (const c of m.capex) {
    const value = amount(c.valor * kM);
    set('capexExp', c.ano, a('capexExp', c.ano) + value);
    depreciate(value, Math.max(c.ano + 1, st), c.vida);
  }
  for (let t = 1; t <= H; t++) {
    set('capexMan', t, ((a('rev', t) * m.manut) / 100) * kM);
    depreciate(a('capexMan', t), t + 1, m.vidaManut);
  }
  if (ex) depreciate(amount(ab.imob), 1, ab.vidaRem);
  for (let t = 0; t <= H; t++) {
    set('capex', t, a('capexExp', t) + a('capexMan', t));
    set('ebit', t, a('ebitda', t) - a('da', t));
  }
}

/** Empréstimo novo (carência, prestações constantes de capital) e dívida existente; juros e resultado antes de impostos. */
function debtSchedule(L: Ledger) {
  const { H, ex, ab, d, a, set } = L;
  let balance = 0,
    openingDebt = ex ? amount(ab.divida) : 0;
  const principal = amount(d.montante),
    instalment = minor(principal / Math.max(1, d.prazo - d.carencia));
  const openingInstalment = minor(openingDebt / ab.divPrazo);
  for (let t = 0; t <= H; t++) {
    const draw = t === d.ano ? principal : 0;
    const interest =
      minor(((t === d.ano ? (principal * d.jurosDesembolso) / 100 : balance) * d.taxa) / 100) +
      (t > 0 ? minor((openingDebt * ab.divTaxa) / 100) : 0);
    let repayment = 0;
    if (t > d.ano + d.carencia && t <= d.ano + d.prazo)
      repayment = t === d.ano + d.prazo ? balance : Math.min(balance, instalment);
    balance += draw - repayment;
    let oldRepayment = 0;
    if (t > 0 && openingDebt > 0) {
      oldRepayment = t === ab.divPrazo ? openingDebt : Math.min(openingDebt, openingInstalment);
      openingDebt -= oldRepayment;
    }
    set('draw', t, draw);
    set('princ', t, repayment + oldRepayment);
    set('jur', t, interest);
    set('debt', t, balance + openingDebt);
    set('ds', t, a('jur', t) + a('princ', t));
    set('ebt', t, a('ebit', t) - a('jur', t));
  }
}

/** Imposto Industrial (com reporte de prejuízos) e imposto desalavancado; pago no próprio ano ou no seguinte. */
function taxSchedule(L: Ledger) {
  const { m, k } = L;
  k.imp = financialTaxes(k.ebt, m.ii / 100, m.prejuizosAnos);
  k.taxU = financialTaxes(k.ebit, m.ii / 100, m.prejuizosAnos);
  // A dívida ao Estado fica no balanço até ao pagamento.
  const nextYearTax = m.impostoPagamento === 'ano_seguinte';
  const lag = (s: number[]) => s.map((v, t) => (nextYearTax ? (t ? s[t - 1]! : 0) : v));
  k.taxPaid = lag(k.imp);
  k.taxPay = k.imp.map(v => (nextYearTax ? v : 0));
  const taxUPaid = lag(k.taxU);
  k.taxUPaid = taxUPaid;
  return { nextYearTax, taxUPaid };
}

/** Resultado líquido e fundo de maneio (clientes, existências e fornecedores pelos prazos médios). */
function workingCapital(L: Ledger) {
  const { m, H, ex, ab, a, set } = L;
  for (let t = 0; t <= H; t++) {
    const opening = t === 0 && ex;
    set('rl', t, a('ebt', t) - a('imp', t));
    set('ar', t, opening ? amount(ab.clientes) : (a('rev', t) * m.dso) / 365);
    set('inv', t, opening ? amount(ab.exist) : (a('cv', t) * m.dio) / 365);
    set('ap', t, opening ? amount(ab.fornec) : ((a('cv', t) + a('fst', t)) * m.dpo) / 365);
    set('nwc', t, a('ar', t) + a('inv', t) - a('ap', t));
    set('dnwc', t, t ? a('nwc', t) - a('nwc', t - 1) : ex ? 0 : a('nwc', t));
  }
}

/** Reserva legal do ano: parte do lucro retida até ao limite sobre o capital; não é distribuível. */
function legalReserveTransfer(
  m: FinancialAssumptions,
  profit: number,
  capital: number,
  reserves: number,
  legal: number,
) {
  if (profit <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      minor((profit * m.reservaLegal) / 100),
      minor((capital * m.reservaLegalLimite) / 100) - legal,
      reserves - legal + profit,
    ),
  );
}

/** Caixa, capital, reservas e dividendos ano a ano; balanço, fluxos de caixa livres e CFADS. */
function cashAndBalance(L: Ledger, taxUPaid: number[]) {
  const { m, H, T, ex, ab, a, set } = L;
  const bookEq = ex
    ? amount(ab.imob) +
      amount(ab.exist) +
      amount(ab.clientes) +
      amount(ab.caixa) -
      amount(ab.fornec) -
      amount(ab.divida)
    : 0;
  let cash = ex ? amount(ab.caixa) : 0,
    capital = bookEq,
    reserves = 0,
    legalReserve = 0;
  const minimumCash = amount(m.caixaMin);
  const dscr = Array<number | null>(T).fill(null);
  let maxCashFlowDifference = 0;
  for (let t = 0; t <= H; t++) {
    const previousCash = cash;
    const taxPayChange = a('taxPay', t) - (t ? a('taxPay', t - 1) : 0);
    set('cfo', t, a('rl', t) + a('da', t) - a('dnwc', t) + taxPayChange);
    set('cfi', t, -a('capex', t));
    const injected = t === 0 && !ex ? amount(m.capitalInicial) : 0;
    let nextCash = cash + a('cfo', t) + a('cfi', t) + a('draw', t) - a('princ', t) + injected;
    legalReserve += legalReserveTransfer(m, a('rl', t), capital, reserves, legalReserve);
    const distributable = Math.max(0, reserves + a('rl', t) - legalReserve);
    const dividend =
      t > 0 && a('rl', t) > 0
        ? Math.max(0, Math.min(minor((a('rl', t) * m.payout) / 100), distributable, nextCash - minimumCash))
        : 0;
    nextCash -= dividend;
    const gap = Math.max(0, minimumCash - nextCash),
      additionalEquity = m.capitalAutomatico ? gap : 0;
    set('unfunded', t, m.capitalAutomatico ? 0 : gap);
    cash = nextCash + additionalEquity;
    capital += injected + additionalEquity;
    reserves += a('rl', t) - dividend;
    set('eqInj', t, injected);
    set('eqAuto', t, additionalEquity);
    set('div', t, dividend);
    set('cff', t, a('draw', t) - a('princ', t) + injected + additionalEquity - dividend);
    set('cash', t, cash);
    set('cap', t, capital);
    set('res', t, reserves);
    set('resLeg', t, legalReserve);
    set('resFree', t, reserves - legalReserve);
    set('dtax', t, taxPayChange);
    set('imobB', t, (t ? a('imobB', t - 1) : ex ? amount(ab.imob) : 0) + a('capex', t));
    set('depAc', t, (t ? a('depAc', t - 1) : 0) + a('da', t));
    set('imob', t, a('imobB', t) - a('depAc', t));
    set('assets', t, a('imob', t) + a('inv', t) + a('ar', t) + cash);
    set('le', t, capital + reserves + a('debt', t) + a('ap', t) + a('taxPay', t));
    set('check', t, a('assets', t) - a('le', t));
    set('fcff', t, a('ebitda', t) - taxUPaid[t]! - a('capex', t) - a('dnwc', t));
    set('fcfe', t, a('cfo', t) + a('cfi', t) + a('draw', t) - a('princ', t));
    set('equityCashFlow', t, dividend - injected - additionalEquity);
    set('cfads', t, a('ebitda', t) - a('taxPaid', t) - a('dnwc', t) - a('capexMan', t));
    if (t > 0 && a('ds', t) > 0) dscr[t] = a('cfads', t) / a('ds', t);
    maxCashFlowDifference = Math.max(
      maxCashFlowDifference,
      Math.abs(cash - previousCash - a('cfo', t) - a('cfi', t) - a('cff', t)),
    );
  }
  return { bookEq, dscr, maxCashFlowDifference };
}

/** Valor terminal, VAL, TIR (projecto e accionista), payback e índice de rendibilidade. */
function valuation(L: Ledger, wacc: number, nextYearTax: boolean) {
  const { m, H, k, a, ex } = L;
  const tv =
    m.tv.metodo === 'gordon'
      ? ((a('fcff', H) / 100) * (1 + m.tv.g / 100)) / (wacc - m.tv.g / 100)
      : m.tv.metodo === 'multiplo'
        ? Math.max(0, (a('ebitda', H) / 100) * m.tv.mult)
        : 0;
  const residual = m.valorResidualLiquido,
    terminalWorkingCapital = m.libertarFundoManeio ? a('nwc', H) / 100 : 0;
  // Projecto finito com imposto pago no ano seguinte: o imposto do último ano ainda é pago.
  const terminalTax = m.tv.metodo === 'nenhum' && nextYearTax ? k.taxU[H]! / 100 : 0;
  const terminal = tv + residual + terminalWorkingCapital - terminalTax;
  const fcff = k.fcff.map(v => v / 100),
    projectFlows = fcff.slice();
  projectFlows[H] = projectFlows[H]! + terminal;
  const equityFlows = k.equityCashFlow.map(v => v / 100);
  const terminalEquityValue = Math.max(
    0,
    terminal + terminalTax + a('cash', H) / 100 - a('debt', H) / 100 - a('taxPay', H) / 100,
  );
  equityFlows[H] = equityFlows[H]! + terminalEquityValue;
  // Empresa existente: avaliação DCF, sem inventar um preço de aquisição para calcular TIR/payback.
  const posPv = financialNpv(
      wacc,
      projectFlows.map(v => Math.max(0, v)),
    ),
    negPv = -financialNpv(
      wacc,
      projectFlows.map(v => Math.min(0, v)),
    );
  const unfundedGap = Math.max(...k.unfunded) / 100;
  return {
    tv,
    residual,
    terminalWorkingCapital,
    projectFlows,
    equityFlows,
    terminalEquityValue,
    projectIrr: financialIrr(projectFlows),
    investorIrr: financialIrr(equityFlows),
    unfundedGap,
    fullyFunded: unfundedGap === 0,
    npv: financialNpv(wacc, projectFlows),
    npvSemTv: financialNpv(wacc, fcff),
    pb: ex ? null : financialPayback(fcff),
    pbD: ex ? null : financialPayback(fcff.map((v, t) => v / (1 + wacc) ** t)),
    pi: negPv > 0 ? posPv / negPv : null,
  };
}
type Valuation = ReturnType<typeof valuation>;

/** DSCR, anos de serviço da dívida, LLCR e capacidade indicativa de endividamento. */
function debtMetrics(L: Ledger, dscr: (number | null)[]) {
  const { m, H, k, a, ex, ab, d, warn } = L;
  const serviceYears = dscr.map((v, t) => (v === null ? -1 : t)).filter(t => t >= 0),
    repY = k.princ.map((v, t) => (v > 0 && t > 0 ? t : -1)).filter(t => t >= 0);
  const ratios = serviceYears.map(t => dscr[t]!);
  const newDebt = d.montante > 0,
    oldDebt = ex && ab.divida > 0;
  let llcr: number | null = null,
    debtCap: number | null = null;
  if (newDebt && oldDebt)
    warn('llcr_multiple_facilities', 'LLCR agregado indisponível: os empréstimos têm taxas e calendários distintos.');
  else if (newDebt || oldDebt) {
    const start = newDebt ? d.ano : 0,
      end = newDebt ? d.ano + d.prazo : ab.divPrazo,
      rate = (newDebt ? d.taxa : ab.divTaxa) / 100;
    if (end <= H) {
      let pv = 0;
      for (let t = start + 1; t <= end; t++) pv += a('cfads', t) / 100 / (1 + rate) ** (t - start);
      llcr = pv / (newDebt ? d.montante : ab.divida);
      if (newDebt) debtCap = Math.max(0, pv / m.cov.dscr);
    } else
      warn(
        'debt_beyond_horizon',
        'O horizonte não cobre o vencimento da dívida; LLCR e capacidade indicativa não são calculados.',
      );
  }
  return {
    dscr,
    serviceYears,
    repY,
    minDscr: ratios.length ? Math.min(...ratios) : null,
    avgDscr: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
    llcr,
    debtCap,
    hasDebt: newDebt || oldDebt,
  };
}

/** Avisos de financiamento, TIR não convencional, valor terminal negativo e juros do desembolso. */
function modelWarnings(L: Ledger, v: Valuation) {
  const { m, k, ex, d, warn } = L;
  if (!v.fullyFunded)
    warn(
      'unfunded',
      'Existem necessidades por financiar. A caixa negativa representa défice de financiamento e a TIR do accionista não é apresentada.',
    );
  if (m.capitalAutomatico && k.eqAuto.some(x => x > 0))
    warn('additional_equity', 'O equilíbrio de caixa exige capital adicional, identificado nos fluxos do accionista.');
  if (v.projectIrr.status === 'non_conventional' && !ex)
    warn(
      'project_irr_non_conventional',
      'A TIR do projecto é omitida: os fluxos mudam de sinal mais de uma vez. Use o VAL para avaliar.',
    );
  if (v.investorIrr.status === 'non_conventional' && !ex && v.fullyFunded)
    warn('equity_irr_non_conventional', 'A TIR do accionista é omitida: os fluxos mudam de sinal mais de uma vez.');
  if (v.tv < 0)
    warn(
      'negative_terminal_value',
      'Gordon produz valor terminal negativo; reveja a viabilidade e o pressuposto de continuidade.',
    );
  if (d.montante > 0 && d.ano === 0 && d.jurosDesembolso > 0)
    warn(
      'initial_interest',
      'Juros do desembolso no ano 0 são pagos no financiamento inicial; DSCR considera os períodos anuais 1 em diante.',
    );
}

/** Múltiplos: EBITDA do primeiro ano em velocidade de cruzeiro (fim da rampa de arranque), ou o ano escolhido. */
function multipleYearOf(L: Ledger) {
  const { m, H, st, ex } = L;
  if (m.mult.ano) return m.mult.ano;
  if (ex) return 1;
  const ends = m.receitas.map(r => {
    const ramp = r.ramp
      .trim()
      .split(/[,;\s]+/)
      .map(v => Number(v));
    let j = ramp.length;
    while (j > 0 && ramp[j - 1]! >= 100) j--;
    return j;
  });
  return Math.min(H, st + Math.max(0, ...ends));
}

type Parts = { ke: number; wacc: number; lines: Record<string, number[]>; qty: number[] } & Valuation &
  ReturnType<typeof debtMetrics> & { bookEq: number; maxCashFlowDifference: number };

/** Junta séries (em kwanzas) e indicadores no resultado do modelo. */
function assembleResult(L: Ledger, p: Parts): FinancialResult {
  const { m, H, T, k, a, ex, ab, scenario, sc } = L;
  const maxBalanceDifference = Math.max(...k.check.map(Math.abs));
  const multipleYear = multipleYearOf(L);
  const netDebt0 = ex ? ab.divida - ab.caixa : 0;
  const notFunded = ex || !p.fullyFunded;
  return {
    engineVersion: FINANCIAL_ENGINE_VERSION,
    H,
    years: Array.from({ length: T }, (_, t) => m.anoBase + t),
    scenario,
    sc: { ...sc },
    k: {
      ...(Object.fromEntries(FINANCIAL_SERIES.map(key => [key, k[key].map(v => v / 100)])) as Record<
        FinancialSeries,
        number[]
      >),
      qty: p.qty,
      dscr: p.dscr,
    },
    lines: Object.fromEntries(Object.entries(p.lines).map(([key, arr]) => [key, arr.map(v => v / 100)])),
    wacc: p.wacc,
    ke: p.ke,
    tv: p.tv,
    pvTv: p.tv / (1 + p.wacc) ** H,
    residual: p.residual,
    terminalWorkingCapital: p.terminalWorkingCapital,
    npv: p.npv,
    npvSemTv: p.npvSemTv,
    valuationFlows: { project: p.projectFlows, equity: notFunded ? null : p.equityFlows },
    terminalEquityValue: p.terminalEquityValue,
    irr: ex ? null : p.projectIrr.value,
    irrEq: notFunded ? null : p.investorIrr.value,
    irrStatus: ex ? 'not_applicable' : p.projectIrr.status,
    irrEqStatus: ex ? 'not_applicable' : !p.fullyFunded ? 'not_funded' : p.investorIrr.status,
    pb: p.pb,
    pbD: p.pbD,
    pbDuration: financialDuration(p.pb),
    pbDDuration: financialDuration(p.pbD),
    pi: p.pi,
    pvCapex: financialNpv(
      p.wacc,
      k.capex.map(v => v / 100),
    ),
    ev: p.npv,
    netDebt0,
    eqVal: p.npv - netDebt0,
    bookEq: p.bookEq / 100,
    fundingGap: m.capitalAutomatico ? k.eqAuto.reduce((s, v) => s + v / 100, 0) : p.unfundedGap,
    unfundedGap: p.unfundedGap,
    fullyFunded: p.fullyFunded,
    totalCapex: k.capexExp.reduce((s, v) => s + v / 100, 0),
    hasDebt: p.hasDebt,
    repY: p.repY,
    serviceYears: p.serviceYears,
    minDscr: p.minDscr,
    avgDscr: p.avgDscr,
    llcr: p.llcr,
    debtCap: p.debtCap,
    ndE: k.ebitda.map((v, t) => (v > 0 ? (a('debt', t) - a('cash', t)) / v : null)),
    icr: k.ebitda.map((v, t) => (a('jur', t) > 0 ? v / a('jur', t) : null)),
    covenants: [],
    multiples: {
      year: m.anoBase + multipleYear,
      yearIndex: multipleYear,
      automatic: !m.mult.ano,
      ebitda: a('ebitda', multipleYear) / 100,
      enterpriseLow: null,
      enterpriseHigh: null,
      equityLow: null,
      equityHigh: null,
    },
    checks: {
      balance: maxBalanceDifference === 0,
      cashFlow: p.maxCashFlowDifference === 0,
      maxBalanceDifference: maxBalanceDifference / 100,
      maxCashFlowDifference: p.maxCashFlowDifference / 100,
    },
    warnings: L.warnings,
  };
}

/** Cumprimento dos covenants por ano e intervalo de valor por múltiplos. */
function addCovenantsAndMultiples(result: FinancialResult, m: FinancialAssumptions) {
  result.covenants = result.years.slice(1).map((year, i) => {
    const t = i + 1,
      dscrValue = result.k.dscr[t],
      leverage = result.ndE[t],
      interestCover = result.icr[t];
    return {
      year,
      dscr: dscrValue == null ? null : dscrValue >= m.cov.dscr,
      ndEbitda: leverage == null ? null : leverage <= m.cov.ndEbitda,
      icr: interestCover == null ? null : interestCover >= m.cov.icr,
    };
  });
  if (result.multiples.ebitda > 0) {
    result.multiples.enterpriseLow = result.multiples.ebitda * m.mult.lo;
    result.multiples.enterpriseHigh = result.multiples.ebitda * m.mult.hi;
    result.multiples.equityLow = result.multiples.enterpriseLow - result.netDebt0;
    result.multiples.equityHigh = result.multiples.enterpriseHigh - result.netDebt0;
  }
}

/** JSON não deve converter silenciosamente Infinity/NaN em null. */
function assertFinite(v: unknown): void {
  if (typeof v === 'number' && !Number.isFinite(v))
    throw new FinancialModelError([{ path: 'calculo', message: 'Resultado não finito; reveja os pressupostos' }]);
  if (Array.isArray(v)) for (const item of v) assertFinite(item);
  else if (v && typeof v === 'object') for (const item of Object.values(v)) assertFinite(item);
}
