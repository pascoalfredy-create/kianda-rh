import { applyBps, prorate, sum, type Minor } from './money.js';
import type { CountryPack } from './packs/index.js';

export type TerminationReason = 'mutual-agreement' | 'fixed-term-expiry' | 'resignation' | 'disciplinary-dismissal' | 'objective-dismissal' | 'retirement';

export interface SettlementInput {
  terminationDate: string;
  baseMinor: Minor;
  monthlyAllowancesMinor: Minor;
  unusedVacationDays: number;
  /** Compensação acordada ou calculada fora do motor (depende do motivo e da antiguidade). */
  compensationMinor?: Minor;
  /** Subsídio de férias já pago no ano da cessação. */
  holidaySubsidyAlreadyPaid?: boolean;
}

export interface SettlementLine { code: string; name: string; basis: string; amountMinor: Minor }

/**
 * Créditos laborais no fecho de contas: remuneração do mês, férias não gozadas,
 * proporcionais de subsídio de férias e de Natal, e compensação.
 * A compensação legal por motivo NÃO é calculada aqui — depende de validação jurídica.
 */
export function finalSettlement(input: SettlementInput, pack: CountryPack): { lines: SettlementLine[]; totalMinor: Minor } {
  const month = Number(input.terminationDate.slice(5, 7));
  const lines: SettlementLine[] = [
    { code: 'SAL', name: 'Remuneração do mês da cessação', basis: 'Base + subsídios', amountMinor: input.baseMinor + input.monthlyAllowancesMinor },
    { code: 'FER', name: 'Férias vencidas e não gozadas', basis: `${input.unusedVacationDays} dia(s) úteis × base/22`, amountMinor: prorate(input.baseMinor, input.unusedVacationDays, 22) },
  ];
  if (!input.holidaySubsidyAlreadyPaid) {
    lines.push({ code: 'SUBFER', name: 'Subsídio de férias proporcional', basis: `${pack.labour.holidaySubsidyBps / 100}% × base × ${month}/12`, amountMinor: prorate(applyBps(input.baseMinor, pack.labour.holidaySubsidyBps), month, 12) });
  }
  lines.push({ code: 'SUBNAT', name: 'Subsídio de Natal proporcional', basis: `${pack.labour.christmasSubsidyBps / 100}% × base × ${month}/12`, amountMinor: prorate(applyBps(input.baseMinor, pack.labour.christmasSubsidyBps), month, 12) });
  if (input.compensationMinor) lines.push({ code: 'COMP', name: 'Compensação', basis: 'Acordada / apurada', amountMinor: input.compensationMinor });
  return { lines, totalMinor: sum(...lines.map((l) => l.amountMinor)) };
}
