import { describe, expect, it } from 'vitest';
import { budgetProjection, budgetVsActual, type BudgetAssumptions, type BudgetEmployee } from '../src/index.js';

const rules = { holidayBps: 5000, christmasBps: 5000, employerInssBps: 800, holidayInInss: true, christmasInInss: true, dailyRateDivisor: 30 };
const base: BudgetAssumptions = { year: 2027, increaseBps: 0, increaseFrom: '2027-01', hires: [], holidayMonth: 7, christmasMonth: 12 };
const emp = (o: Partial<BudgetEmployee> = {}): BudgetEmployee => ({ id: 'a', departmentId: 'd1', baseMinor: 100_000, mealMinor: 10_000, transportMinor: 5_000, otherMinor: 0, startDate: '2020-01-01', endDate: null, allowances: [], ...o });
const month = (cells: ReturnType<typeof budgetProjection>, p: string) => cells.filter((c) => c.period === p).reduce((s, c) => s + c.costMinor, 0);

describe('orçamento de pessoal', () => {
  it('mês normal: base + alimentação + transporte + 8% do INSS sobre a base', () => {
    const c = budgetProjection([emp()], base, rules);
    expect(month(c, '2027-01')).toBe(115_000 + 8_000);
    // Julho e Dezembro com os subsídios (50% da base, com INSS).
    expect(month(c, '2027-07')).toBe(115_000 + 50_000 + 8_000 + 4_000);
    expect(month(c, '2027-12')).toBe(115_000 + 50_000 + 8_000 + 4_000);
    expect(c.find((x) => x.period === '2027-03')?.headcount).toBe(1);
  });

  it('aumento de 10% a partir de Abril; admissão em Maio com subsídios proporcionais', () => {
    const c = budgetProjection([emp()], { ...base, increaseBps: 1000, increaseFrom: '2027-04', hires: [{ departmentId: 'd2', from: '2027-05', count: 2, baseMinor: 60_000, mealMinor: 0, transportMinor: 0 }] }, rules);
    expect(month(c, '2027-03')).toBe(123_000);
    expect(month(c, '2027-04')).toBe(110_000 + 15_000 + 8_800);
    const d2 = c.filter((x) => x.departmentId === 'd2');
    expect(d2[0]).toMatchObject({ period: '2027-05', headcount: 2, costMinor: 2 * (60_000 + 4_800) });
    // Natal: 8 meses completos (Maio–Dezembro) / 12.
    expect(d2.find((x) => x.period === '2027-12')!.costMinor).toBe(Math.round(2 * (60_000 + 30_000 * 8 / 12) * 1.08));
    // Férias em Julho: admitidos em Maio recebem 8/12.
    expect(d2.find((x) => x.period === '2027-07')!.grossMinor).toBe(Math.round(2 * (60_000 + 30_000 * 8 / 12)));
  });

  it('contrato a termo que acaba a 15 de Março: meio mês e nada depois', () => {
    const c = budgetProjection([emp({ endDate: '2027-03-15', mealMinor: 0, transportMinor: 0 })], base, rules);
    expect(month(c, '2027-03')).toBe(Math.round((100_000 * 15) / 30 * 1.08));
    expect(month(c, '2027-04')).toBe(0);
  });

  it('subsídios da empresa: fixo, % da base e por dia (dias úteis do mês)', () => {
    const c = budgetProjection([emp({ mealMinor: 0, transportMinor: 0, allowances: [
      { calc: 'fixed', valueMinor: 20_000, bps: null, inInss: true, startDate: '2026-01-01', endDate: null },
      { calc: 'base_pct', valueMinor: null, bps: 2000, inInss: true, startDate: '2026-01-01', endDate: null },
      { calc: 'per_day', valueMinor: 1_000, bps: null, inInss: false, startDate: '2026-01-01', endDate: null },
    ] })], base, rules);
    const jan = c.find((x) => x.period === '2027-01')!;
    expect(jan.grossMinor).toBe(100_000 + 20_000 + 20_000 + 1_000 * 20);
  });

  it('orçado vs real: desvio só nos meses fechados; previsão de fecho = real + orçado restante', () => {
    const budget = budgetProjection([emp()], base, rules);
    const actual = [{ period: '2027-01', departmentId: 'd1', costMinor: 130_000, headcount: 1 }, { period: '2027-02', departmentId: 'd1', costMinor: 120_000, headcount: 1 }];
    const r = budgetVsActual(budget, actual, ['2027-01', '2027-02'], 2027);
    expect(r.months[0]).toMatchObject({ budgetMinor: 123_000, actualMinor: 130_000, varianceMinor: 7_000 });
    expect(r.months[2]!.actualMinor).toBeNull();
    expect(r.totals).toMatchObject({ budgetToDateMinor: 246_000, actualToDateMinor: 250_000, varianceMinor: 4_000, closedMonths: 2 });
    expect(r.totals.forecastMinor).toBe(r.totals.budgetYearMinor + 4_000);
    expect(r.departments[0]).toMatchObject({ departmentId: 'd1', varianceMinor: 4_000 });
  });
});
