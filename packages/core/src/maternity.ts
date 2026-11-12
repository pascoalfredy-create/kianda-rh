import { assertMinor, prorate, sum, type Minor } from './money.js';

/** DP n.º 95/26, arts. 8.º e 9.º. Regime geral de três meses. */
export function estimateMaternityBenefit(input: {
  contributionMonths: number;
  declaredRegularRemunerations: readonly Minor[];
  employerTargetMinor?: Minor;
}) {
  const { contributionMonths, declaredRegularRemunerations, employerTargetMinor = 0 } = input;
  if (!Number.isInteger(contributionMonths) || contributionMonths < 0 || contributionMonths > 36) {
    throw new RangeError('Indique o número de meses com contribuições nos últimos 36 meses.');
  }
  if (assertMinor(employerTargetMinor) < 0) throw new RangeError('Indique um valor de referência igual ou superior a zero.');
  if (contributionMonths < 12) {
    return { meetsContributionRequirement: false, statutoryMinor: 0, employerSupplementMinor: employerTargetMinor };
  }
  if (declaredRegularRemunerations.length !== 12 || declaredRegularRemunerations.some(value => assertMinor(value) <= 0)) {
    throw new RangeError('Indique as últimas 12 remunerações regulares declaradas antes da licença.');
  }
  const statutoryMinor = prorate(sum(...declaredRegularRemunerations), 3, 12);
  return {
    meetsContributionRequirement: true,
    statutoryMinor,
    employerSupplementMinor: Math.max(0, employerTargetMinor - statutoryMinor),
  };
}
