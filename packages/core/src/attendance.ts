/**
 * Assiduidade: datas e horas de Luanda (UTC+1, sem horário de verão), resumo diário e mensal,
 * horas extra a partir dos registos de entrada/saída.
 * As regras de pagamento das horas extra estão no pacote do ano (labour.overtime) e são aplicadas no processamento.
 */
import { isWeekend } from './calendar.js';
import type { Holiday } from './packs/types.js';

const LUANDA_OFFSET_MS = 60 * 60 * 1000;

/** Data civil em Luanda (AAAA-MM-DD) de um instante. */
export function luandaDate(d: Date): string {
  return new Date(d.getTime() + LUANDA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hora em Luanda (HH:MM) de um instante. */
export function luandaTime(d: Date): string {
  return new Date(d.getTime() + LUANDA_OFFSET_MS).toISOString().slice(11, 16);
}

/** Instante correspondente a uma data e hora de Luanda. */
export function fromLuanda(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('data ou hora inválida');
  return new Date(Date.parse(`${date}T${time}:00Z`) - LUANDA_OFFSET_MS);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? '-' : '';
  const m = Math.abs(Math.round(min));
  return `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export interface Punch { clockIn: Date; clockOut: Date | null }

/**
 * Arredondamento do trabalho extraordinário (LGT, art. 188.º, n.º 4): fracções < 15 min não contam;
 * de 15 a 44 min contam meia hora; de 45 a 60 min contam uma hora.
 */
export function roundOvertimeMinutes(raw: number): number {
  if (raw <= 0) return 0;
  const hours = Math.floor(raw / 60);
  const rest = raw % 60;
  return hours * 60 + (rest < 15 ? 0 : rest < 45 ? 30 : 60);
}

export type DayFlag = 'open' | 'not_employed' | 'no_record' | 'rest_day_work' | 'holiday_work' | 'absence_work' | 'over_2h';

export interface DaySummary {
  date: string;
  kind: 'workday' | 'rest' | 'holiday' | 'absence' | 'inactive';
  holiday?: string;
  absence?: string;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  /** Dia de descanso trabalhado: minutos a pagar com o adicional do art. 194.º (mínimo de 3 h). */
  restDayPaidMinutes: number;
  flags: DayFlag[];
}

export const DAY_FLAG_LABEL: Record<DayFlag, string> = {
  open: 'Saída por registar',
  not_employed: 'Registo fora do período de contrato',
  no_record: 'Sem registo (dia útil)',
  rest_day_work: 'Trabalho em dia de descanso',
  holiday_work: 'Trabalho em feriado',
  absence_work: 'Registo num dia de ausência',
  over_2h: 'Mais de 2 h extra no dia',
};

/**
 * Resumo de um dia.
 * - Dia útil: previsto = jornada; extra = trabalhado − previsto (se positivo).
 * - Descanso, feriado ou ausência aprovada: previsto = 0; todo o trabalho conta como extra (e é assinalado para o RH).
 * - Registos abertos (sem saída) não contam horas até serem corrigidos.
 */
export function summarizeDay(input: {
  date: string;
  punches: Punch[];
  dailyMinutes: number;
  holiday?: string;
  absence?: string;
  /** Dias ainda por acontecer não geram "sem registo". */
  today: string;
  /** Fora do contrato (antes da admissão ou depois da cessação): nada previsto, nada em falta. */
  inactive?: boolean;
  /** Só para simulações: blocos fixos (minutos) em vez do arredondamento legal do art. 188.º, n.º 4. */
  overtimeBlockMinutes?: number;
  /** Mínimo pago por dia de descanso trabalhado (art. 194.º): 180 min por omissão. */
  restDayMinMinutes?: number;
  /** Regime de horário do colaborador: minutos previstos neste dia (0 = descanso). Sem regime: dias úteis × jornada. */
  scheduledMinutes?: number;
}): DaySummary {
  const { date, punches, holiday, absence, today, inactive } = input;
  const scheduled = input.scheduledMinutes;
  const dailyMinutes = scheduled !== undefined ? scheduled : input.dailyMinutes;
  const restDay = scheduled !== undefined ? scheduled === 0 : isWeekend(date);
  const block = input.overtimeBlockMinutes;
  const kind: DaySummary['kind'] = inactive ? 'inactive' : holiday ? 'holiday' : restDay ? 'rest' : absence ? 'absence' : 'workday';
  const closed = punches.filter((p) => p.clockOut);
  const worked = closed.reduce((s, p) => s + minutesBetween(p.clockIn, p.clockOut!), 0);
  const expected = kind === 'workday' && date <= today ? dailyMinutes : 0;
  const rawOvertime = kind === 'workday' ? Math.max(0, worked - dailyMinutes) : worked;
  const overtime = block === undefined ? roundOvertimeMinutes(rawOvertime) : block > 1 ? Math.floor(rawOvertime / block) * block : rawOvertime;
  const restDayPaidMinutes = kind === 'rest' && overtime > 0 ? Math.max(overtime, input.restDayMinMinutes ?? 180) : 0;
  const flags: DayFlag[] = [];
  // Saída por registar só é pendência a partir do dia seguinte (hoje o colaborador ainda pode estar em serviço).
  if (punches.some((p) => !p.clockOut) && date < today) flags.push('open');
  if (worked > 0 && kind === 'inactive') flags.push('not_employed');
  if (kind === 'workday' && !punches.length && date < today) flags.push('no_record');
  if (worked > 0 && kind === 'rest') flags.push('rest_day_work');
  if (worked > 0 && kind === 'holiday') flags.push('holiday_work');
  if (worked > 0 && kind === 'absence') flags.push('absence_work');
  if (kind === 'workday' && overtime > 120) flags.push('over_2h');
  return { date, kind, holiday, absence, workedMinutes: worked, expectedMinutes: expected, overtimeMinutes: overtime, restDayPaidMinutes, flags };
}

export interface MonthSummary {
  period: string;
  days: DaySummary[];
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  /** Horas extra em dias de descanso/feriado (subconjunto de overtimeMinutes). */
  restOrHolidayOvertimeMinutes: number;
  /** Extra em dias normais de trabalho (pago a +50%/+75%, art. 188.º). */
  workdayOvertimeMinutes: number;
  /** Dias de descanso trabalhados: minutos a pagar a +75%, com mínimo de 3 h por dia (art. 194.º). */
  restDayPaidMinutes: number;
  /** Feriados trabalhados (fora de turnos): cada um dá direito a mais um dia de salário (art. 200.º). */
  holidayWorkDays: number;
  openDays: number;
  noRecordDays: number;
}

export function summarizeMonth(input: {
  period: string;
  punches: (Punch & { workDate: string })[];
  dailyMinutes: number;
  holidays: readonly Holiday[];
  /** Ausências aprovadas por data (AAAA-MM-DD → rótulo). */
  absences: Record<string, string>;
  today: string;
  /** Período de contrato (admissão e, se existir, cessação). */
  employedFrom?: string | null;
  employedUntil?: string | null;
  overtimeBlockMinutes?: number;
  /** Regime de horário: minutos previstos por data (0 = descanso). */
  schedule?: (date: string) => number;
  /** Turnos (art. 200.º, n.º 3): os feriados seguem a escala (sem o acréscimo de feriado). */
  shiftRegime?: boolean;
  /** 24 e 31 de Dezembro: minutos previstos até à paragem das 12h30 (art. 199.º); não se aplica a turnos/laboração contínua. */
  familyEveMinutes?: number;
}): MonthSummary {
  const [y, m] = input.period.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hol = new Map(input.holidays.map((h) => [h.date, h.name]));
  const days: DaySummary[] = [];
  for (let d = 1; d <= n; d++) {
    const date = `${input.period}-${String(d).padStart(2, '0')}`;
    days.push(summarizeDay({
      date, punches: input.punches.filter((p) => p.workDate === date), dailyMinutes: input.dailyMinutes,
      holiday: input.shiftRegime ? undefined : hol.get(date), absence: input.absences[date], today: input.today,
      overtimeBlockMinutes: input.overtimeBlockMinutes,
      scheduledMinutes: (() => {
        const sched = input.schedule?.(date);
        const eve = !input.shiftRegime && input.familyEveMinutes !== undefined && /-12-(24|31)$/.test(date);
        if (!eve) return sched;
        const normal = sched ?? (isWeekend(date) ? 0 : input.dailyMinutes);
        return Math.min(normal, input.familyEveMinutes!);
      })(),
      inactive: (!!input.employedFrom && date < input.employedFrom) || (!!input.employedUntil && date > input.employedUntil),
    }));
  }
  const sum = (f: (d: DaySummary) => number) => days.reduce((s, d) => s + f(d), 0);
  return {
    period: input.period,
    days,
    workedMinutes: sum((d) => d.workedMinutes),
    expectedMinutes: sum((d) => d.expectedMinutes),
    overtimeMinutes: sum((d) => d.overtimeMinutes),
    restOrHolidayOvertimeMinutes: sum((d) => (d.kind === 'rest' || d.kind === 'holiday' ? d.overtimeMinutes : 0)),
    workdayOvertimeMinutes: sum((d) => (d.kind === 'workday' ? d.overtimeMinutes : 0)),
    restDayPaidMinutes: sum((d) => d.restDayPaidMinutes),
    holidayWorkDays: days.filter((d) => d.kind === 'holiday' && d.workedMinutes > 0).length,
    openDays: days.filter((d) => d.flags.includes('open')).length,
    noRecordDays: days.filter((d) => d.flags.includes('no_record')).length,
  };
}

/** Horas extra (decimais, 2 casas) para o processamento a partir de minutos aprovados. */
export function overtimeHoursFromMinutes(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}
