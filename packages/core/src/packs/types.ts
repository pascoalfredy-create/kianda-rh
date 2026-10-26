import type { Minor } from '../money.js';

/** [limite superior inclusivo, parcela fixa, taxa marginal em bps, limite inferior do excesso] — valores em cêntimos. */
export type IrtBracket = readonly [upper: Minor, fixed: Minor, rateBps: number, excessFrom: Minor];

export interface Holiday {
  date: string;
  name: string;
}

/**
 * Pacote de regras laborais e fiscais de um país para um ano civil.
 * Todas as regras legais vivem aqui, versionadas — o motor é genérico.
 */
export interface CountryPack {
  country: 'AO';
  year: number;
  version: string;
  currency: 'AOA';
  irt: { brackets: readonly IrtBracket[]; allowanceExemptionMinor: Minor };
  inss: { employeeBps: number; employerBps: number; holidaySubsidyInBase: boolean; christmasSubsidyInBase: boolean };
  minimumWage: { generalMinor: Minor; microStartupMinor: Minor };
  labour: {
    vacationWorkingDays: number;
    weeklyHours: number;
    probationDaysIndefinite: number;
    overtime: { tier1MaxHoursPerMonth: number; tier1Bps: number; tier2Bps: number };
    holidaySubsidyBps: number;
    christmasSubsidyBps: number;
    dailyRateDivisor: number;
  };
  deadlines: { inssDayOfNextMonth: number; irtEndOfNextMonth: boolean };
  holidays: readonly Holiday[];
  sources: readonly { title: string; url?: string }[];
  /** Pontos assinalados para validação jurídica antes de uso em produção. */
  toValidate: readonly string[];
}
