import { describe, expect, it } from 'vitest';
import { addMonths, advancePlan, AO_2026, checkAdvance, kz, monthlyDeductionCap } from '../src/index.js';

describe('adiantamentos (LGT, art. 248.º)', () => {
  it('plano de prestações iguais, resto na última; meses seguidos com mudança de ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(advancePlan(kz(100_000), 3, '2026-11')).toEqual([
      { period: '2026-11', amountMinor: 3_333_333 }, { period: '2026-12', amountMinor: 3_333_333 }, { period: '2027-01', amountMinor: 3_333_334 },
    ]);
  });
  it('limite de 3 salários base no total e 25% do líquido por mês', () => {
    const base = { baseMinor: kz(300_000), netMinor: kz(270_000), outstandingMinor: 0, otherMonthlyDeductionsMinor: 0, pack: AO_2026 };
    expect(monthlyDeductionCap(kz(270_000), AO_2026)).toBe(kz(67_500));
    const ok = checkAdvance({ ...base, amountMinor: kz(200_000), installments: 3 });
    expect(ok).toMatchObject({ maxAmountMinor: kz(900_000), maxInstallmentMinor: kz(67_500), minInstallments: 3, problems: [] });
    expect(checkAdvance({ ...base, amountMinor: kz(200_000), installments: 2 }).problems[0]).toMatch(/pelo menos 3 prestações/);
    expect(checkAdvance({ ...base, amountMinor: kz(950_000), installments: 15 }).problems[0]).toMatch(/3 salários base/);
    const owing = checkAdvance({ ...base, amountMinor: kz(100_000), installments: 2, outstandingMinor: kz(850_000), otherMonthlyDeductionsMinor: kz(60_000) });
    expect(owing.maxAmountMinor).toBe(kz(50_000));
    expect(owing.maxInstallmentMinor).toBe(kz(7_500));
    expect(owing.problems).toHaveLength(2);
  });
});
