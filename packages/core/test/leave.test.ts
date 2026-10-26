import { describe, expect, it } from 'vitest';
import {
  AO_2026, ABSENCE_POLICIES, checkAbsenceLimit, fullMonthsBetween, getPack, vacationBalance, vacationEligibleFrom, vacationEntitlement, workingDaysByYear,
} from '../src/index.js';

describe('férias (LGT)', () => {
  it('meses completos de serviço', () => {
    expect(fullMonthsBetween('2026-01-05', '2026-12-31')).toBe(11);
    expect(fullMonthsBetween('2026-01-01', '2026-12-31')).toBe(12);
    expect(fullMonthsBetween('2026-03-15', '2026-04-14')).toBe(1);
    expect(fullMonthsBetween('2026-03-15', '2026-04-13')).toBe(0);
  });
  it('ano de admissão: 2 dias por mês completo; anos seguintes: 22', () => {
    expect(vacationEntitlement('2026-06-01', 2026, AO_2026)).toBe(14);
    expect(vacationEntitlement('2026-01-01', 2026, AO_2026)).toBe(22);
    expect(vacationEntitlement('2026-01-05', 2026, AO_2026)).toBe(22);
    expect(vacationEntitlement('2023-01-16', 2026, AO_2026)).toBe(22);
    expect(vacationEntitlement('2027-01-01', 2026, AO_2026)).toBe(0);
  });
  it('gozo só após 6 meses de serviço', () => {
    expect(vacationEligibleFrom('2026-01-05', AO_2026)).toBe('2026-07-05');
    expect(vacationEligibleFrom('2025-08-31', AO_2026)).toBe('2026-02-28');
  });
  it('dias úteis repartidos por ano, com feriados', () => {
    // 22–31 Dez 2026: 25/12 é feriado → 7 dias úteis
    expect(workingDaysByYear('2026-12-22', '2026-12-31', (y) => getPack('AO', y))).toEqual({ 2026: 7 });
  });
  it('saldo disponível desconta aprovados e pendentes', () => {
    expect(vacationBalance({ year: 2026, entitlement: 22, carriedOver: 3, approvedDays: 10, pendingDays: 5 }).available).toBe(10);
  });
  it('limites legais por ocorrência', () => {
    expect(checkAbsenceLimit('paternity', '2026-11-02', '2026-11-13', 10, AO_2026)).toMatch(/máximo de 7 dias úteis/);
    expect(checkAbsenceLimit('maternity', '2026-11-01', '2027-02-15', 70, AO_2026)).toMatch(/máximo de 90 dias seguidos/);
    expect(checkAbsenceLimit('vacation', '2026-11-02', '2026-12-31', 40, AO_2026)).toBeNull();
    expect(ABSENCE_POLICIES.unjustified.selfService).toBe(false);
  });
});

describe('feriados gerados e regras laborais por ano', async () => {
  const { angolaHolidays, easterSunday, labourRules, packOrLatest } = await import('../src/index.js');
  it('reproduz o calendário de 2026 e calcula a Páscoa', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(angolaHolidays(2026)).toEqual([...AO_2026.holidays]);
    expect(angolaHolidays(2027).find((h) => h.name === 'Carnaval')?.date).toBe('2027-02-09');
  });
  it('2027: férias planeáveis, regras fiscais continuam bloqueadas', () => {
    const r = labourRules('AO', 2027);
    expect(r.year).toBe(2027);
    expect(r.holidays[0]!.date).toBe('2027-01-01');
    expect(() => getPack('AO', 2027)).toThrow();
    expect(packOrLatest('AO', 2027).version).toBe('AO-2026.1');
    // férias de 21/12/2026 a 08/01/2027: 8 dias úteis em 2026 (25/12 feriado) + 5 em 2027 (01/01 feriado)
    expect(workingDaysByYear('2026-12-21', '2027-01-08', (y) => labourRules('AO', y))).toEqual({ 2026: 8, 2027: 5 });
  });
});
