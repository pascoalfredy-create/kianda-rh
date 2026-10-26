import { kz } from '../money.js';
import { angolaHolidays } from '../holidays.js';
import type { CountryPack, IrtBracket } from './types.js';

const b = (upper: number, fixed: number, ratePct: number, excessFrom: number): IrtBracket =>
  [upper === Infinity ? Number.MAX_SAFE_INTEGER : kz(upper), kz(fixed), Math.round(ratePct * 100), kz(excessFrom)] as const;

/** Angola 2026 — OGE 2026 (Lei n.º 14/25), LGT (Lei n.º 12/23), regime INSS. */
export const AO_2026: CountryPack = {
  country: 'AO',
  year: 2026,
  version: 'AO-2026.1',
  currency: 'AOA',
  irt: {
    brackets: [
      b(150_000, 0, 0, 0),
      b(200_000, 12_500, 16, 150_000),
      b(300_000, 31_250, 18, 200_000),
      b(500_000, 49_250, 19, 300_000),
      b(1_000_000, 87_250, 20, 500_000),
      b(1_500_000, 187_250, 21, 1_000_000),
      b(2_000_000, 292_250, 22, 1_500_000),
      b(2_500_000, 402_250, 23, 2_000_000),
      b(5_000_000, 517_250, 24, 2_500_000),
      b(10_000_000, 1_117_250, 24.5, 5_000_000),
      b(Infinity, 2_342_250, 25, 10_000_000),
    ],
    allowanceExemptionMinor: kz(30_000),
  },
  inss: { employeeBps: 300, employerBps: 800, holidaySubsidyInBase: false, christmasSubsidyInBase: true },
  minimumWage: { generalMinor: kz(100_000), microStartupMinor: kz(50_000) },
  labour: {
    vacationWorkingDays: 22,
    weeklyHours: 44,
    probationDaysIndefinite: 60,
    overtime: { tier1MaxHoursPerMonth: 30, tier1Bps: 5000, tier2Bps: 7500 },
    holidaySubsidyBps: 5000,
    christmasSubsidyBps: 5000,
    dailyRateDivisor: 30,
  },
  leave: {
    firstYearDaysPerMonth: 2,
    vacationMinServiceMonths: 6,
    marriageWorkingDays: 10,
    bereavementWorkingDays: 8,
    paternityWorkingDays: 7,
    paternityPaid: false,
    maternityCalendarDays: 90,
  },
  deadlines: { inssDayOfNextMonth: 10, irtEndOfNextMonth: true },
  holidays: angolaHolidays(2026),
  sources: [
    { title: 'Lei n.º 14/25 — OGE 2026, Anexo I (tabela IRT Grupo A, isenção até 150 000 Kz)' },
    { title: 'Lei n.º 12/23 — Lei Geral do Trabalho' },
    { title: 'Decreto Presidencial do Salário Mínimo Nacional (100 000 Kz desde Set. 2025)' },
    { title: 'Decreto Presidencial n.º 227/18 — regime de contribuições INSS' },
  ],
  toValidate: [
    'Contas PGC sugeridas para despesas do pessoal (75.2), ajudas de custo (72.8) e reembolsos a pagar (36.9) — confirmar com o plano de contas de cada empresa',
    'Ajudas de custo fora do IRT e do INSS até ao limite da diária fixada pela empresa — confirmar o limite legal aplicável (referência: diárias da função pública)',
    'Contas PGC sugeridas para INSS a pagar (34.9.1) e remunerações a pagar (36.1.2) — confirmar com o plano de contas de cada empresa',
    'Subsídio de férias fora da base do INSS (DP 227/18) e subsídio de Natal dentro — confirmar com consultor',
    'Limite de 30 h/mês para o acréscimo de 50% nas horas extra',
    'Período experimental de 60 dias (contratos por tempo indeterminado)',
    'Calendário de feriados: confirmar pontes e alterações publicadas',
    'Férias no ano de admissão: 2 dias úteis por mês completo, gozo só após 6 meses de serviço',
    'Faltas justificadas: casamento 10 dias úteis; luto até 8 dias úteis (cônjuge, pais, filhos; 4 para outros familiares)',
    'Licença de paternidade de 7 dias úteis não remunerada e licença de maternidade de 90 dias (Lei n.º 12/23)',
    'Prazo de pagamento dos salários: último dia do mês processado (confirmar com o contrato/regulamento interno)',
    'Formatos oficiais de entrega: mapa de remunerações da AGT, folha do INSS e ficheiro de pagamentos do banco (hoje CSV genérico)',
    'Momento de pagamento dos subsídios: Natal no mês definido pela empresa (Dezembro por omissão); férias no mês das primeiras férias aprovadas (Dezembro como último recurso)',
    'Subsídios no ano de admissão: Natal pro rata do tempo de serviço; férias na proporção dos dias de férias a que tem direito',
    'Trabalho em dia de descanso semanal e em feriado: acréscimo próprio e descanso compensatório (hoje pago como hora extra normal e assinalado ao RH)',
  ],
};
