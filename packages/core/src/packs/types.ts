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
    /** Período experimental máximo nos contratos por tempo determinado (por acordo escrito). */
    probationDaysFixedTerm: number;
    overtime: { tier1MaxHoursPerMonth: number; tier1Bps: number; tier2Bps: number };
    holidaySubsidyBps: number;
    christmasSubsidyBps: number;
    dailyRateDivisor: number;
    /** Período normal diário (art. 148.º) — base do desconto de faltas e do dia de feriado (valor-hora × horas). */
    dailyHours: number;
    /** Semana alargada em turnos/horário modulado (art. 148.º, n.º 2). */
    extendedWeeklyHours: number;
    /** Limites do trabalho extraordinário (art. 185.º). */
    overtimeLimits: { perDay: number; perMonth: number; perYear: number };
    /** Trabalho em dia de descanso semanal: adicional (bps) e mínimo de horas pagas (art. 194.º). */
    restDayWork: { extraBps: number; minHours: number };
    /** Trabalho em feriado: dias de salário a acrescer por feriado trabalhado (art. 200.º, n.º 2; não se aplica a turnos). */
    holidayWorkExtraDays: number;
    /** Turnos rotativos: adicional sobre o salário base (art. 162.º) — inclui o nocturno. */
    rotatingShiftBps: number;
    /** Trabalho nocturno (20h–6h): adicional sobre o salário base (art. 182.º). */
    nightWorkBps: number;
    /** Adiantamentos: total até N salários base; descontos (adiantamentos, empréstimos, bens a crédito) até X% do líquido (art. 248.º, n.º 6 e 7). */
    advances: { maxBaseSalaries: number; maxNetShareBps: number };
    /** 24 e 31 de Dezembro: o trabalho pára às 12h30 (art. 199.º) — minutos previstos nesses dias (08h00–12h30). */
    familyEveMinutes: number;
    /** Faltas injustificadas que constituem infracção disciplinar (art. 230.º). */
    unjustifiedDisciplinary: { perMonth: number; perYear: number };
  };
  /** Férias e licenças (LGT). Limites em dias úteis, excepto onde indicado. */
  leave: {
    /** No ano de admissão: dias por cada mês completo de serviço (limitado a vacationWorkingDays). */
    firstYearDaysPerMonth: number;
    /** Meses de serviço antes de poder gozar férias. */
    vacationMinServiceMonths: number;
    /** Férias do ano de admissão: mínimo de dias úteis (art. 204.º, n.º 2). */
    firstYearMinDays: number;
    /** Casamento: dias seguidos de calendário (art. 222.º, n.º 1, a). */
    marriageCalendarDays: number;
    /** Luto: cônjuge/companheiro, pais, filhos, irmãos e agregado (art. 223.º, n.º 1, a)… */
    bereavementWorkingDays: number;
    /** …avós, netos, tios, primos, sobrinhos, sogros, genros e noras (art. 223.º, n.º 1, b). */
    bereavementOtherWorkingDays: number;
    /** Paternidade: dias pagos + dias úteis complementares não remunerados (art. 218.º). */
    paternityPaidDays: number;
    paternityUnpaidWorkingDays: number;
    maternityCalendarDays: number;
    /** Parto múltiplo: dias a acrescer (art. 31.º, n.º 2). */
    maternityMultipleExtraDays: number;
    /** Licença complementar de maternidade, não remunerada (art. 34.º). */
    maternityComplementaryDays: number;
    /** Faltas pagas com limite: obrigações legais (mês/ano), assistência à família (ano), consultas pré/pós-natal (mês) — arts. 224.º, 226.º e 229.º. */
    legalObligationsPaid: { perMonth: number; perYear: number };
    familyAssistancePaidDays: number;
    prenatalDaysPerMonth: number;
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
    /** …com o mínimo de N salários base (art. 310.º, n.º 3). */
    justCauseMinBaseSalaries: number;
    /** Caducidade por morte/reforma/insolvência/extinção do empregador: bps do salário base por ano (art. 307.º). */
    employerExtinctionYearBps: number;
    /** Antiguidade: fracção de ano igual ou superior a N meses conta como um ano (art. 311.º). */
    seniorityFractionMonths: number;
    /** Dispensa remunerada para procurar emprego durante o aviso prévio (art. 287.º). */
    noticeJobSearchDays: number;
    /** Prazo para pagar salário, indemnização e créditos após a cessação (art. 245.º, n.º 4). */
    settlementPaymentDays: number;
  };
  deadlines: { inssDayOfNextMonth: number; irtEndOfNextMonth: boolean };
  holidays: readonly Holiday[];
  sources: readonly { title: string; url?: string }[];
  /** Pontos assinalados para validação jurídica antes de uso em produção. */
  toValidate: readonly string[];
  /** Regras confirmadas no texto legal, com o artigo. */
  confirmed?: readonly string[];
}
