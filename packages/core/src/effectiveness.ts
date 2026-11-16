/**
 * Mapa de efectividade: um código por dia e por colaborador, a partir do resumo diário da assiduidade
 * (marcações, regime ou escala, feriados e ausências aprovadas) e os totais do mês.
 */
import type { DaySummary } from './attendance.js';

export type EffectivenessCode = 'P' | 'FI' | 'FJ' | 'Fé' | 'D' | 'L' | 'Fr' | '·' | 'SR' | '';

/** Legenda pela ordem em que aparece no mapa impresso. */
export const EFFECTIVENESS_LEGEND: readonly (readonly [Exclude<EffectivenessCode, ''>, string])[] = [
  ['P', 'Presente'],
  ['FI', 'Falta injustificada'],
  ['FJ', 'Falta justificada'],
  ['Fé', 'Férias'],
  ['D', 'Doença'],
  ['L', 'Licença (maternidade, paternidade, sem remuneração)'],
  ['Fr', 'Feriado'],
  ['·', 'Descanso'],
  ['SR', 'Sem registo (por regularizar)'],
];

/** Tipo de ausência aprovada → código do mapa. */
export function absenceEffectivenessCode(type: string): EffectivenessCode {
  switch (type) {
    case 'vacation':
      return 'Fé';
    case 'sick':
      return 'D';
    case 'unjustified':
      return 'FI';
    case 'maternity':
    case 'paternity':
    case 'unpaid_leave':
      return 'L';
    default:
      // Justificada, casamento, luto e formação são faltas justificadas.
      return 'FJ';
  }
}

/**
 * Código de um dia. `clockInUse`: a empresa regista ponto neste mês — um dia útil passado sem marcação fica «SR»;
 * sem ponto, presume-se presença salvo ausência aprovada. Dias futuros e fora do contrato ficam em branco.
 */
export function effectivenessDayCode(
  day: Pick<DaySummary, 'date' | 'kind' | 'workedMinutes'>,
  absenceType: string | undefined,
  opts: { today: string; clockInUse: boolean },
): EffectivenessCode {
  const worked = day.workedMinutes > 0;
  switch (day.kind) {
    case 'inactive':
      return '';
    case 'absence':
      return absenceEffectivenessCode(absenceType ?? 'justified');
    case 'holiday':
      return worked ? 'P' : 'Fr';
    case 'rest':
      return worked ? 'P' : '·';
    default:
      if (worked) return 'P';
      if (day.date > opts.today || (day.date === opts.today && opts.clockInUse)) return '';
      return opts.clockInUse ? 'SR' : 'P';
  }
}

export interface EffectivenessTotals {
  /** Dias com presença (inclui descanso e feriados trabalhados). */
  worked: number;
  unjustified: number;
  justified: number;
  vacation: number;
  sick: number;
  leave: number;
  noRecord: number;
}

export function effectivenessTotals(codes: readonly EffectivenessCode[]): EffectivenessTotals {
  const count = (code: EffectivenessCode) => codes.filter(c => c === code).length;
  return {
    worked: count('P'),
    unjustified: count('FI'),
    justified: count('FJ'),
    vacation: count('Fé'),
    sick: count('D'),
    leave: count('L'),
    noRecord: count('SR'),
  };
}
