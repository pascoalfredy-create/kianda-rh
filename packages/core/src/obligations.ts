/**
 * Obrigações de um processamento fechado (salários, INSS, IRT): valores, prazos e estado.
 * Exportações em CSV compatível com o Excel em português (separador ";", vírgula decimal, UTF-8 com BOM).
 */
import { daysBetween, lastDayOfMonth, payrollDeadlines } from './calendar.js';
import type { Minor } from './money.js';
import type { CountryPack } from './packs/types.js';

export type ObligationKind = 'salaries' | 'inss' | 'irt';
export type ObligationStatus = 'paid' | 'overdue' | 'due_soon' | 'open';

export interface PayrollObligation {
  kind: ObligationKind;
  label: string;
  amountMinor: Minor;
  dueDate: string;
  paidAt: string | null;
  status: ObligationStatus;
  /** Dias até ao prazo (negativo = em atraso). */
  daysLeft: number;
}

export const OBLIGATION_LABEL: Record<ObligationKind, string> = {
  salaries: 'Salários líquidos',
  inss: 'Segurança Social (INSS)',
  irt: 'IRT retido (Grupo A)',
};

export function obligationStatus(dueDate: string, paidAt: string | null, today: string, soonDays = 7): { status: ObligationStatus; daysLeft: number } {
  const daysLeft = daysBetween(today, dueDate);
  if (paidAt) return { status: 'paid', daysLeft };
  if (daysLeft < 0) return { status: 'overdue', daysLeft };
  return { status: daysLeft <= soonDays ? 'due_soon' : 'open', daysLeft };
}

/** Salários até ao último dia do mês processado; INSS até ao dia do pacote do mês seguinte; IRT até ao fim do mês seguinte. */
export function payrollObligations(input: {
  period: string;
  pack: CountryPack;
  netMinor: Minor;
  irtMinor: Minor;
  inssEmployeeMinor: Minor;
  inssEmployerMinor: Minor;
  paid: Partial<Record<ObligationKind, string | null>>;
  today: string;
}): PayrollObligation[] {
  const d = payrollDeadlines(input.period, input.pack);
  const items: [ObligationKind, Minor, string][] = [
    ['salaries', input.netMinor, lastDayOfMonth(input.period)],
    ['inss', input.inssEmployeeMinor + input.inssEmployerMinor, d.inss],
    ['irt', input.irtMinor, d.irt],
  ];
  return items.map(([kind, amountMinor, dueDate]) => {
    const paidAt = input.paid[kind] ?? null;
    return { kind, label: OBLIGATION_LABEL[kind], amountMinor, dueDate, paidAt, ...obligationStatus(dueDate, paidAt, input.today) };
  });
}

/** Valor em kwanzas com vírgula decimal e sem separador de milhares (para CSV). */
export function csvMoney(minor: Minor): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** CSV para Excel (pt): BOM UTF-8, ";" como separador, aspas quando necessário, CRLF. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
