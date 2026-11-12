import { describe, expect, it } from 'vitest';
import { estimateMaternityBenefit, kz } from '../src/index.js';

describe('estimativa de subsídio de maternidade', () => {
  const declared = Array.from({ length: 12 }, (_, index) => kz(index < 6 ? 250_000 : 350_000));

  it('calcula três vezes a média e separa a diferença a cargo da empresa', () => {
    const input = { contributionMonths: 12, declaredRegularRemunerations: declared };
    expect(estimateMaternityBenefit({ ...input, employerTargetMinor: kz(960_000) })).toEqual({
      meetsContributionRequirement: true, statutoryMinor: kz(900_000), employerSupplementMinor: kz(60_000),
    });
    expect(estimateMaternityBenefit({ ...input, employerTargetMinor: kz(750_000) })).toMatchObject({
      statutoryMinor: kz(900_000), employerSupplementMinor: 0,
    });
  });

  it('distingue garantia contributiva insuficiente de histórico declarado em falta', () => {
    expect(estimateMaternityBenefit({ contributionMonths: 11, declaredRegularRemunerations: [], employerTargetMinor: kz(750_000) })).toEqual({
      meetsContributionRequirement: false, statutoryMinor: 0, employerSupplementMinor: kz(750_000),
    });
    expect(() => estimateMaternityBenefit({ contributionMonths: 12, declaredRegularRemunerations: declared.slice(1) })).toThrow(/últimas 12/);
  });
});
