/**
 * Férias e ausências (LGT, Lei n.º 12/23). Funções puras: direito anual, elegibilidade, dias úteis por ano e saldo.
 * As regras numéricas vêm do pacote do ano (CountryPack.labour / CountryPack.leave).
 */
import { addDays, businessDays } from './calendar.js';
import type { CountryPack } from './packs/types.js';

export type AbsenceType = 'vacation' | 'sick' | 'justified' | 'unjustified' | 'maternity' | 'paternity' | 'marriage' | 'bereavement' | 'training';

export interface AbsencePolicy {
  type: AbsenceType;
  label: string;
  /** Desconta no saldo de férias. */
  deductsVacation: boolean;
  /** Remunerada pela empresa (impacto no processamento — entrega 5). */
  paid: boolean | 'social_security';
  /** O próprio colaborador pode pedir (caso contrário só RH/chefia registam). */
  selfService: boolean;
  /** Exige documento comprovativo (atestado, certidão…). */
  needsProof: boolean;
  /** Limite por ocorrência, a partir do pacote do ano. */
  limit?: (pack: CountryPack) => { workingDays?: number; calendarDays?: number };
  color: string;
}

export const ABSENCE_POLICIES: Record<AbsenceType, AbsencePolicy> = {
  vacation: { type: 'vacation', label: 'Férias', deductsVacation: true, paid: true, selfService: true, needsProof: false, color: '#127a66' },
  sick: { type: 'sick', label: 'Doença', deductsVacation: false, paid: true, selfService: true, needsProof: true, color: '#c2412d' },
  justified: { type: 'justified', label: 'Falta justificada', deductsVacation: false, paid: true, selfService: true, needsProof: true, color: '#b7791f' },
  unjustified: { type: 'unjustified', label: 'Falta injustificada', deductsVacation: false, paid: false, selfService: false, needsProof: false, color: '#5b6170' },
  maternity: {
    type: 'maternity', label: 'Licença de maternidade', deductsVacation: false, paid: 'social_security', selfService: true, needsProof: true, color: '#8a4fc7',
    limit: (p) => ({ calendarDays: p.leave.maternityCalendarDays }),
  },
  paternity: {
    type: 'paternity', label: 'Licença de paternidade', deductsVacation: false, paid: false, selfService: true, needsProof: true, color: '#3f6fd8',
    limit: (p) => ({ workingDays: p.leave.paternityWorkingDays }),
  },
  marriage: {
    type: 'marriage', label: 'Casamento', deductsVacation: false, paid: true, selfService: true, needsProof: true, color: '#d6589a',
    limit: (p) => ({ workingDays: p.leave.marriageWorkingDays }),
  },
  bereavement: {
    type: 'bereavement', label: 'Luto', deductsVacation: false, paid: true, selfService: true, needsProof: true, color: '#3d4452',
    limit: (p) => ({ workingDays: p.leave.bereavementWorkingDays }),
  },
  training: { type: 'training', label: 'Formação', deductsVacation: false, paid: true, selfService: true, needsProof: false, color: '#2a8fb0' },
};

const parse = (d: string) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; return { y, m, day }; };

/** Meses completos de serviço entre a admissão e uma data (inclusive). */
export function fullMonthsBetween(from: string, to: string): number {
  if (to < from) return 0;
  const a = parse(from);
  const b = parse(addDays(to, 1)); // o dia `to` conta como trabalhado
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.day < a.day) months--;
  return Math.max(0, months);
}

/**
 * Dias de férias a que o colaborador tem direito no ano civil.
 * Ano de admissão: `firstYearDaysPerMonth` por mês completo até 31/12 (limitado ao máximo anual). Anos seguintes: máximo anual.
 */
export function vacationEntitlement(hireDate: string, year: number, pack: CountryPack): number {
  const hireYear = Number(hireDate.slice(0, 4));
  if (year < hireYear) return 0;
  const max = pack.labour.vacationWorkingDays;
  if (year > hireYear) return max;
  return Math.min(max, fullMonthsBetween(hireDate, `${year}-12-31`) * pack.leave.firstYearDaysPerMonth);
}

/** Primeiro dia em que pode gozar férias (após os meses mínimos de serviço). */
export function vacationEligibleFrom(hireDate: string, pack: CountryPack): string {
  const { y, m, day } = parse(hireDate);
  const total = m - 1 + pack.leave.vacationMinServiceMonths;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Dias úteis de um período repartidos por ano civil (férias de Dezembro a Janeiro contam em dois saldos). */
export function workingDaysByYear(from: string, to: string, packFor: (year: number) => CountryPack): Record<number, number> {
  const out: Record<number, number> = {};
  const y1 = Number(from.slice(0, 4));
  const y2 = Number(to.slice(0, 4));
  for (let y = y1; y <= y2; y++) {
    const a = y === y1 ? from : `${y}-01-01`;
    const b = y === y2 ? to : `${y}-12-31`;
    out[y] = businessDays(a, b, [packFor(y)]);
  }
  return out;
}

export function calendarDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export interface VacationBalance {
  year: number;
  entitlement: number;
  carriedOver: number;
  taken: number;
  pending: number;
  /** Disponível para novos pedidos = direito + transitados − gozados/aprovados − pendentes. */
  available: number;
}

export function vacationBalance(input: { year: number; entitlement: number; carriedOver?: number; approvedDays: number; pendingDays: number }): VacationBalance {
  const carriedOver = input.carriedOver ?? 0;
  return {
    year: input.year,
    entitlement: input.entitlement,
    carriedOver,
    taken: input.approvedDays,
    pending: input.pendingDays,
    available: input.entitlement + carriedOver - input.approvedDays - input.pendingDays,
  };
}

/** Verifica o limite legal por ocorrência. Devolve a mensagem de erro, ou null. */
export function checkAbsenceLimit(type: AbsenceType, from: string, to: string, workingDays: number, pack: CountryPack): string | null {
  const limit = ABSENCE_POLICIES[type].limit?.(pack);
  if (!limit) return null;
  const label = ABSENCE_POLICIES[type].label;
  if (limit.workingDays !== undefined && workingDays > limit.workingDays) return `${label}: máximo de ${limit.workingDays} dias úteis por ocorrência (pedido: ${workingDays})`;
  const cal = calendarDays(from, to);
  if (limit.calendarDays !== undefined && cal > limit.calendarDays) return `${label}: máximo de ${limit.calendarDays} dias seguidos (pedido: ${cal})`;
  return null;
}
