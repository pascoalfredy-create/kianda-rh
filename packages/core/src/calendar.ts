import type { CountryPack } from './packs/index.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parse(d: string): Date {
  if (!ISO.test(d)) throw new RangeError(`data inválida: ${d}`);
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isWeekend(date: string): boolean {
  const w = parse(date).getUTCDay();
  return w === 0 || w === 6;
}

export function holidayName(date: string, packs: CountryPack[]): string | undefined {
  for (const p of packs) {
    const h = p.holidays.find((x) => x.date === date);
    if (h) return h.name;
  }
  return undefined;
}

/** Dias úteis entre duas datas (inclusive), excluindo fins-de-semana e feriados dos pacotes indicados. */
export function businessDays(from: string, to: string, packs: CountryPack[]): number {
  const a = parse(from), b = parse(to);
  if (b < a) throw new RangeError('a data de fim é anterior à de início');
  let n = 0;
  for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = iso(d);
    if (!isWeekend(s) && !holidayName(s, packs)) n++;
  }
  return n;
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export function lastDayOfMonth(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m, 0)));
}

/** Prazos legais das obrigações de um mês de processamento. */
export function payrollDeadlines(period: string, pack: CountryPack): { inss: string; irt: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const inss = iso(new Date(Date.UTC(y, m, pack.deadlines.inssDayOfNextMonth)));
  const irt = iso(new Date(Date.UTC(y, m + 1, 0)));
  return { inss, irt };
}

export interface ContractAlert {
  kind: 'fixed-term-ending' | 'fixed-term-expired' | 'probation';
  daysLeft: number;
  message: string;
}

/** Alertas de contrato: fim de contrato a termo (janela configurável) e período experimental. */
export function contractAlerts(
  c: { startDate: string; endDate?: string | null; type: 'indefinite' | 'fixed-term' | 'internship' },
  today: string,
  pack: CountryPack,
  windowDays = 60,
): ContractAlert[] {
  const out: ContractAlert[] = [];
  if (c.endDate) {
    const left = daysBetween(today, c.endDate);
    if (left < 0) out.push({ kind: 'fixed-term-expired', daysLeft: left, message: `Contrato expirou há ${-left} dia(s)` });
    else if (left <= windowDays) out.push({ kind: 'fixed-term-ending', daysLeft: left, message: `Contrato termina em ${left} dia(s)` });
  }
  if (c.type === 'indefinite') {
    const elapsed = daysBetween(c.startDate, today);
    const p = pack.labour.probationDaysIndefinite;
    if (elapsed >= 0 && elapsed < p) out.push({ kind: 'probation', daysLeft: p - elapsed, message: `Período experimental: faltam ${p - elapsed} dia(s)` });
  }
  return out;
}
