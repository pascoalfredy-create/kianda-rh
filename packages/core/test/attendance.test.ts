import { describe, expect, it } from 'vitest';
import { AO_2026, formatMinutes, fromLuanda, luandaDate, luandaTime, overtimeHoursFromMinutes, summarizeDay, summarizeMonth } from '../src/index.js';

const p = (date: string, a: string, b: string | null) => ({ workDate: date, clockIn: fromLuanda(date, a), clockOut: b ? fromLuanda(date, b) : null });

describe('assiduidade', () => {
  it('hora de Luanda (UTC+1) e data civil à meia-noite', () => {
    const d = fromLuanda('2026-11-03', '00:30');
    expect(d.toISOString()).toBe('2026-11-02T23:30:00.000Z');
    expect(luandaDate(d)).toBe('2026-11-03');
    expect(luandaTime(d)).toBe('00:30');
    expect(formatMinutes(545)).toBe('9h05');
  });
  it('dia útil: extra acima da jornada; manhã e tarde somadas', () => {
    const s = summarizeDay({ date: '2026-11-03', dailyMinutes: 480, today: '2026-11-30', punches: [p('2026-11-03', '08:00', '12:00'), p('2026-11-03', '13:00', '18:30')] });
    expect(s).toMatchObject({ kind: 'workday', workedMinutes: 570, expectedMinutes: 480, overtimeMinutes: 90, flags: [] });
  });
  it('saída por registar não conta horas; sem registo só em dias passados', () => {
    expect(summarizeDay({ date: '2026-11-04', dailyMinutes: 480, today: '2026-11-30', punches: [p('2026-11-04', '08:00', null)] }).flags).toEqual(['open']);
    expect(summarizeDay({ date: '2026-11-05', dailyMinutes: 480, today: '2026-11-30', punches: [] }).flags).toEqual(['no_record']);
    expect(summarizeDay({ date: '2026-11-30', dailyMinutes: 480, today: '2026-11-30', punches: [] }).flags).toEqual([]);
  });
  it('feriado e fim-de-semana: tudo é extra e fica assinalado', () => {
    const h = summarizeDay({ date: '2026-11-11', holiday: 'Independência', dailyMinutes: 480, today: '2026-11-30', punches: [p('2026-11-11', '09:00', '13:00')] });
    expect(h).toMatchObject({ kind: 'holiday', overtimeMinutes: 240, expectedMinutes: 0, flags: ['holiday_work'] });
    const w = summarizeDay({ date: '2026-11-07', dailyMinutes: 480, today: '2026-11-30', punches: [] });
    expect(w).toMatchObject({ kind: 'rest', flags: [] });
  });
  it('mês: férias não contam como falta; totais e horas para o processamento', () => {
    const m = summarizeMonth({
      period: '2026-11', dailyMinutes: 480, holidays: AO_2026.holidays, today: '2026-11-06',
      absences: { '2026-11-05': 'Férias', '2026-11-06': 'Férias' },
      punches: [p('2026-11-03', '08:00', '17:30'), p('2026-11-04', '08:00', '16:00')],
    });
    // 02/11 feriado; 03 (9h30), 04 (8h), 05–06 férias → nenhum dia sem registo
    expect(m).toMatchObject({ workedMinutes: 1050, expectedMinutes: 960, overtimeMinutes: 90, noRecordDays: 0, openDays: 0 });
    expect(overtimeHoursFromMinutes(90)).toBe(1.5);
  });
});

describe('assiduidade: período de contrato e dia em curso', () => {
  it('dias antes da admissão não são previstos nem "sem registo"', () => {
    const m = summarizeMonth({ period: '2026-11', dailyMinutes: 480, holidays: AO_2026.holidays, today: '2026-11-30', absences: {}, punches: [], employedFrom: '2026-11-16' });
    expect(m.days.find((d) => d.date === '2026-11-10')?.kind).toBe('inactive');
    expect(m.noRecordDays).toBe(10); // 16–27 Nov: 10 dias úteis (o dia 30 é hoje)
    expect(m.expectedMinutes).toBe(11 * 480); // inclui hoje (30/11)
  });
  it('entrada aberta hoje não é pendência; ontem é', () => {
    const open = (date: string) => [{ workDate: date, clockIn: fromLuanda(date, '08:00'), clockOut: null }];
    expect(summarizeDay({ date: '2026-11-30', dailyMinutes: 480, today: '2026-11-30', punches: open('2026-11-30') }).flags).toEqual([]);
    expect(summarizeDay({ date: '2026-11-27', dailyMinutes: 480, today: '2026-11-30', punches: open('2026-11-27') }).flags).toEqual(['open']);
  });
});

describe('horas extra em blocos de 15 minutos', () => {
  it('ignora minutos soltos e arredonda para baixo', () => {
    const d = (out: string) => summarizeDay({ date: '2026-11-03', dailyMinutes: 480, today: '2026-11-30', punches: [{ clockIn: fromLuanda('2026-11-03', '08:00'), clockOut: fromLuanda('2026-11-03', out) }] }).overtimeMinutes;
    expect(d('16:12')).toBe(0);
    expect(d('16:38')).toBe(30);
    expect(d('17:00')).toBe(60);
    expect(summarizeDay({ date: '2026-11-03', dailyMinutes: 480, today: '2026-11-30', overtimeBlockMinutes: 1, punches: [{ clockIn: fromLuanda('2026-11-03', '08:00'), clockOut: fromLuanda('2026-11-03', '16:12') }] }).overtimeMinutes).toBe(12);
  });
});
