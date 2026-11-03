import { addDays, daysBetween } from './calendar.js';

/**
 * Planeamento de turnos: tipos de turno da empresa, escala por colaborador e dia, padrões de rotação e verificações.
 *
 * Funções puras — usadas pela API (validação, publicação, ponto) e pela interface (pré-visualização dos padrões).
 * Datas em AAAA-MM-DD e horas em HH:MM, sempre na hora de Luanda. Um turno pertence ao dia em que começa.
 */

export const SHIFT_COLORS = ['blue', 'green', 'amber', 'violet', 'red', 'teal', 'slate'] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];
export const SHIFT_COLOR_LABEL: Record<ShiftColor, string> = { blue: 'Azul', green: 'Verde', amber: 'Âmbar', violet: 'Violeta', red: 'Vermelho', teal: 'Turquesa', slate: 'Cinzento' };

/** Limites da escala. */
export const SHIFT_RANGE_MAX_DAYS = 42;
export const SHIFT_BATCH_MAX = 3000;
export const SHIFT_CODE_PATTERN = /^[A-Z0-9]{1,3}$/;
/** Intervalo mínimo entre turnos por omissão (a empresa ajusta). */
export const DEFAULT_SHIFT_MIN_REST_MINUTES = 600;
/** Código reservado para folga nos padrões e na exportação. */
export const OFF_CODE = 'F';

export interface ShiftTypeLike { code: string; name: string; startTime: string; endTime: string; breakMinutes: number; minStaff?: number | null }

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = 86_400_000;
export const minutesOfDay = (t: string): number => {
  const m = TIME.exec(t);
  if (!m) throw new Error(`Hora inválida: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
const dayIndex = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

/** Datas de um intervalo inclusive. */
export function dateRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Duração do turno no local (minutos), atravessando a meia-noite quando a saída é anterior à entrada. */
export function shiftSpanMinutes(t: Pick<ShiftTypeLike, 'startTime' | 'endTime'>): number {
  const s = minutesOfDay(t.startTime), e = minutesOfDay(t.endTime);
  return e > s ? e - s : e + 1440 - s;
}

/** Tempo de trabalho previsto: duração menos o intervalo de refeição/descanso. */
export function shiftWorkMinutes(t: Pick<ShiftTypeLike, 'startTime' | 'endTime' | 'breakMinutes'>): number {
  return Math.max(0, shiftSpanMinutes(t) - t.breakMinutes);
}

export const crossesMidnight = (t: Pick<ShiftTypeLike, 'startTime' | 'endTime'>) => minutesOfDay(t.endTime) <= minutesOfDay(t.startTime);

/** Minutos do turno entre as 20h e as 6h (sem descontar o intervalo). */
export function shiftNightMinutes(t: Pick<ShiftTypeLike, 'startTime' | 'endTime'>): number {
  const s = minutesOfDay(t.startTime), e = s + shiftSpanMinutes(t);
  let n = 0;
  for (let k = -1; k <= 1; k++) {
    const a = k * 1440 + 20 * 60, b = k * 1440 + 30 * 60;
    n += Math.max(0, Math.min(e, b) - Math.max(s, a));
  }
  return n;
}

/** Turno nocturno: pelo menos 3 horas entre as 20h e as 6h. */
export const isNightShift = (t: Pick<ShiftTypeLike, 'startTime' | 'endTime'>) => shiftNightMinutes(t) >= 180;

/** Problemas de um tipo de turno (para gravar). */
export function shiftTypeIssue(t: ShiftTypeLike): string | null {
  if (!SHIFT_CODE_PATTERN.test(t.code)) return 'O código tem 1 a 3 letras maiúsculas ou algarismos';
  if (t.code === OFF_CODE) return `O código ${OFF_CODE} está reservado para a folga`;
  if (!t.name.trim()) return 'Indique o nome do turno';
  if (!TIME.test(t.startTime) || !TIME.test(t.endTime)) return 'Horas no formato HH:MM';
  if (t.startTime === t.endTime) return 'A entrada e a saída não podem ser à mesma hora';
  if (!Number.isInteger(t.breakMinutes) || t.breakMinutes < 0 || t.breakMinutes > 240) return 'O intervalo tem entre 0 e 240 minutos';
  if (shiftWorkMinutes(t) < 60) return 'O turno tem de ter pelo menos 1 hora de trabalho';
  if (t.minStaff != null && (!Number.isInteger(t.minStaff) || t.minStaff < 0 || t.minStaff > 500)) return 'O mínimo de pessoas está entre 0 e 500';
  return null;
}

export const formatShiftHours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
export const shiftLabel = (t: Pick<ShiftTypeLike, 'startTime' | 'endTime'>) => `${t.startTime}–${t.endTime}`;

// ───────────────────────── Padrões de rotação ─────────────────────────

/**
 * Lê um padrão escrito pelo utilizador: códigos separados por espaços ou vírgulas, F = folga,
 * repetição com «×» ou «x» (ex.: «M×2 T×2 N×2 F×2» ou «M M T T N N F F»).
 */
export function parsePattern(text: string, codes: readonly string[]): { sequence: (string | null)[]; error: string | null } {
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const sequence: (string | null)[] = [];
  const known = new Set(codes);
  for (const token of tokens) {
    // Um código conhecido vale por si (ex.: «X2»); senão lê «código×repetições».
    const m = known.has(token) ? [token, token] : /^([A-Z0-9]{1,3}?)(?:[×X\*](\d{1,2}))?$/.exec(token);
    if (!m) return { sequence: [], error: `Elemento inválido: «${token}»` };
    const code = m[1]!, times = m[2] ? Number(m[2]) : 1;
    if (code !== OFF_CODE && !known.has(code)) return { sequence: [], error: `Turno desconhecido: «${code}»` };
    if (times < 1) return { sequence: [], error: `Repetição inválida: «${token}»` };
    for (let i = 0; i < times; i++) sequence.push(code === OFF_CODE ? null : code);
  }
  if (!sequence.length) return { sequence: [], error: 'Escreva o padrão, por exemplo «M M T T N N F F»' };
  if (sequence.length > 120) return { sequence: [], error: 'O padrão tem no máximo 120 dias' };
  if (sequence.every((s) => s === null)) return { sequence: [], error: 'O padrão não tem nenhum turno' };
  return { sequence, error: null };
}

export interface PatternCell { employeeId: string; date: string; code: string | null }

/**
 * Aplica um padrão a vários colaboradores num intervalo. `stagger` desfasa cada colaborador seguinte
 * (ex.: 2 → equipas que começam o ciclo dois dias depois umas das outras); `skip` evita dias já preenchidos.
 */
export function applyPattern(input: {
  employeeIds: readonly string[]; from: string; to: string; sequence: readonly (string | null)[];
  stagger?: number; startOffset?: number; skip?: (employeeId: string, date: string) => boolean;
}): PatternCell[] {
  const out: PatternCell[] = [];
  const n = input.sequence.length;
  if (!n) return out;
  const dates = dateRange(input.from, input.to);
  input.employeeIds.forEach((employeeId, row) => {
    const offset = (input.startOffset ?? 0) + row * (input.stagger ?? 0);
    dates.forEach((date, i) => {
      if (input.skip?.(employeeId, date)) return;
      out.push({ employeeId, date, code: input.sequence[(((i + offset) % n) + n) % n] ?? null });
    });
  });
  return out;
}

// ───────────────────────── Verificações da escala ─────────────────────────

export interface RosterEntry { employeeId: string; date: string; shift: ShiftTypeLike | null }
export type RosterIssueCode = 'rest_short' | 'consecutive_days' | 'weekly_hours' | 'weekly_max' | 'long_shift' | 'absence' | 'holiday' | 'coverage';
export interface RosterIssue { code: RosterIssueCode; severity: 'error' | 'warning' | 'info'; employeeId: string | null; date: string; message: string }

export interface RosterCheckInput {
  from: string; to: string;
  employees: readonly { id: string; name: string; rotation?: boolean }[];
  /** Só dias com turno ou folga planeados. */
  entries: readonly RosterEntry[];
  /** Turno anterior ao intervalo (último dia antes de `from`) para medir o descanso no primeiro dia. */
  before?: readonly RosterEntry[];
  /** Ausências aprovadas: colaborador → data → rótulo. */
  absences?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  holidays?: ReadonlyMap<string, string>;
  types?: readonly ShiftTypeLike[];
  minRestMinutes?: number;
  weeklyHours: number; extendedWeeklyHours: number;
  maxConsecutiveDays?: number;
}

const startAbs = (date: string, t: ShiftTypeLike) => dayIndex(date) * 1440 + minutesOfDay(t.startTime);
const endAbs = (date: string, t: ShiftTypeLike) => startAbs(date, t) + shiftSpanMinutes(t);
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Avisos da escala planeada. Não bloqueiam a gravação: o planeador decide e o aviso fica visível até ser resolvido. */
export function rosterChecks(i: RosterCheckInput): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const minRest = i.minRestMinutes ?? DEFAULT_SHIFT_MIN_REST_MINUTES;
  const maxRun = i.maxConsecutiveDays ?? 6;
  const byEmp = new Map<string, Map<string, ShiftTypeLike | null>>();
  for (const e of [...(i.before ?? []), ...i.entries]) {
    let m = byEmp.get(e.employeeId);
    if (!m) byEmp.set(e.employeeId, (m = new Map()));
    m.set(e.date, e.shift);
  }
  const dates = dateRange(i.from, i.to);
  for (const emp of i.employees) {
    const plan = byEmp.get(emp.id) ?? new Map<string, ShiftTypeLike | null>();
    let run = 0, runStart = '';
    let last: { date: string; t: ShiftTypeLike } | null = null;
    for (const d of [...dateRange(addDays(i.from, -1), addDays(i.from, -1)), ...dates]) {
      const t = plan.get(d) ?? null;
      const inRange = d >= i.from;
      if (!t) { run = 0; continue; }
      if (last && inRange) {
        const gap = startAbs(d, t) - endAbs(last.date, last.t);
        if (gap < 0) issues.push({ code: 'rest_short', severity: 'error', employeeId: emp.id, date: d, message: `${emp.name}: o turno de ${dm(d)} começa antes de terminar o de ${dm(last.date)}` });
        else if (gap < minRest) issues.push({ code: 'rest_short', severity: 'warning', employeeId: emp.id, date: d, message: `${emp.name}: só ${formatShiftHours(gap)} de descanso antes do turno de ${dm(d)} (mínimo ${formatShiftHours(minRest)})` });
      }
      last = { date: d, t };
      if (!inRange) continue;
      if (run === 0) runStart = d;
      run++;
      if (run === maxRun + 1 && !emp.rotation) issues.push({ code: 'consecutive_days', severity: 'warning', employeeId: emp.id, date: d, message: `${emp.name}: mais de ${maxRun} dias seguidos de trabalho desde ${dm(runStart)} sem folga` });
      if (shiftWorkMinutes(t) > 12 * 60) issues.push({ code: 'long_shift', severity: 'warning', employeeId: emp.id, date: d, message: `${emp.name}: turno de ${formatShiftHours(shiftWorkMinutes(t))} em ${dm(d)} (acima de 12 h)` });
      const absence = i.absences?.get(emp.id)?.get(d);
      if (absence) issues.push({ code: 'absence', severity: 'warning', employeeId: emp.id, date: d, message: `${emp.name}: turno em ${dm(d)}, dia de ${absence.toLocaleLowerCase('pt-PT')} aprovada` });
      const holiday = i.holidays?.get(d);
      if (holiday && !emp.rotation) issues.push({ code: 'holiday', severity: 'info', employeeId: emp.id, date: d, message: `${emp.name}: turno no feriado de ${dm(d)} (${holiday})` });
    }
    // Semanas completas (segunda a domingo) dentro do intervalo.
    for (const d of dates) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1 || addDays(d, 6) > i.to) continue;
      const total = dateRange(d, addDays(d, 6)).reduce((s, x) => { const t = plan.get(x); return s + (t ? shiftWorkMinutes(t) : 0); }, 0);
      if (total > i.extendedWeeklyHours * 60) issues.push({ code: 'weekly_max', severity: 'error', employeeId: emp.id, date: d, message: `${emp.name}: ${formatShiftHours(total)} na semana de ${dm(d)}, acima do máximo de ${i.extendedWeeklyHours} h` });
      else if (total > i.weeklyHours * 60 && !emp.rotation) issues.push({ code: 'weekly_hours', severity: 'warning', employeeId: emp.id, date: d, message: `${emp.name}: ${formatShiftHours(total)} na semana de ${dm(d)}, acima de ${i.weeklyHours} h` });
    }
  }
  // Cobertura mínima por tipo de turno e dia.
  for (const t of i.types ?? []) {
    if (!t.minStaff) continue;
    for (const d of dates) {
      const n = i.entries.filter((e) => e.date === d && e.shift?.code === t.code).length;
      if (n < t.minStaff) issues.push({ code: 'coverage', severity: 'warning', employeeId: null, date: d, message: `${t.name} (${t.code}) em ${dm(d)}: ${n} de ${t.minStaff} pessoa(s) previstas` });
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || a.date.localeCompare(b.date));
}

/** Cobertura de um dia: pessoas por código de turno. */
export function coverageByDay(entries: readonly { date: string; code: string | null }[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (!e.code) continue;
    let m = out.get(e.date);
    if (!m) out.set(e.date, (m = new Map()));
    m.set(e.code, (m.get(e.code) ?? 0) + 1);
  }
  return out;
}
