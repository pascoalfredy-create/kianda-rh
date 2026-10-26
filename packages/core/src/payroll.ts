import { applyBps, assertMinor, prorate, sum, type Minor } from './money.js';
import { getPack, type CountryPack } from './packs/index.js';

export interface EarningInput {
  code: string;
  name: string;
  amountMinor: Minor;
  /** Incide INSS (por defeito sim). */
  inInss?: boolean;
  /** Incide IRT (por defeito sim). */
  inIrt?: boolean;
}

export interface PayrollInput {
  /** Período no formato AAAA-MM. */
  period: string;
  baseMinor: Minor;
  mealMinor?: Minor;
  transportMinor?: Minor;
  otherEarnings?: EarningInput[];
  overtimeHours?: number;
  /** Faltas injustificadas descontadas, em dias. */
  absenceDays?: number;
  advancesMinor?: Minor;
  otherDeductionsMinor?: Minor;
  /** Compensação por falta de aviso prévio do trabalhador, descontada no fecho de contas (não reduz bases). */
  noticeDeductionMinor?: Minor;
  /** Mês incompleto (admissão ou cessação a meio do mês): dias de calendário trabalhados; base e subsídios ÷ 30 × dias. */
  workedDays?: number;
  /** Subsídio de férias: true (por inteiro) ou fracção 0–1 (proporcional, ex.: ano de admissão). */
  holidaySubsidy?: boolean | number;
  /** Subsídio de Natal: true (por inteiro) ou fracção 0–1 (proporcional). */
  christmasSubsidy?: boolean | number;
  /** Permite injectar um pacote (testes ou regras próprias da empresa). */
  pack?: CountryPack;
}

export interface PayrollLine {
  code: string;
  name: string;
  kind: 'earning' | 'deduction' | 'employer';
  amountMinor: Minor;
}

export interface PayrollResult {
  period: string;
  packVersion: string;
  lines: PayrollLine[];
  grossMinor: Minor;
  inssBaseMinor: Minor;
  irtTaxableMinor: Minor;
  irtBracket: number;
  inssEmployeeMinor: Minor;
  irtMinor: Minor;
  netMinor: Minor;
  inssEmployerMinor: Minor;
  totalCostMinor: Minor;
}

/** IRT Grupo A: parcela fixa + (matéria colectável − limite inferior) × taxa marginal. */
export function irtGroupA(taxableMinor: Minor, pack: CountryPack): { amountMinor: Minor; bracket: number } {
  assertMinor(taxableMinor, 'matéria colectável');
  const brackets = pack.irt.brackets;
  const i = brackets.findIndex((br) => taxableMinor <= br[0]);
  const idx = i < 0 ? brackets.length - 1 : i;
  const [, fixed, rate, from] = brackets[idx]!;
  const amountMinor = rate === 0 ? 0 : sum(fixed, applyBps(Math.max(0, taxableMinor - from), rate));
  return { amountMinor, bracket: idx + 1 };
}

/** Valor/hora = salário base × 12 / (52 × horas semanais). */
export function hourlyRateMinor(baseMinor: Minor, pack: CountryPack): Minor {
  return Math.round((baseMinor * 12) / (52 * pack.labour.weeklyHours));
}

export function overtimeMinor(baseMinor: Minor, hours: number, pack: CountryPack): Minor {
  if (hours < 0 || !Number.isFinite(hours)) throw new RangeError('horas extra inválidas');
  const rate = hourlyRateMinor(baseMinor, pack);
  const { tier1MaxHoursPerMonth, tier1Bps, tier2Bps } = pack.labour.overtime;
  const h1 = Math.min(hours, tier1MaxHoursPerMonth);
  const h2 = Math.max(0, hours - tier1MaxHoursPerMonth);
  return Math.round(h1 * rate * (1 + tier1Bps / 10000) + h2 * rate * (1 + tier2Bps / 10000));
}

function periodYear(period: string): number {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new RangeError('período inválido (use AAAA-MM)');
  return Number(m[1]);
}

export class NegativeNetError extends RangeError {
  constructor(public readonly netMinor: Minor) { super('Os descontos excedem a remuneração ilíquida'); this.name = 'NegativeNetError'; }
}

/**
 * Fracção pro rata do ano civil em que o colaborador esteve ao serviço (ano de admissão/cessação).
 * Usada no subsídio de Natal proporcional.
 */
export function yearServiceFraction(year: number, from: string, until?: string | null): number {
  const start = from > `${year}-01-01` ? from : `${year}-01-01`;
  const end = until && until < `${year}-12-31` ? until : `${year}-12-31`;
  if (end < start) return 0;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  const total = (Date.parse(`${year}-12-31T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000 + 1;
  return Math.round((days / total) * 10_000) / 10_000;
}

/** Processamento salarial mensal de um trabalhador (regime Angola, Grupo A). */
export function calculatePayroll(input: PayrollInput): PayrollResult {
  const pack = input.pack ?? getPack('AO', periodYear(input.period));
  const fullBase = assertMinor(input.baseMinor, 'salário base');
  const partial = input.workedDays !== undefined && input.workedDays < pack.labour.dailyRateDivisor;
  const part = (v: Minor) => (partial ? prorate(v, Math.max(0, input.workedDays!), pack.labour.dailyRateDivisor) : v);
  const base = part(fullBase);
  const meal = part(assertMinor(input.mealMinor ?? 0, 'subsídio de alimentação'));
  const transport = part(assertMinor(input.transportMinor ?? 0, 'subsídio de transporte'));
  const lines: PayrollLine[] = [];
  let inssBase = 0;
  let irtBase = 0;

  const earn = (code: string, name: string, amount: Minor, inInss: boolean, inIrt: boolean) => {
    if (!amount) return;
    lines.push({ code, name, kind: 'earning', amountMinor: amount });
    if (inInss) inssBase += amount;
    if (inIrt) irtBase += amount;
  };

  earn('BASE', partial ? `Vencimento base (${input.workedDays} dia(s))` : 'Vencimento base', base, true, true);
  // Alimentação e transporte: fora do INSS; isentos de IRT até ao limite do pacote, cada um.
  const ex = pack.irt.allowanceExemptionMinor;
  if (meal) { lines.push({ code: 'ALIM', name: 'Subsídio de alimentação', kind: 'earning', amountMinor: meal }); irtBase += Math.max(0, meal - ex); }
  if (transport) { lines.push({ code: 'TRANSP', name: 'Subsídio de transporte', kind: 'earning', amountMinor: transport }); irtBase += Math.max(0, transport - ex); }
  for (const o of input.otherEarnings ?? []) earn(o.code, o.name, assertMinor(o.amountMinor, o.name), o.inInss ?? true, o.inIrt ?? true);
  if (input.overtimeHours) earn('HE', `Horas extraordinárias (${input.overtimeHours} h)`, overtimeMinor(fullBase, input.overtimeHours, pack), true, true);
  const subsidy = (flag: boolean | number | undefined, bps: number) => {
    const f = flag === true ? 1 : typeof flag === 'number' ? Math.min(1, Math.max(0, flag)) : 0;
    return { f, amount: f ? Math.round(applyBps(fullBase, bps) * f) : 0 };
  };
  const pct = (f: number) => (f < 1 ? ` (proporcional ${String(Math.round(f * 1000) / 10).replace('.', ',')}%)` : '');
  const sf = subsidy(input.holidaySubsidy, pack.labour.holidaySubsidyBps);
  if (sf.amount) earn('SUBFER', `Subsídio de férias${pct(sf.f)}`, sf.amount, pack.inss.holidaySubsidyInBase, true);
  const sn = subsidy(input.christmasSubsidy, pack.labour.christmasSubsidyBps);
  if (sn.amount) earn('SUBNAT', `Subsídio de Natal${pct(sn.f)}`, sn.amount, pack.inss.christmasSubsidyInBase, true);
  if (input.absenceDays) {
    const v = prorate(fullBase, input.absenceDays, pack.labour.dailyRateDivisor);
    lines.push({ code: 'FALTAS', name: `Faltas (${input.absenceDays} dia(s))`, kind: 'earning', amountMinor: -v });
    inssBase -= v;
    irtBase -= v;
  }

  const gross = sum(...lines.filter((l) => l.kind === 'earning').map((l) => l.amountMinor));
  const inssEmployee = applyBps(Math.max(0, inssBase), pack.inss.employeeBps);
  const inssEmployer = applyBps(Math.max(0, inssBase), pack.inss.employerBps);
  const taxable = Math.max(0, irtBase - inssEmployee);
  const irt = irtGroupA(taxable, pack);
  lines.push({ code: 'INSS', name: `Segurança Social (${pack.inss.employeeBps / 100}%)`, kind: 'deduction', amountMinor: inssEmployee });
  lines.push({ code: 'IRT', name: `IRT Grupo A (escalão ${irt.bracket})`, kind: 'deduction', amountMinor: irt.amountMinor });
  const adv = assertMinor(input.advancesMinor ?? 0);
  const other = assertMinor(input.otherDeductionsMinor ?? 0);
  const notice = assertMinor(input.noticeDeductionMinor ?? 0);
  if (adv) lines.push({ code: 'ADIANT', name: 'Adiantamento salarial', kind: 'deduction', amountMinor: adv });
  if (other) lines.push({ code: 'OUTDESC', name: 'Outros descontos', kind: 'deduction', amountMinor: other });
  if (notice) lines.push({ code: 'AVISODESC', name: 'Falta de aviso prévio do trabalhador', kind: 'deduction', amountMinor: notice });
  lines.push({ code: 'INSS_EMP', name: `INSS entidade empregadora (${pack.inss.employerBps / 100}%)`, kind: 'employer', amountMinor: inssEmployer });

  const net = gross - inssEmployee - irt.amountMinor - adv - other - notice;
  if (net < 0) throw new NegativeNetError(net);
  return {
    period: input.period,
    packVersion: pack.version,
    lines,
    grossMinor: gross,
    inssBaseMinor: Math.max(0, inssBase),
    irtTaxableMinor: taxable,
    irtBracket: irt.bracket,
    inssEmployeeMinor: inssEmployee,
    irtMinor: irt.amountMinor,
    netMinor: net,
    inssEmployerMinor: inssEmployer,
    totalCostMinor: gross + inssEmployer,
  };
}

/** Salário base necessário para um líquido pretendido (pesquisa binária; o líquido é monótono no base). */
export function solveBaseForNet(targetNetMinor: Minor, rest: Omit<PayrollInput, 'baseMinor'>): PayrollResult {
  assertMinor(targetNetMinor);
  let lo = 0;
  let hi = Math.max(targetNetMinor, 100) * 2;
  const net = (b: Minor) => calculatePayroll({ ...rest, baseMinor: b }).netMinor;
  let guard = 0;
  while (net(hi) < targetNetMinor) { hi *= 2; if (++guard > 50) throw new RangeError('líquido fora do intervalo'); }
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (net(mid) < targetNetMinor) lo = mid + 1; else hi = mid; }
  return calculatePayroll({ ...rest, baseMinor: hi });
}

/** Alertas de conformidade salarial. */
export function complianceAlerts(e: { baseMinor: Minor; microOrStartup?: boolean; internship?: boolean }, pack: CountryPack): string[] {
  const out: string[] = [];
  const min = e.microOrStartup ? pack.minimumWage.microStartupMinor : pack.minimumWage.generalMinor;
  if (!e.internship && e.baseMinor < min) out.push('Salário base abaixo do salário mínimo nacional');
  return out;
}
