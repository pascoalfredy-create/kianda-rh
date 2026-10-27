import { describe, expect, it } from 'vitest';
import {
  ALLOWANCE_PRESETS, allowanceAmount, complianceChecks, describeSchedule, kz, SCHEDULE_PRESETS, scheduledDays, scheduledMinutes, scheduleStats, SECTOR_PROFILES,
  sectorProfile, summarizeMonth,
} from '../src/index.js';

const rot = { ...SCHEDULE_PRESETS.rotation_28!, anchorDate: null };

describe('regimes de horário', () => {
  it('semanal: segunda a sexta, sábado e domingo de descanso', () => {
    const s = SCHEDULE_PRESETS.standard!;
    expect(scheduledMinutes(s, '2026-10-26')).toBe(480); // segunda
    expect(scheduledMinutes(s, '2026-10-31')).toBe(0); // sábado
    expect(scheduledMinutes(SCHEDULE_PRESETS.mon_sat!, '2026-10-31')).toBe(240);
  });

  it('rotação 28/28: posição no ciclo a partir da data de início (também antes dela)', () => {
    expect(scheduledMinutes(rot, '2026-10-01', '2026-10-01')).toBe(720);
    expect(scheduledMinutes(rot, '2026-10-28', '2026-10-01')).toBe(720); // dia 28
    expect(scheduledMinutes(rot, '2026-10-29', '2026-10-01')).toBe(0); // dia 29 → descanso
    expect(scheduledMinutes(rot, '2026-11-26', '2026-10-01')).toBe(720); // dia 57 → novo ciclo
    expect(scheduledMinutes(rot, '2026-09-30', '2026-10-01')).toBe(0); // véspera = último dia de descanso
    expect(scheduledMinutes(rot, '2026-10-05')).toBe(0); // sem data de início
    expect(scheduledDays(rot, '2026-10-01', '2026-10-31', '2026-10-01')).toBe(28);
    expect(scheduledDays(rot, '2026-10-01', '2026-10-31', '2026-10-15')).toBe(17);
  });

  it('estatísticas e avisos', () => {
    const r = scheduleStats(rot, 44);
    expect(r).toMatchObject({ cycleDays: 56, workDays: 28, avgWeeklyMinutes: 2520 });
    expect(r.problems).toEqual([expect.stringMatching(/turnos rotativos o limite é 8 h por dia.*art\. 161\.º/)]); // média 42 h cumpre o art. 148.º
    expect(scheduleStats(SCHEDULE_PRESETS.shift_3x8!, 44).problems).toEqual([]);
    expect(scheduleStats(SCHEDULE_PRESETS.shift_12x2!, 44).avgWeeklyMinutes).toBe(2520);
    expect(scheduleStats(SCHEDULE_PRESETS.rotation_42_21!, 44).problems[0]).toMatch(/acima de 44 h: só admissível em turnos.*até 54 h/);
    expect(scheduleStats({ kind: 'weekly', pattern: [660, 660, 660, 660, 660, 0, 0] }, 44).problems[0]).toMatch(/acima do máximo de 54 h/);
    expect(scheduleStats({ kind: 'weekly', pattern: [480, 480, 480, 480, 480, 480, 480] }, 44).problems.join()).toMatch(/descanso semanal/);
    expect(describeSchedule(rot)).toBe('Ciclo de 56 dias: 28 de trabalho (12h00), 28 de descanso');
    expect(describeSchedule(SCHEDULE_PRESETS.standard!)).toBe('Semanal: seg 8h00, ter 8h00, qua 8h00, qui 8h00, sex 8h00');
  });

  it('o ponto conta as horas previstas pelo regime (sábado de rotação é dia de trabalho)', () => {
    const at = (d: string, h1: string, h2: string) => ({ workDate: d, clockIn: new Date(`${d}T${h1}:00+01:00`), clockOut: new Date(`${d}T${h2}:00+01:00`) });
    const m = summarizeMonth({
      period: '2026-10', dailyMinutes: 480, holidays: [], absences: {}, today: '2026-11-05',
      punches: [at('2026-10-03', '06:00', '18:00'), at('2026-10-29', '07:00', '11:00')],
      schedule: (d) => scheduledMinutes(rot, d, '2026-10-01'),
    });
    const sat = m.days.find((d) => d.date === '2026-10-03')!;
    expect(sat).toMatchObject({ kind: 'workday', expectedMinutes: 720, overtimeMinutes: 0 });
    expect(m.days.find((d) => d.date === '2026-10-29')).toMatchObject({ kind: 'rest', overtimeMinutes: 240 });
    expect(m.expectedMinutes).toBe(28 * 720);
    expect(m.noRecordDays).toBe(27);
  });
});

describe('subsídios recorrentes', () => {
  const base = kz(300_000);
  it('fixo, % do base e por dia de escala', () => {
    expect(allowanceAmount({ calc: 'fixed', valueMinor: kz(15_000), baseMinor: base, scheduledDays: 0, dailyRateDivisor: 30 })).toBe(kz(15_000));
    expect(allowanceAmount({ calc: 'base_pct', bps: 1000, baseMinor: base, scheduledDays: 0, dailyRateDivisor: 30 })).toBe(kz(30_000));
    expect(allowanceAmount({ calc: 'per_day', valueMinor: kz(5_000), baseMinor: base, scheduledDays: 28, dailyRateDivisor: 30 })).toBe(kz(140_000));
  });
  it('mês incompleto: fixo e % proporcionais aos dias', () => {
    expect(allowanceAmount({ calc: 'fixed', valueMinor: kz(15_000), baseMinor: base, activeDays: 15, scheduledDays: 0, dailyRateDivisor: 30 })).toBe(kz(7_500));
    expect(allowanceAmount({ calc: 'base_pct', bps: 1000, baseMinor: base, activeDays: 10, scheduledDays: 0, dailyRateDivisor: 30 })).toBe(kz(10_000));
  });
});

describe('perfis por sector', () => {
  it('todos os perfis referem regimes e subsídios existentes', () => {
    for (const [sector, p] of Object.entries(SECTOR_PROFILES)) {
      for (const k of p.schedules) expect(SCHEDULE_PRESETS[k], `${sector}: ${k}`).toBeDefined();
      for (const k of p.allowances) expect(ALLOWANCE_PRESETS[k], `${sector}: ${k}`).toBeDefined();
    }
    expect(new Set(Object.values(ALLOWANCE_PRESETS).map((a) => a.code)).size).toBe(Object.keys(ALLOWANCE_PRESETS).length);
    expect(sectorProfile('mining').schedules[0]).toBe('rotation_28');
    expect(sectorProfile(null)).toBe(SECTOR_PROFILES.other);
  });

  it('conformidade: cartão de vigilante, vistos e regimes', () => {
    const checks = complianceChecks({
      sector: 'security', today: '2026-10-27', weeklyHoursLimit: 44,
      schedules: [{ id: 's1', name: 'Turnos 12 h', ...SCHEDULE_PRESETS.shift_12x2!, anchorDate: null }],
      employees: [
        { id: 'a', name: 'Ana', jobTitle: 'Vigilante', nationality: 'Angolana', scheduleId: 's1', scheduleAnchor: '2026-10-01', documents: [{ type: 'professional_card', expiryDate: '2027-06-30' }] },
        { id: 'b', name: 'Bento', jobTitle: 'Supervisor de Segurança', nationality: 'Angolana', scheduleId: 's1', scheduleAnchor: null, documents: [{ type: 'professional_card', expiryDate: '2026-09-30' }] },
        { id: 'c', name: 'Carlos', jobTitle: 'Vigilante armado', nationality: 'Portuguesa', scheduleId: null, documents: [{ type: 'professional_card', expiryDate: '2026-11-10' }] },
        { id: 'd', name: 'Dora', jobTitle: 'Técnica de RH', nationality: 'Angolana', scheduleId: null, documents: [] },
      ],
    });
    const by = Object.fromEntries(checks.map((c) => [c.code, c]));
    expect(by.doc_professional_card!.employees).toEqual([{ id: 'b', name: 'Bento', note: 'caducado' }]);
    expect(by.doc_professional_card_soon!.employees.map((e) => e.id)).toEqual(['c']);
    expect(by.foreign_visa!.employees.map((e) => e.id)).toEqual(['c']);
    expect(by.anchor_s1!.employees.map((e) => e.id)).toEqual(['b']);
    expect(by.no_schedule!.severity).toBe('info');
    // A técnica de RH não precisa de cartão de vigilante; a função decide (sem acentos nem maiúsculas).
    expect(by.doc_professional_card!.employees.some((e) => e.id === 'd')).toBe(false);
  });
});
