import { describe, expect, it } from 'vitest';
import {
  AO_2026, calculatePayroll, checkAbsenceLimit, hourlyRateMinor, kz, roundOvertimeMinutes, summarizeDay, summarizeMonth, terminationProposal,
  vacationEntitlement, yearServiceFraction, fromLuanda,
} from '../src/index.js';

/** Regras confirmadas no texto da Lei n.º 12/23 (LGT). */
describe('LGT — tempo de trabalho', () => {
  it('arredondamento das horas extra (art. 188.º, n.º 4): <15 min nada, 15–44 meia hora, 45–60 uma hora', () => {
    expect([0, 14, 15, 44, 45, 59, 60, 74, 75, 105].map(roundOvertimeMinutes)).toEqual([0, 0, 30, 30, 60, 60, 60, 60, 90, 120]);
    const d = summarizeDay({ date: '2026-11-03', dailyMinutes: 480, today: '2026-11-30', punches: [{ clockIn: fromLuanda('2026-11-03', '08:00'), clockOut: fromLuanda('2026-11-03', '16:50') }] });
    expect(d.overtimeMinutes).toBe(60);
  });

  it('dia de descanso trabalhado paga no mínimo 3 h (art. 194.º); feriado conta à parte e não em turnos (art. 200.º, n.º 3)', () => {
    const at = (d: string, a: string, b: string) => ({ workDate: d, clockIn: fromLuanda(d, a), clockOut: fromLuanda(d, b) });
    const base = { period: '2026-11', dailyMinutes: 480, holidays: AO_2026.holidays, absences: {}, today: '2026-12-05' };
    const m = summarizeMonth({ ...base, punches: [at('2026-11-07', '09:00', '10:00'), at('2026-11-11', '08:00', '16:00')] }); // sábado 1 h; 11/11 feriado
    expect(m.restDayPaidMinutes).toBe(180);
    expect(m.holidayWorkDays).toBe(1);
    const shift = summarizeMonth({ ...base, shiftRegime: true, schedule: () => 480, punches: [at('2026-11-11', '08:00', '16:00')] });
    expect(shift.holidayWorkDays).toBe(0);
  });
});

describe('LGT — salário', () => {
  const base = kz(300_000);
  const hourly = hourlyRateMinor(base, AO_2026); // 300 000 × 12 / (52 × 44)
  it('valor-hora (art. 237.º, n.º 7) e faltas descontadas ao valor-hora × 8 h (art. 240.º)', () => {
    expect(hourly).toBe(Math.round((base * 12) / (52 * 44)));
    const r = calculatePayroll({ period: '2026-11', baseMinor: base, absenceDays: 2 });
    expect(r.lines.find((l) => l.code === 'FALTAS')!.amountMinor).toBe(-Math.round(16 * hourly));
  });
  it('descanso +75% (art. 194.º), feriado +1 dia (art. 200.º), paternidade complementar não paga (art. 218.º)', () => {
    const r = calculatePayroll({ period: '2026-11', baseMinor: base, restDayHours: 3, holidayWorkDays: 1, unpaidLeaveHours: 56, unpaidLeaveLabel: 'Paternidade (7 dias úteis não remunerados)' });
    const by = Object.fromEntries(r.lines.map((l) => [l.code, l.amountMinor]));
    expect(by.HEDESC).toBe(Math.round(3 * hourly * 1.75));
    expect(by.FERTRAB).toBe(Math.round(8 * hourly));
    expect(by.LICNR).toBe(-Math.round(56 * hourly));
  });
  it('alimentação e transporte sem os dias de férias (art. 213.º, n.º 2)', () => {
    const r = calculatePayroll({ period: '2026-11', baseMinor: base, mealMinor: kz(30_000), transportMinor: kz(20_000), vacationAllowanceCut: { fraction: 10 / 21, days: 10 } });
    expect(r.lines.find((l) => l.code === 'ALIM')).toMatchObject({ amountMinor: kz(30_000) - Math.round(kz(30_000) * 10 / 21), name: 'Subsídio de alimentação (sem 10 dia(s) de férias)' });
  });
  it('subsídios proporcionais aos meses completos (art. 238.º, n.º 3)', () => {
    expect(yearServiceFraction(2026, '2026-03-15')).toBe(9 / 12); // 15/03 a 31/12: 9 meses completos
    expect(yearServiceFraction(2026, '2020-01-01', '2026-06-30')).toBe(6 / 12);
  });
});

describe('LGT — férias e faltas', () => {
  it('ano de admissão: 2 dias por mês completo, mínimo de 6 (art. 204.º, n.º 2)', () => {
    expect(vacationEntitlement('2026-10-20', 2026, AO_2026)).toBe(6); // 2 meses completos → 4, sobe para 6
    expect(vacationEntitlement('2026-12-20', 2026, AO_2026)).toBe(0); // nenhum mês completo
  });
  it('casamento até 8 dias seguidos (art. 222.º); luto até 8 dias úteis (art. 223.º)', () => {
    expect(checkAbsenceLimit('marriage', '2026-11-02', '2026-11-09', 6, AO_2026)).toBeNull();
    expect(checkAbsenceLimit('marriage', '2026-11-02', '2026-11-10', 7, AO_2026)).toMatch(/8 dias seguidos/);
    expect(checkAbsenceLimit('bereavement', '2026-11-02', '2026-11-13', 9, AO_2026)).toMatch(/8 dias úteis/);
  });
});

describe('LGT — cessação', () => {
  const common = { baseMinor: kz(200_000), vacationUnusedDays: 0, holidaySubsidyPaidThisYear: true, christmasSubsidyPaidThisYear: true, pack: AO_2026 };
  it('antiguidade: fracção ≥ 3 meses conta como um ano (art. 311.º)', () => {
    const p = terminationProposal({ ...common, reason: 'objective_dismissal', hireDate: '2022-06-01', effectiveDate: '2026-10-31', noticeDate: '2026-10-01' });
    expect(p.seniority.years).toBe(4);
    expect(p.legalCompensationMinor).toBe(kz(200_000) * 5); // 4 anos e 5 meses → 5 anos
    const q = terminationProposal({ ...common, reason: 'objective_dismissal', hireDate: '2026-01-01', effectiveDate: '2026-02-28', noticeDate: '2026-01-29' });
    expect(q.legalCompensationMinor).toBe(0); // 2 meses: sem ano
  });
  it('justa causa do trabalhador: 1 salário por ano, mínimo de 3 (art. 310.º); extinção do empregador: 50% por ano (art. 307.º)', () => {
    const j = terminationProposal({ ...common, reason: 'resignation_just_cause', hireDate: '2025-01-01', effectiveDate: '2026-10-31' });
    expect(j.legalCompensationMinor).toBe(kz(200_000) * 3);
    const e = terminationProposal({ ...common, reason: 'employer_extinction', hireDate: '2020-01-01', effectiveDate: '2026-10-31' });
    expect(e.legalCompensationMinor).toBe(kz(100_000) * 7);
  });
});

describe('LGT — suspensão e vésperas', () => {
  it('maternidade suspende o contrato e o salário (arts. 267.º, c) e 268.º): base, alimentação e transporte ÷ 30 × dias', () => {
    const r = calculatePayroll({ period: '2026-11', baseMinor: kz(300_000), mealMinor: kz(30_000), suspendedDays: 20, suspendedLabel: 'Licença de maternidade (20 dias — subsídio pago pela segurança social)' });
    const by = Object.fromEntries(r.lines.map((l) => [l.code, l.amountMinor]));
    expect(by.SUSP).toBe(-kz(200_000));
    expect(by.ALIM).toBe(kz(10_000));
    const all = calculatePayroll({ period: '2026-11', baseMinor: kz(300_000), suspendedDays: 30 });
    expect(all.grossMinor).toBe(0);
    expect(all.netMinor).toBe(0);
  });
  it('24 e 31 de Dezembro: trabalho até às 12h30 (art. 199.º); trabalho depois disso conta como extra', () => {
    const at = (d: string, a: string, b: string) => ({ workDate: d, clockIn: fromLuanda(d, a), clockOut: fromLuanda(d, b) });
    const m = summarizeMonth({ period: '2026-12', dailyMinutes: 480, holidays: AO_2026.holidays, absences: {}, today: '2027-01-05', familyEveMinutes: 270, punches: [at('2026-12-24', '08:00', '17:00')] });
    const eve = m.days.find((d) => d.date === '2026-12-24')!;
    expect(eve).toMatchObject({ expectedMinutes: 270, overtimeMinutes: 270 });
    expect(m.days.find((d) => d.date === '2026-12-31')!.expectedMinutes).toBe(270);
  });
});
