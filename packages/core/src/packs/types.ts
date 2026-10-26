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
  /** Férias e licenças (LGT). Limites em dias úteis, excepto onde indicado. */
  leave: {
    /** No ano de admissão: dias por cada mês completo de serviço (limitado a vacationWorkingDays). */
    firstYearDaysPerMonth: number;
    /** Meses de serviço antes de poder gozar férias. */
    vacationMinServiceMonths: number;
    marriageWorkingDays: number;
    bereavementWorkingDays: number;
    paternityWorkingDays: number;
    paternityPaid: boolean;
    maternityCalendarDays: number;
  };
  /** Cessação do contrato (LGT): avisos prévios em dias de calendário e compensações. */
  termination: {
    resignationNoticeDays: number;
    objectiveDismissalNoticeDays: number;
    collectiveDismissalNoticeDays: number;
    fixedTermNoticeDays: number;
    /** Falta do aviso de não renovação do contrato a termo: compensação em dias de salário. */
    fixedTermMissingNoticeDays: number;
    /** Despedimento por causas objectivas/colectivo: 1 salário base por ano até este número de anos… */
    compensationFullYears: number;
    /** …e esta percentagem (bps) do salário base por cada ano além desse limite. */
    compensationExtraYearBps: number;
    /** Rescisão pelo trabalhador com justa causa: percentagem (bps) do salário base por ano de antiguidade. */
    justCauseYearBps: number;
  };
  deadlines: { inssDayOfNextMonth: number; irtEndOfNextMonth: boolean };
  holidays: readonly Holiday[];
  sources: readonly { title: string; url?: string }[];
  /** Pontos assinalados para validação jurídica antes de uso em produção. */
  toValidate: readonly string[];
}
