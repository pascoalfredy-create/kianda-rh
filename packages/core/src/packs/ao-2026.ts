import { kz } from '../money.js';
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
  deadlines: { inssDayOfNextMonth: 10, irtEndOfNextMonth: true },
  holidays: [
    { date: '2026-01-01', name: 'Dia do Ano Novo' },
    { date: '2026-02-04', name: 'Dia do Início da Luta Armada' },
    { date: '2026-02-17', name: 'Carnaval' },
    { date: '2026-03-08', name: 'Dia Internacional da Mulher' },
    { date: '2026-03-23', name: 'Dia da Libertação da África Austral' },
    { date: '2026-04-03', name: 'Sexta-feira Santa' },
    { date: '2026-04-04', name: 'Dia da Paz e Reconciliação' },
    { date: '2026-05-01', name: 'Dia Internacional do Trabalhador' },
    { date: '2026-09-17', name: 'Dia do Fundador da Nação e do Herói Nacional' },
    { date: '2026-11-02', name: 'Dia dos Finados' },
    { date: '2026-11-11', name: 'Dia da Independência Nacional' },
    { date: '2026-12-25', name: 'Dia de Natal e da Família' },
  ],
  sources: [
    { title: 'Lei n.º 14/25 — OGE 2026, Anexo I (tabela IRT Grupo A, isenção até 150 000 Kz)' },
    { title: 'Lei n.º 12/23 — Lei Geral do Trabalho' },
    { title: 'Decreto Presidencial do Salário Mínimo Nacional (100 000 Kz desde Set. 2025)' },
    { title: 'Decreto Presidencial n.º 227/18 — regime de contribuições INSS' },
  ],
  toValidate: [
    'Subsídio de férias fora da base do INSS (DP 227/18) e subsídio de Natal dentro — confirmar com consultor',
    'Limite de 30 h/mês para o acréscimo de 50% nas horas extra',
    'Período experimental de 60 dias (contratos por tempo indeterminado)',
    'Calendário de feriados: confirmar pontes e alterações publicadas',
  ],
};
