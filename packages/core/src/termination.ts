import { applyBps, prorate, sum, type Minor } from './money.js';
import type { CountryPack } from './packs/index.js';
import { fullMonthsBetween } from './leave.js';

/**
 * Cessação do contrato de trabalho (Lei Geral do Trabalho, Lei n.º 12/23).
 *
 * O motor propõe o fecho de contas por motivo — aviso prévio, compensação legal, férias e subsídios — com a base de
 * cálculo de cada linha. O RH pode ajustar valores (acordos, regulamento interno) antes de confirmar; as regras
 * numéricas vivem no pacote do ano e estão assinaladas para validação jurídica.
 */

export type TerminationReason =
  | 'resignation' | 'resignation_just_cause' | 'mutual_agreement' | 'fixed_term_expiry' | 'objective_dismissal'
  | 'collective_dismissal' | 'disciplinary_dismissal' | 'probation' | 'retirement' | 'death' | 'employer_extinction';

export const TERMINATION_REASONS: Record<TerminationReason, { label: string; legal: string; notice: 'employee' | 'employer' | null; compensation: 'objective' | 'just_cause' | 'agreed' | 'extinction' | null }> = {
  resignation: { label: 'Denúncia pelo trabalhador (demissão)', legal: 'Art. 305.º — aviso prévio do trabalhador', notice: 'employee', compensation: null },
  resignation_just_cause: { label: 'Rescisão pelo trabalhador com justa causa (despedimento indirecto)', legal: 'Arts. 303.º e 310.º — indemnização de 1 salário base por ano, mínimo de 3', notice: null, compensation: 'just_cause' },
  mutual_agreement: { label: 'Revogação por mútuo acordo', legal: 'Compensação acordada entre as partes', notice: null, compensation: 'agreed' },
  fixed_term_expiry: { label: 'Caducidade do contrato por tempo determinado', legal: 'Art. 17.º, n.º 3 e 4 — aviso de não renovação', notice: 'employer', compensation: null },
  objective_dismissal: { label: 'Despedimento individual por causas objectivas', legal: 'Arts. 284.º a 289.º — aviso prévio e compensação', notice: 'employer', compensation: 'objective' },
  collective_dismissal: { label: 'Despedimento colectivo', legal: 'Arts. 290.º a 295.º — aviso prévio e compensação', notice: 'employer', compensation: 'objective' },
  disciplinary_dismissal: { label: 'Despedimento disciplinar', legal: 'Sem compensação (procedimento disciplinar)', notice: null, compensation: null },
  probation: { label: 'Cessação no período experimental', legal: 'Art. 18.º, n.º 4 — sem aviso nem indemnização', notice: null, compensation: null },
  retirement: { label: 'Caducidade por reforma do trabalhador', legal: 'Caducidade', notice: null, compensation: null },
  death: { label: 'Caducidade por morte do trabalhador', legal: 'Caducidade — créditos pagos aos herdeiros', notice: null, compensation: null },
  employer_extinction: { label: 'Caducidade por morte, reforma, insolvência ou extinção do empregador', legal: 'Arts. 277.º, 278.º e 307.º — compensação de 50% do salário base por ano', notice: null, compensation: 'extinction' },
};

export interface SettlementItem {
  code: 'FERNG' | 'FERPROP' | 'SUBFER' | 'SUBFERPROP' | 'SUBNAT' | 'COMP' | 'COMPEXC' | 'AVISO' | 'AVISODESC' | 'OUTABON' | 'OUTDESC';
  label: string;
  basis: string;
  kind: 'earning' | 'deduction';
  amountMinor: Minor;
  inInss: boolean;
  inIrt: boolean;
}

export const SETTLEMENT_LABEL: Record<SettlementItem['code'], string> = {
  FERNG: 'Férias vencidas e não gozadas', FERPROP: 'Férias proporcionais ao tempo de serviço no ano da cessação',
  SUBFER: 'Subsídio de férias do ano', SUBFERPROP: 'Subsídio de férias proporcional', SUBNAT: 'Subsídio de Natal proporcional',
  COMP: 'Compensação por cessação', COMPEXC: 'Compensação acordada acima do valor legal', AVISO: 'Compensação por falta de aviso prévio',
  AVISODESC: 'Falta de aviso prévio do trabalhador', OUTABON: 'Outro abono', OUTDESC: 'Outro desconto',
};

export interface TerminationInput {
  reason: TerminationReason;
  /** Início da antiguidade (primeiro contrato). */
  hireDate: string;
  /** Último dia de trabalho (data de efeito). */
  effectiveDate: string;
  /** Data da comunicação escrita (aviso prévio); vazio = sem aviso. */
  noticeDate?: string | null;
  baseMinor: Minor;
  /** Dias úteis de férias já vencidos e ainda não gozados no ano da cessação (saldo). */
  vacationUnusedDays: number;
  holidaySubsidyPaidThisYear: boolean;
  christmasSubsidyPaidThisYear: boolean;
  /** Mútuo acordo: valor global da compensação acordada. Noutros motivos, acima do legal = excesso tributado. */
  agreedCompensationMinor?: Minor | null;
  pack: CountryPack;
}

export interface TerminationProposal {
  seniority: { years: number; months: number; days: number; label: string };
  notice: { requiredDays: number; givenDays: number; missingDays: number; by: 'employee' | 'employer' | null };
  legalCompensationMinor: Minor;
  items: SettlementItem[];
  notes: string[];
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Antiguidade em anos, meses e dias completos entre o início e a data de efeito (inclusive). */
export function seniority(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY); // dia seguinte ao último dia
  let y = end.getUTCFullYear() - fy;
  let m = end.getUTCMonth() + 1 - fm;
  let d = end.getUTCDate() - fd;
  if (d < 0) { m -= 1; d += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  const parts = [y ? `${y} ano(s)` : '', m ? `${m} mês(es)` : '', d ? `${d} dia(s)` : ''].filter(Boolean);
  return { years: Math.max(0, y), months: Math.max(0, m), days: Math.max(0, d), label: parts.join(', ') || '0 dias' };
}

/** Anos de antiguidade para compensações: fracção igual ou superior a 3 meses conta como um ano (art. 311.º). */
export function compensationYears(sen: { years: number; months: number }, pack: CountryPack): number {
  return sen.years + (sen.months >= pack.termination.seniorityFractionMonths ? 1 : 0);
}

/** Compensação legal por despedimento por causas objectivas/colectivo: 1 base por ano até N anos, depois a percentagem do pacote (art. 308.º). */
export function objectiveCompensation(baseMinor: Minor, years: number, pack: CountryPack): Minor {
  const t = pack.termination;
  const full = Math.min(years, t.compensationFullYears);
  const extra = Math.max(0, years - t.compensationFullYears);
  return baseMinor * full + applyBps(baseMinor, t.compensationExtraYearBps) * extra;
}

export function terminationProposal(i: TerminationInput): TerminationProposal {
  const { pack } = i;
  const def = TERMINATION_REASONS[i.reason];
  const sen = seniority(i.hireDate, i.effectiveDate);
  const notes: string[] = [];
  const items: SettlementItem[] = [];
  const add = (code: SettlementItem['code'], basis: string, amountMinor: Minor, kind: SettlementItem['kind'], inInss: boolean, inIrt: boolean) => {
    if (amountMinor > 0) items.push({ code, label: SETTLEMENT_LABEL[code], basis, kind, amountMinor, inInss, inIrt });
  };
  const year = Number(i.effectiveDate.slice(0, 4));
  const daily = (days: number) => prorate(i.baseMinor, days, pack.labour.vacationWorkingDays);
  const kz = (m: Minor) => (m / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Férias e subsídios
  if (i.vacationUnusedDays > 0) add('FERNG', `${i.vacationUnusedDays} dia(s) úteis × base/${pack.labour.vacationWorkingDays}`, daily(i.vacationUnusedDays), 'earning', true, true);
  const yearStart = `${year}-01-01`;
  const hiredThisYear = i.hireDate >= yearStart;
  const monthsThisYear = fullMonthsBetween(hiredThisYear ? i.hireDate : yearStart, i.effectiveDate);
  if (!hiredThisYear && i.reason !== 'probation') {
    const propDays = Math.min(pack.labour.vacationWorkingDays, monthsThisYear * pack.leave.firstYearDaysPerMonth);
    add('FERPROP', `${monthsThisYear} mês(es) completo(s) × ${pack.leave.firstYearDaysPerMonth} dias = ${propDays} dia(s) × base/${pack.labour.vacationWorkingDays}`, daily(propDays), 'earning', true, true);
    add('SUBFERPROP', `${pack.labour.holidaySubsidyBps / 100}% da base × ${propDays}/${pack.labour.vacationWorkingDays}`, prorate(applyBps(i.baseMinor, pack.labour.holidaySubsidyBps), propDays, pack.labour.vacationWorkingDays), 'earning', pack.inss.holidaySubsidyInBase, true);
  }
  if (!i.holidaySubsidyPaidThisYear) {
    // Subsídio das férias do ano (vencidas a 1 de Janeiro, ou proporcionais no ano de admissão).
    const ent = hiredThisYear ? Math.min(pack.labour.vacationWorkingDays, monthsThisYear * pack.leave.firstYearDaysPerMonth) : pack.labour.vacationWorkingDays;
    add('SUBFER', `${pack.labour.holidaySubsidyBps / 100}% da base × ${ent}/${pack.labour.vacationWorkingDays} (não pago em ${year})`, prorate(applyBps(i.baseMinor, pack.labour.holidaySubsidyBps), ent, pack.labour.vacationWorkingDays), 'earning', pack.inss.holidaySubsidyInBase, true);
  }
  if (!i.christmasSubsidyPaidThisYear) {
    // Art. 238.º, n.º 3: proporcional aos meses completos trabalhados no ano.
    add('SUBNAT', `${pack.labour.christmasSubsidyBps / 100}% da base × ${monthsThisYear}/12 meses completos`, prorate(applyBps(i.baseMinor, pack.labour.christmasSubsidyBps), monthsThisYear, 12), 'earning', pack.inss.christmasSubsidyInBase, true);
  }

  // Aviso prévio
  const t = pack.termination;
  const required = i.reason === 'resignation' ? t.resignationNoticeDays
    : i.reason === 'objective_dismissal' ? t.objectiveDismissalNoticeDays
      : i.reason === 'collective_dismissal' ? t.collectiveDismissalNoticeDays
        : i.reason === 'fixed_term_expiry' ? t.fixedTermNoticeDays : 0;
  const given = i.noticeDate && i.noticeDate <= i.effectiveDate ? daysBetween(i.noticeDate, i.effectiveDate) : 0;
  const missing = Math.max(0, required - given);
  if (missing > 0 && def.notice === 'employee') {
    add('AVISODESC', `${missing} dia(s) de aviso em falta × base/${pack.labour.dailyRateDivisor}`, prorate(i.baseMinor, missing, pack.labour.dailyRateDivisor), 'deduction', false, false);
    notes.push(`O trabalhador deu ${given} de ${required} dias de aviso prévio: a falta é descontada no fecho de contas (pode ser dispensada pela empresa).`);
  } else if (missing > 0 && def.notice === 'employer') {
    const days = i.reason === 'fixed_term_expiry' ? t.fixedTermMissingNoticeDays : missing;
    add('AVISO', i.reason === 'fixed_term_expiry' ? `Aviso de não renovação em falta: ${days} dias × base/${pack.labour.dailyRateDivisor}` : `${missing} dia(s) de aviso em falta × base/${pack.labour.dailyRateDivisor}`,
      prorate(i.baseMinor, days, pack.labour.dailyRateDivisor), 'earning', false, false);
    notes.push(`A empresa deu ${given} de ${required} dias de aviso prévio: a falta é paga como compensação.`);
  }

  // Compensação legal
  let legal = 0;
  const years = compensationYears(sen, pack);
  const yearsNote = years !== sen.years ? ` (${sen.label}: fracção ≥ ${t.seniorityFractionMonths} meses conta 1 ano, art. 311.º)` : '';
  if (def.compensation === 'objective') {
    legal = objectiveCompensation(i.baseMinor, years, pack);
    const over = Math.max(0, years - t.compensationFullYears);
    add('COMP', `Base ${kz(i.baseMinor)} × ${Math.min(years, t.compensationFullYears)} ano(s)${over ? ` + ${t.compensationExtraYearBps / 100}% × ${over} ano(s)` : ''}${yearsNote}`, legal, 'earning', false, false);
    if (!years) notes.push(`Antiguidade inferior a ${t.seniorityFractionMonths} meses: sem compensação (art. 311.º).`);
  } else if (def.compensation === 'just_cause') {
    const byYears = Math.round(applyBps(i.baseMinor, t.justCauseYearBps) * years);
    const min = i.baseMinor * t.justCauseMinBaseSalaries;
    legal = Math.max(byYears, min);
    add('COMP', byYears >= min ? `Base ${kz(i.baseMinor)} × ${years} ano(s) de antiguidade${yearsNote}` : `Mínimo legal de ${t.justCauseMinBaseSalaries} salários base (art. 310.º, n.º 3)`, legal, 'earning', false, false);
  } else if (def.compensation === 'extinction') {
    legal = Math.round(applyBps(i.baseMinor, t.employerExtinctionYearBps) * years);
    add('COMP', `${t.employerExtinctionYearBps / 100}% da base ${kz(i.baseMinor)} × ${years} ano(s) (art. 307.º)${yearsNote}`, legal, 'earning', false, false);
  }
  const agreed = i.agreedCompensationMinor ?? 0;
  if (def.compensation === 'agreed' && agreed > 0) {
    // No mútuo acordo, a parte até ao valor que seria devido num despedimento por causas objectivas fica isenta (a validar).
    const ref = objectiveCompensation(i.baseMinor, years, pack);
    add('COMP', `Acordada, até à referência legal de ${kz(ref)}`, Math.min(agreed, ref), 'earning', false, false);
    add('COMPEXC', `Acordada acima da referência legal`, Math.max(0, agreed - ref), 'earning', false, true);
    legal = Math.min(agreed, ref);
  } else if (agreed > legal) {
    add('COMPEXC', `Acordada ${kz(agreed)} − legal ${kz(legal)}`, agreed - legal, 'earning', false, true);
  }

  if (i.reason === 'probation' && sen.years === 0 && sen.months * 30 + sen.days > pack.labour.probationDaysIndefinite) {
    notes.push(`Atenção: o período experimental por omissão é de ${pack.labour.probationDaysIndefinite} dias — confirme que o contrato previa um período mais longo.`);
  }
  if (i.reason === 'death') notes.push('Os créditos são pagos aos herdeiros, mediante habilitação.');
  if (i.reason === 'objective_dismissal' || i.reason === 'collective_dismissal') {
    notes.push(`Durante o aviso prévio o trabalhador tem ${t.noticeJobSearchDays} dias de dispensa remunerada para procurar emprego, se os motivos não forem económicos (art. 287.º). A compensação e os créditos têm de estar à disposição até ao fim do aviso (art. 288.º, n.º 2).`);
  }
  if (i.reason === 'mutual_agreement') notes.push('O acordo é escrito, em duplicado, com a data de efeito e a data de pagamento da compensação (art. 280.º).');
  notes.push(`Prazo de pagamento do fecho de contas: ${t.settlementPaymentDays} dias após a cessação (art. 245.º, n.º 4).`);
  return { seniority: sen, notice: { requiredDays: required, givenDays: Math.min(given, required || given), missingDays: missing, by: def.notice }, legalCompensationMinor: legal, items, notes };
}

export const settlementTotals = (items: SettlementItem[]) => ({
  earningsMinor: sum(...items.filter((x) => x.kind === 'earning').map((x) => x.amountMinor)),
  deductionsMinor: sum(...items.filter((x) => x.kind === 'deduction').map((x) => x.amountMinor)),
});

// ——— Compatibilidade (protótipo) ———
export interface SettlementInput {
  terminationDate: string;
  baseMinor: Minor;
  monthlyAllowancesMinor: Minor;
  unusedVacationDays: number;
  compensationMinor?: Minor;
  holidaySubsidyAlreadyPaid?: boolean;
}
export interface SettlementLine { code: string; name: string; basis: string; amountMinor: Minor }
/** @deprecated substituída por terminationProposal (usada só pelos testes do protótipo). */
export function finalSettlement(input: SettlementInput, pack: CountryPack): { lines: SettlementLine[]; totalMinor: Minor } {
  const month = Number(input.terminationDate.slice(5, 7));
  const lines: SettlementLine[] = [
    { code: 'SAL', name: 'Remuneração do mês da cessação', basis: 'Base + subsídios', amountMinor: input.baseMinor + input.monthlyAllowancesMinor },
    { code: 'FER', name: 'Férias vencidas e não gozadas', basis: `${input.unusedVacationDays} dia(s) úteis × base/22`, amountMinor: prorate(input.baseMinor, input.unusedVacationDays, 22) },
  ];
  if (!input.holidaySubsidyAlreadyPaid) lines.push({ code: 'SUBFER', name: 'Subsídio de férias proporcional', basis: '', amountMinor: prorate(applyBps(input.baseMinor, pack.labour.holidaySubsidyBps), month, 12) });
  lines.push({ code: 'SUBNAT', name: 'Subsídio de Natal proporcional', basis: '', amountMinor: prorate(applyBps(input.baseMinor, pack.labour.christmasSubsidyBps), month, 12) });
  if (input.compensationMinor) lines.push({ code: 'COMP', name: 'Compensação', basis: 'Acordada / apurada', amountMinor: input.compensationMinor });
  return { lines, totalMinor: sum(...lines.map((l) => l.amountMinor)) };
}
