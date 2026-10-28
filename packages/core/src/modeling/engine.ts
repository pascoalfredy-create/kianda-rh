import { financialDuration, financialIrr, financialNpv, financialPayback } from './math.js';
import { FINANCIAL_ENGINE_VERSION, FINANCIAL_SERIES, FinancialModelError, type FinancialAssumptions, type FinancialOverrides, type FinancialResult, type FinancialSeries } from './types.js';
import { validateFinancialAssumptions, validateFinancialOverrides } from './validation.js';

/** Os fluxos e demonstrações são construídos em cêntimos inteiros. Taxas, volumes e desconto mantêm precisão fraccionária. */
function minor(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new FinancialModelError([{ path: 'calculo', message: 'Montante fora do intervalo de precisão suportado; reveja valores, crescimento e horizonte' }]);
  return rounded === 0 ? 0 : rounded;
}
const amount = (value: number) => minor(value * 100);

/** Prejuízo do ano t pode ser utilizado nos n anos seguintes; FIFO, sem crédito fiscal de caixa. */
export function financialTaxes(bases: readonly number[], rate: number, years: number): number[] {
  if (bases.some((v) => !Number.isSafeInteger(v)) || !Number.isFinite(rate) || rate < 0 || rate > 1 || !Number.isInteger(years) || years < 0 || years > 20) throw new RangeError('Bases ou parâmetros fiscais inválidos');
  const pool: { remaining: number; expires: number }[] = [];
  return bases.map((base, t) => {
    if (base < 0) { if (years > 0) pool.push({ remaining: -base, expires: t + years }); return 0; }
    let taxable = base;
    for (const loss of pool) {
      if (loss.expires < t || loss.remaining <= 0) continue;
      const used = Math.min(taxable, loss.remaining);
      taxable -= used; loss.remaining -= used;
      if (!taxable) break;
    }
    return minor(taxable * rate);
  });
}

/** Função pura, independente de RH, persistência, browser e apresentação. */
export function runFinancialModel(input: unknown, overrides: FinancialOverrides = {}): FinancialResult {
  const m = validateFinancialAssumptions(input), ov = validateFinancialOverrides(overrides);
  return calculate(m, ov);
}

function calculate(m: FinancialAssumptions, ov: FinancialOverrides): FinancialResult {
  const H = m.horizonte, T = H + 1, zeros = () => Array<number>(T).fill(0);
  const k = Object.fromEntries(FINANCIAL_SERIES.map((key) => [key, zeros()])) as Record<FinancialSeries, number[]>;
  const a = (key: FinancialSeries, t: number) => k[key][t]!;
  const set = (key: FinancialSeries, t: number, v: number) => { k[key][t] = minor(v); };
  const lines: Record<string, number[]> = {}, qty = zeros(), dscr = Array<number | null>(T).fill(null);
  const scenario = ov.cen ?? m.cen, sc = m.cenarios[scenario];
  const pM = sc.preco * (ov.preco ?? 1), vM = sc.volume * (ov.volume ?? 1), cvM = sc.opex * (ov.cvar ?? 1), fM = sc.opex * (ov.fixos ?? 1), kM = sc.capex * (ov.capex ?? 1);
  const ex = m.inicio === 'existente', st = ex ? 1 : m.inicioOp, ab = m.abertura, d = m.divida;
  const warnings: FinancialResult['warnings'] = [];
  const warn = (code: string, message: string) => { warnings.push({ code, message }); };
  const ke = (m.wacc.rf + m.wacc.beta * m.wacc.erp + m.wacc.crp) / 100;
  const wacc = (m.wacc.modo === 'manual' ? m.wacc.manual / 100 : ke * (1 - m.wacc.wd / 100) + m.wacc.kd / 100 * (1 - m.ii / 100) * m.wacc.wd / 100) * (ov.wacc ?? 1);
  if (m.tv.metodo === 'gordon' && wacc - m.tv.g / 100 <= 1e-12) throw new FinancialModelError([{ path: 'tv.g', message: 'O crescimento perpétuo deve ser inferior ao WACC, incluindo no cenário seleccionado' }]);

  for (const [i, r] of m.receitas.entries()) {
    const ramp = r.ramp.trim().split(/[,;\s]+/).map((v) => Number(v) / 100), line = zeros();
    for (let t = st; t <= H; t++) {
      const j = t - st;
      const q = r.qtd * (ex ? 1 : ramp[j] ?? 1) * (1 + r.cresc / 100) ** j * vM;
      if (!Number.isFinite(q)) throw new FinancialModelError([{ path: `receitas.${i}`, message: 'Volume fora do intervalo suportado' }]);
      line[t] = amount(q * r.preco * (1 + r.esc / 100) ** (t - 1) * pM);
      set('rev', t, a('rev', t) + line[t]!);
      if (i === 0) qty[t] = q;
    }
    lines[String(i)] = line;
  }
  for (let t = 1; t <= H; t++) {
    const inflation = (1 + m.inflacao / 100) ** (t - 1), preOp = t >= st ? 1 : m.preOp / 100;
    set('cv', t, a('rev', t) * m.cvar / 100 * cvM);
    set('roy', t, a('rev', t) * m.royalty / 100);
    set('pes', t, amount(m.pessoal * inflation * fM * preOp));
    set('fst', t, amount(m.fst * inflation * fM * preOp));
    set('out', t, amount(m.outros * inflation * fM * preOp));
    set('ebitda', t, a('rev', t) - a('cv', t) - a('roy', t) - a('pes', t) - a('fst', t) - a('out', t));
  }
  const depreciate = (value: number, first: number, life: number) => {
    const annual = minor(value / life);
    let remaining = value;
    for (let t = first; t < first + life && t <= H; t++) {
      const dep = t === first + life - 1 ? remaining : Math.min(annual, remaining);
      set('da', t, a('da', t) + dep); remaining -= dep;
    }
  };
  for (const c of m.capex) {
    const value = amount(c.valor * kM);
    set('capexExp', c.ano, a('capexExp', c.ano) + value);
    depreciate(value, Math.max(c.ano + 1, st), c.vida);
  }
  for (let t = 1; t <= H; t++) {
    set('capexMan', t, a('rev', t) * m.manut / 100 * kM);
    depreciate(a('capexMan', t), t + 1, m.vidaManut);
  }
  if (ex) depreciate(amount(ab.imob), 1, ab.vidaRem);
  for (let t = 0; t <= H; t++) { set('capex', t, a('capexExp', t) + a('capexMan', t)); set('ebit', t, a('ebitda', t) - a('da', t)); }

  let balance = 0, openingDebt = ex ? amount(ab.divida) : 0;
  const principal = amount(d.montante), instalment = minor(principal / Math.max(1, d.prazo - d.carencia));
  const openingInstalment = minor(openingDebt / ab.divPrazo);
  for (let t = 0; t <= H; t++) {
    const draw = t === d.ano ? principal : 0;
    const interest = minor((t === d.ano ? principal * d.jurosDesembolso / 100 : balance) * d.taxa / 100) + (t > 0 ? minor(openingDebt * ab.divTaxa / 100) : 0);
    let repayment = 0;
    if (t > d.ano + d.carencia && t <= d.ano + d.prazo) repayment = t === d.ano + d.prazo ? balance : Math.min(balance, instalment);
    balance += draw - repayment;
    let oldRepayment = 0;
    if (t > 0 && openingDebt > 0) { oldRepayment = t === ab.divPrazo ? openingDebt : Math.min(openingDebt, openingInstalment); openingDebt -= oldRepayment; }
    set('draw', t, draw); set('princ', t, repayment + oldRepayment); set('jur', t, interest); set('debt', t, balance + openingDebt); set('ds', t, a('jur', t) + a('princ', t));
    set('ebt', t, a('ebit', t) - a('jur', t));
  }
  k.imp = financialTaxes(k.ebt, m.ii / 100, m.prejuizosAnos);
  k.taxU = financialTaxes(k.ebit, m.ii / 100, m.prejuizosAnos);
  for (let t = 0; t <= H; t++) {
    set('rl', t, a('ebt', t) - a('imp', t));
    set('ar', t, t === 0 && ex ? amount(ab.clientes) : a('rev', t) * m.dso / 365);
    set('inv', t, t === 0 && ex ? amount(ab.exist) : a('cv', t) * m.dio / 365);
    set('ap', t, t === 0 && ex ? amount(ab.fornec) : (a('cv', t) + a('fst', t)) * m.dpo / 365);
    set('nwc', t, a('ar', t) + a('inv', t) - a('ap', t));
    set('dnwc', t, t ? a('nwc', t) - a('nwc', t - 1) : ex ? 0 : a('nwc', t));
  }
  const bookEq = ex ? amount(ab.imob) + amount(ab.exist) + amount(ab.clientes) + amount(ab.caixa) - amount(ab.fornec) - amount(ab.divida) : 0;
  let cash = ex ? amount(ab.caixa) : 0, capital = bookEq, reserves = 0;
  const minimumCash = amount(m.caixaMin);
  let maxCashFlowDifference = 0;
  for (let t = 0; t <= H; t++) {
    const previousCash = cash;
    set('cfo', t, a('rl', t) + a('da', t) - a('dnwc', t)); set('cfi', t, -a('capex', t));
    const injected = t === 0 && !ex ? amount(m.capitalInicial) : 0;
    let nextCash = cash + a('cfo', t) + a('cfi', t) + a('draw', t) - a('princ', t) + injected;
    const distributable = Math.max(0, reserves + a('rl', t));
    const dividend = t > 0 && a('rl', t) > 0 ? Math.max(0, Math.min(minor(a('rl', t) * m.payout / 100), distributable, nextCash - minimumCash)) : 0;
    nextCash -= dividend;
    const gap = Math.max(0, minimumCash - nextCash), additionalEquity = m.capitalAutomatico ? gap : 0;
    set('unfunded', t, m.capitalAutomatico ? 0 : gap);
    cash = nextCash + additionalEquity; capital += injected + additionalEquity; reserves += a('rl', t) - dividend;
    set('eqInj', t, injected); set('eqAuto', t, additionalEquity); set('div', t, dividend);
    set('cff', t, a('draw', t) - a('princ', t) + injected + additionalEquity - dividend);
    set('cash', t, cash); set('cap', t, capital); set('res', t, reserves);
    set('imobB', t, (t ? a('imobB', t - 1) : ex ? amount(ab.imob) : 0) + a('capex', t));
    set('depAc', t, (t ? a('depAc', t - 1) : 0) + a('da', t));
    set('imob', t, a('imobB', t) - a('depAc', t));
    set('assets', t, a('imob', t) + a('inv', t) + a('ar', t) + cash);
    set('le', t, capital + reserves + a('debt', t) + a('ap', t)); set('check', t, a('assets', t) - a('le', t));
    set('fcff', t, a('ebitda', t) - a('taxU', t) - a('capex', t) - a('dnwc', t));
    set('fcfe', t, a('cfo', t) + a('cfi', t) + a('draw', t) - a('princ', t));
    set('equityCashFlow', t, dividend - injected - additionalEquity);
    set('cfads', t, a('ebitda', t) - a('imp', t) - a('dnwc', t) - a('capexMan', t));
    if (t > 0 && a('ds', t) > 0) dscr[t] = a('cfads', t) / a('ds', t);
    maxCashFlowDifference = Math.max(maxCashFlowDifference, Math.abs(cash - previousCash - a('cfo', t) - a('cfi', t) - a('cff', t)));
  }
  const tv = m.tv.metodo === 'gordon' ? a('fcff', H) / 100 * (1 + m.tv.g / 100) / (wacc - m.tv.g / 100) : m.tv.metodo === 'multiplo' ? Math.max(0, a('ebitda', H) / 100 * m.tv.mult) : 0;
  const residual = m.valorResidualLiquido, terminalWorkingCapital = m.libertarFundoManeio ? a('nwc', H) / 100 : 0;
  const terminal = tv + residual + terminalWorkingCapital;
  const fcff = k.fcff.map((v) => v / 100), projectFlows = fcff.slice(); projectFlows[H] = projectFlows[H]! + terminal;
  const equityFlows = k.equityCashFlow.map((v) => v / 100);
  const terminalEquityValue = Math.max(0, terminal + a('cash', H) / 100 - a('debt', H) / 100);
  equityFlows[H] = equityFlows[H]! + terminalEquityValue;
  // Empresa existente: avaliação DCF, sem inventar um preço de aquisição para calcular TIR/payback.
  const projectIrr = financialIrr(projectFlows), investorIrr = financialIrr(equityFlows);
  const unfundedGap = Math.max(...k.unfunded) / 100, fullyFunded = unfundedGap === 0;
  const npv = financialNpv(wacc, projectFlows), npvSemTv = financialNpv(wacc, fcff), pb = ex ? null : financialPayback(fcff), pbD = ex ? null : financialPayback(fcff.map((v, t) => v / (1 + wacc) ** t));
  const posPv = financialNpv(wacc, projectFlows.map((v) => Math.max(0, v))), negPv = -financialNpv(wacc, projectFlows.map((v) => Math.min(0, v)));
  const serviceYears = dscr.map((v, t) => v === null ? -1 : t).filter((t) => t >= 0), repY = k.princ.map((v, t) => v > 0 && t > 0 ? t : -1).filter((t) => t >= 0);
  const ratios = serviceYears.map((t) => dscr[t]!);
  const newDebt = d.montante > 0, oldDebt = ex && ab.divida > 0;
  let llcr: number | null = null, debtCap: number | null = null;
  if (newDebt && oldDebt) warn('llcr_multiple_facilities', 'LLCR agregado indisponível: os empréstimos têm taxas e calendários distintos.');
  else if (newDebt || oldDebt) {
    const start = newDebt ? d.ano : 0, end = newDebt ? d.ano + d.prazo : ab.divPrazo, rate = (newDebt ? d.taxa : ab.divTaxa) / 100;
    if (end <= H) {
      let pv = 0;
      for (let t = start + 1; t <= end; t++) pv += a('cfads', t) / 100 / (1 + rate) ** (t - start);
      llcr = pv / (newDebt ? d.montante : ab.divida);
      if (newDebt) debtCap = Math.max(0, pv / m.cov.dscr);
    } else warn('debt_beyond_horizon', 'O horizonte não cobre o vencimento da dívida; LLCR e capacidade indicativa não são calculados.');
  }
  if (!fullyFunded) warn('unfunded', 'Existem necessidades por financiar. A caixa negativa representa défice de financiamento e a TIR do accionista não é apresentada.');
  if (m.capitalAutomatico && k.eqAuto.some((v) => v > 0)) warn('additional_equity', 'O equilíbrio de caixa exige capital adicional, identificado nos fluxos do accionista.');
  if (projectIrr.status === 'non_conventional' && !ex) warn('project_irr_non_conventional', 'A TIR do projecto é omitida: os fluxos mudam de sinal mais de uma vez. Use o VAL para avaliar.');
  if (investorIrr.status === 'non_conventional' && !ex && fullyFunded) warn('equity_irr_non_conventional', 'A TIR do accionista é omitida: os fluxos mudam de sinal mais de uma vez.');
  if (tv < 0) warn('negative_terminal_value', 'Gordon produz valor terminal negativo; reveja a viabilidade e o pressuposto de continuidade.');
  if (newDebt && d.ano === 0 && d.jurosDesembolso > 0) warn('initial_interest', 'Juros do desembolso no ano 0 são pagos no financiamento inicial; DSCR considera os períodos anuais 1 em diante.');
  const maxBalanceDifference = Math.max(...k.check.map(Math.abs));
  const result: FinancialResult = {
    engineVersion: FINANCIAL_ENGINE_VERSION, H, years: Array.from({ length: T }, (_, t) => m.anoBase + t), scenario, sc: { ...sc },
    k: { ...Object.fromEntries(FINANCIAL_SERIES.map((key) => [key, k[key].map((v) => v / 100)])) as Record<FinancialSeries, number[]>, qty, dscr },
    lines: Object.fromEntries(Object.entries(lines).map(([key, arr]) => [key, arr.map((v) => v / 100)])),
    wacc, ke, tv, pvTv: tv / (1 + wacc) ** H, residual, terminalWorkingCapital, npv, npvSemTv,
    valuationFlows: { project: projectFlows, equity: ex || !fullyFunded ? null : equityFlows }, terminalEquityValue,
    irr: ex ? null : projectIrr.value, irrEq: ex || !fullyFunded ? null : investorIrr.value, irrStatus: ex ? 'not_applicable' : projectIrr.status, irrEqStatus: ex ? 'not_applicable' : !fullyFunded ? 'not_funded' : investorIrr.status,
    pb, pbD, pbDuration: financialDuration(pb), pbDDuration: financialDuration(pbD), pi: negPv > 0 ? posPv / negPv : null,
    pvCapex: financialNpv(wacc, k.capex.map((v) => v / 100)), ev: npv, netDebt0: ex ? ab.divida - ab.caixa : 0,
    eqVal: npv - (ex ? ab.divida - ab.caixa : 0), bookEq: bookEq / 100,
    fundingGap: m.capitalAutomatico ? k.eqAuto.reduce((s, v) => s + v / 100, 0) : unfundedGap, unfundedGap, fullyFunded, totalCapex: k.capexExp.reduce((s, v) => s + v / 100, 0),
    hasDebt: newDebt || oldDebt, repY, serviceYears, minDscr: ratios.length ? Math.min(...ratios) : null, avgDscr: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
    llcr, debtCap, ndE: k.ebitda.map((v, t) => v > 0 ? (a('debt', t) - a('cash', t)) / v : null), icr: k.ebitda.map((v, t) => a('jur', t) > 0 ? v / a('jur', t) : null),
    checks: { balance: maxBalanceDifference === 0, cashFlow: maxCashFlowDifference === 0, maxBalanceDifference: maxBalanceDifference / 100, maxCashFlowDifference: maxCashFlowDifference / 100 }, warnings,
  };
  // JSON não deve converter silenciosamente Infinity/NaN em null.
  const checkFinite = (v: unknown): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new FinancialModelError([{ path: 'calculo', message: 'Resultado não finito; reveja os pressupostos' }]);
    if (Array.isArray(v)) for (const item of v) checkFinite(item);
    else if (v && typeof v === 'object') for (const item of Object.values(v)) checkFinite(item);
  };
  checkFinite(result);
  return result;
}
