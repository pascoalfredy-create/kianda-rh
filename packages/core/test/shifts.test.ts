import { describe, expect, it } from 'vitest';
import {
  applyPattern, crossesMidnight, isNightShift, parsePattern, rosterChecks, shiftNightMinutes, shiftSpanMinutes, shiftTypeIssue, shiftWorkMinutes,
  type RosterEntry, type ShiftTypeLike,
} from '../src/index.js';

const M: ShiftTypeLike = { code: 'M', name: 'Manhã', startTime: '06:00', endTime: '14:00', breakMinutes: 30 };
const T: ShiftTypeLike = { code: 'T', name: 'Tarde', startTime: '14:00', endTime: '22:00', breakMinutes: 30 };
const N: ShiftTypeLike = { code: 'N', name: 'Noite', startTime: '22:00', endTime: '06:00', breakMinutes: 30 };
const D12: ShiftTypeLike = { code: 'D', name: 'Dia 12 h', startTime: '07:00', endTime: '19:30', breakMinutes: 0 };
const base = { weeklyHours: 44, extendedWeeklyHours: 54 };
const emp = [{ id: 'a', name: 'Ana' }];

describe('tipos de turno', () => {
  it('mede a duração, o tempo de trabalho e a noite, atravessando a meia-noite', () => {
    expect(shiftSpanMinutes(M)).toBe(480);
    expect(shiftWorkMinutes(M)).toBe(450);
    expect(shiftSpanMinutes(N)).toBe(480);
    expect(crossesMidnight(N)).toBe(true);
    expect(crossesMidnight(M)).toBe(false);
    expect(shiftNightMinutes(N)).toBe(480);
    expect(shiftNightMinutes(T)).toBe(120);
    expect(shiftNightMinutes(M)).toBe(0);
    expect(shiftNightMinutes({ startTime: '04:00', endTime: '12:00' })).toBe(120);
    expect(isNightShift(N)).toBe(true);
    expect(isNightShift(T)).toBe(false);
  });
  it('recusa códigos, horas e intervalos inválidos', () => {
    expect(shiftTypeIssue(M)).toBeNull();
    expect(shiftTypeIssue({ ...M, code: 'm' })).toMatch(/código/);
    expect(shiftTypeIssue({ ...M, code: 'F' })).toMatch(/folga/);
    expect(shiftTypeIssue({ ...M, endTime: '06:00' })).toMatch(/mesma hora/);
    expect(shiftTypeIssue({ ...M, startTime: '6:00' })).toMatch(/HH:MM/);
    expect(shiftTypeIssue({ ...M, breakMinutes: 300 })).toMatch(/intervalo/);
    expect(shiftTypeIssue({ ...M, startTime: '06:00', endTime: '06:30', breakMinutes: 0 })).toMatch(/1 hora/);
    expect(shiftTypeIssue({ ...M, minStaff: -1 })).toMatch(/mínimo/);
  });
});

describe('padrões', () => {
  it('lê códigos com repetição e folgas', () => {
    expect(parsePattern('m×2 tx2 N*2 f f', ['M', 'T', 'N'])).toEqual({ sequence: ['M', 'M', 'T', 'T', 'N', 'N', null, null], error: null });
    expect(parsePattern('M, M; F', ['M']).sequence).toEqual(['M', 'M', null]);
    expect(parsePattern('M Q', ['M']).error).toMatch(/desconhecido/);
    expect(parsePattern('F F', ['M']).error).toMatch(/nenhum turno/);
    expect(parsePattern('', ['M']).error).toMatch(/Escreva/);
    expect(parsePattern('M-2', ['M']).error).toMatch(/inválido/);
  });
  it('desfasa equipas e respeita os dias a manter', () => {
    const out = applyPattern({ employeeIds: ['a', 'b'], from: '2026-11-02', to: '2026-11-05', sequence: ['M', 'M', null, null], stagger: 2, skip: (e, d) => e === 'b' && d === '2026-11-05' });
    expect(out.filter((c) => c.employeeId === 'a').map((c) => c.code)).toEqual(['M', 'M', null, null]);
    expect(out.filter((c) => c.employeeId === 'b').map((c) => c.code)).toEqual([null, null, 'M']);
    expect(applyPattern({ employeeIds: ['a'], from: '2026-11-02', to: '2026-11-03', sequence: ['M', 'T', 'N'], startOffset: 2 }).map((c) => c.code)).toEqual(['N', 'M']);
  });
});

const plan = (codes: string, from = '2026-11-02', id = 'a'): RosterEntry[] => {
  const map: Record<string, ShiftTypeLike> = { M, T, N, D: D12 };
  return [...codes].map((c, i) => ({ employeeId: id, date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), shift: c === 'F' ? null : map[c]! }));
};

describe('verificações da escala', () => {
  it('assinala descanso curto entre turnos e sobreposição', () => {
    const issues = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-04', employees: emp, entries: plan('NMF') });
    expect(issues.map((x) => [x.code, x.severity, x.date])).toEqual([['rest_short', 'warning', '2026-11-03']]);
    const early: ShiftTypeLike = { code: 'E', name: 'Cedo', startTime: '05:00', endTime: '13:00', breakMinutes: 0 };
    const overlap = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-03', employees: emp, entries: [plan('N')[0]!, { employeeId: 'a', date: '2026-11-03', shift: early }] });
    expect(overlap[0]).toMatchObject({ code: 'rest_short', severity: 'error' });
    const tm = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-03', employees: emp, entries: plan('TM') });
    expect(tm[0]).toMatchObject({ code: 'rest_short', severity: 'warning' });
    expect(tm[0]!.message).toMatch(/8h00 de descanso/);
    expect(rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-03', employees: emp, entries: plan('TM'), minRestMinutes: 480 })).toEqual([]);
  });
  it('mede o descanso desde o turno anterior ao intervalo', () => {
    const issues = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-02', employees: emp, entries: plan('M'), before: plan('N', '2026-11-01') });
    expect(issues[0]).toMatchObject({ code: 'rest_short', date: '2026-11-02' });
  });
  it('dias seguidos e horas semanais, salvo em rotação', () => {
    const seven = plan('MMMMMMM');
    const issues = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-08', employees: emp, entries: seven });
    expect(issues.map((x) => x.code).sort()).toEqual(['consecutive_days', 'weekly_hours']);
    expect(rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-08', employees: [{ ...emp[0]!, rotation: true }], entries: seven })).toEqual([]);
    const long = rosterChecks({ ...base, from: '2026-11-02', to: '2026-11-08', employees: [{ ...emp[0]!, rotation: true }], entries: plan('DDDDDFF') });
    expect(long.filter((x) => x.code === 'weekly_max')).toHaveLength(1);
    expect(long.filter((x) => x.code === 'long_shift')).toHaveLength(5);
  });
  it('ausências, feriados e cobertura mínima', () => {
    const issues = rosterChecks({
      ...base, from: '2026-11-10', to: '2026-11-11', employees: emp, entries: plan('MM', '2026-11-10'),
      absences: new Map([['a', new Map([['2026-11-10', 'Férias']])]]), holidays: new Map([['2026-11-11', 'Dia da Independência']]),
      types: [{ ...M, minStaff: 1 }, { ...N, minStaff: 2 }],
    });
    expect(issues.map((x) => x.code).sort()).toEqual(['absence', 'coverage', 'coverage', 'holiday']);
    expect(issues.find((x) => x.code === 'coverage')!.message).toMatch(/0 de 2/);
    expect(issues.at(-1)!.severity).toBe('info');
  });
});
