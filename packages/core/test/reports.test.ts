import { describe, expect, it } from 'vitest';
import { costGroup, peopleReport, splitAbsenceByMonth, workingDaysInMonth } from '../src/index.js';

const b = (code: string, amountMinor: number) => ({ code, kind: 'earning', amountMinor });

describe('relatórios de gestão de pessoas', () => {
  it('dias úteis sem fins-de-semana nem feriados (Dezembro 2026: Natal a 25)', () => {
    expect(workingDaysInMonth('2026-12')).toBe(22);
    expect(workingDaysInMonth('2026-02')).toBe(18); // 20 dias de semana − 4 de Fevereiro − Carnaval (17)
  });

  it('grupos de custo pelos códigos do recibo', () => {
    expect(['BASE', 'FALTAS', 'ALIM', 'SUBTURNO', 'SUBNAT', 'HE', 'BONUS', 'COMP'].map(costGroup)).toEqual(['base', 'base', 'allowances', 'allowances', 'annual', 'variable', 'variable', 'exit']);
  });

  it('ausência repartida pelos meses em proporção dos dias de calendário', () => {
    expect(splitAbsenceByMonth({ startDate: '2026-10-29', endDate: '2026-11-04', workingDays: 5 })).toEqual([{ period: '2026-10', days: 2.1 }, { period: '2026-11', days: 2.9 }]);
  });

  it('custo, efectivo, rotatividade, absentismo e departamentos', () => {
    const r = peopleReport({
      periods: ['2026-11', '2026-10'],
      employees: [
        { id: 'a', departmentId: 'd1', hireDate: '2025-01-01', exitDate: null },
        { id: 'b', departmentId: 'd2', hireDate: '2026-10-05', exitDate: '2026-11-30' },
      ],
      departments: [{ id: 'd1', name: 'Operações', costCenter: 'CC1' }, { id: 'd2', name: 'Finanças', costCenter: 'CC2' }],
      lines: [
        { period: '2026-10', employeeId: 'a', grossMinor: 100_000, inssEmployerMinor: 8_000, overtimeHours: 2, absenceDays: 1, breakdown: [b('BASE', 90_000), b('HE', 10_000), { code: 'INSS', kind: 'deduction', amountMinor: 3000 }] },
        { period: '2026-10', employeeId: 'b', grossMinor: 50_000, inssEmployerMinor: 4_000, overtimeHours: 0, absenceDays: 0, breakdown: [b('BASE', 50_000)] },
        { period: '2026-11', employeeId: 'a', grossMinor: 100_000, inssEmployerMinor: 8_000, overtimeHours: 0, absenceDays: 0, breakdown: [b('BASE', 100_000)] },
        { period: '2026-11', employeeId: 'b', grossMinor: 80_000, inssEmployerMinor: 4_000, overtimeHours: 0, absenceDays: 0, breakdown: [b('BASE', 50_000), b('COMP', 30_000)] },
      ],
      leaveDays: [{ period: '2026-11', employeeId: 'a', days: 2 }],
    });
    expect(r.from).toBe('2026-10');
    expect(r.months.map((m) => [m.period, m.headcount, m.costMinor, m.hires, m.exits])).toEqual([['2026-10', 2, 162_000, 1, 0], ['2026-11', 2, 192_000, 0, 1]]);
    expect(r.totals).toMatchObject({ costMinor: 354_000, avgHeadcount: 2, exits: 1, turnoverPct: 50, avgMonthlyCostPerHeadMinor: 88_500, overtimeMinor: 10_000 });
    expect(r.totals.groups).toEqual({ base: 290_000, allowances: 0, annual: 0, variable: 10_000, exit: 30_000 });
    expect(r.months[0]!.absenteeismPct).toBe(Math.round((1 / (2 * r.months[0]!.workingDays)) * 10_000) / 100);
    expect(r.departments.map((d) => [d.name, d.headcount, d.costMinor, d.avgMonthlyCostMinor, d.absenceDays])).toEqual([['Operações', 1, 216_000, 108_000, 3], ['Finanças', 1, 138_000, 69_000, 0]]);
  });
});
