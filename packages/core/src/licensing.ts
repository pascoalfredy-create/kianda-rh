import { kz, type Minor } from './money.js';

/**
 * Licenciamento da plataforma: escalões por número de colaboradores activos, ciclos de pagamento com desconto,
 * faixas fixas e estado da subscrição.
 */

export interface Tier { key: string; label: string; minEmployees: number; maxEmployees: number | null; monthlyMinor: Minor | null; cycleTotals?: Partial<Record<BillingCycle, Minor>> }

/** Tabela comercial de faixas fixas (Kz/mês). A última faixa não tem limite de colaboradores. */
export const DEFAULT_TIERS: Tier[] = [
  { key: 't1', label: '1 a 100 colaboradores', minEmployees: 0, maxEmployees: 100, monthlyMinor: kz(29_900) },
  { key: 't2', label: '101 a 250 colaboradores', minEmployees: 101, maxEmployees: 250, monthlyMinor: kz(49_900) },
  { key: 't3', label: '251 a 500 colaboradores', minEmployees: 251, maxEmployees: 500, monthlyMinor: kz(69_900) },
  { key: 't4', label: '501 a 1 000 colaboradores', minEmployees: 501, maxEmployees: 1000, monthlyMinor: kz(89_900) },
  { key: 't5', label: 'Mais de 1 000 colaboradores', minEmployees: 1001, maxEmployees: null, monthlyMinor: kz(99_999) },
];
/** Contratos personalizados anteriores continuam válidos, sem os oferecer na tabela pública. */
export const LEGACY_CUSTOM_TIER: Tier = { key: 'custom', label: 'Contrato personalizado', minEmployees: 0, maxEmployees: null, monthlyMinor: null };

export type BillingCycle = 'monthly' | 'semiannual' | 'annual';
export const CYCLES: Record<BillingCycle, { label: string; months: number; discountBps: number }> = {
  monthly: { label: 'Mensal', months: 1, discountBps: 0 },
  semiannual: { label: 'Semestral (−10%)', months: 6, discountBps: 1000 },
  annual: { label: 'Anual (−15%)', months: 12, discountBps: 1500 },
};

export const TRIAL_DAYS = 7;

const DAY_MS = 86_400_000;
function calendarDay(value: string): number {
  const time = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new RangeError('Data de calendário inválida.');
  return time;
}

/** Avaliação por dias de calendário de Angola: o registo é o dia 1 e o último dia está incluído. */
export function trialEndDate(registeredOn: string): string {
  return new Date(calendarDay(registeredOn) + (TRIAL_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Dias de calendário disponíveis, incluindo hoje; no último dia devolve 1, depois devolve 0. */
export function trialDaysRemaining(until: string, today: string): number {
  return Math.max(0, (calendarDay(until) - calendarDay(today)) / DAY_MS + 1);
}

export function tierFor(employees: number, tiers: Tier[] = DEFAULT_TIERS): Tier {
  return tiers.find((t) => employees >= t.minEmployees && (t.maxEmployees === null || employees <= t.maxEmployees)) ?? tiers[tiers.length - 1]!;
}

/** Valor de um período: mensal × meses, com o desconto do ciclo, arredondado ao kwanza. */
export function cyclePrice(tier: Tier, cycle: BillingCycle): { grossMinor: Minor; discountMinor: Minor; totalMinor: Minor } | null {
  if (tier.monthlyMinor === null) return null;
  const c = CYCLES[cycle];
  const gross = tier.monthlyMinor * c.months;
  const total = tier.cycleTotals?.[cycle] ?? Math.round((gross * (10_000 - c.discountBps)) / 10_000 / 100) * 100;
  return { grossMinor: gross, discountMinor: gross - total, totalMinor: total };
}

/** Fim do período: mesmo dia N meses depois, menos um dia (ex.: 15/01 mensal → 14/02). */
export function periodEnd(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)) - 86_400_000);
  return end.toISOString().slice(0, 10);
}

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, string> = {
  trial: 'Período experimental', active: 'Activa', past_due: 'Pagamento em atraso', suspended: 'Suspensa (só leitura)', cancelled: 'Cancelada',
};

/** Dias de tolerância depois do fim do período antes de passar a só leitura. */
export const GRACE_DAYS = 7;

/**
 * Estado efectivo numa data: o experimental e o período pago expiram sozinhos; depois do fim há tolerância
 * (pagamento em atraso, ainda com escrita) e a seguir só leitura. "Suspensa" e "cancelada" manuais prevalecem.
 */
export function effectiveStatus(s: { status: SubscriptionStatus; trialEndsAt: string | null; paidUntil: string | null }, today: string): SubscriptionStatus {
  if (s.status === 'suspended' || s.status === 'cancelled') return s.status;
  const until = s.paidUntil && (!s.trialEndsAt || s.paidUntil > s.trialEndsAt) ? s.paidUntil : null;
  if (until) {
    if (today <= until) return 'active';
    const days = (Date.parse(today) - Date.parse(until)) / 86_400_000;
    return days <= GRACE_DAYS ? 'past_due' : 'suspended';
  }
  if (s.trialEndsAt && today <= s.trialEndsAt) return 'trial';
  return 'suspended';
}

/** Pode escrever (criar/alterar)? A avaliação permite trabalhar; em só leitura mantém a consulta. */
export const canWrite = (status: SubscriptionStatus) => status === 'trial' || status === 'active' || status === 'past_due';

/** Documentos de negócio: avaliação e consulta só permitem pré-visualizar. O pagamento liberta a exportação. */
export const canExportDocuments = (status: SubscriptionStatus) => status === 'active' || status === 'past_due';

/** Limite de colaboradores activos da faixa, sem acréscimos por colaborador. */
export function employeeLimit(tier: Tier): number | null {
  return tier.maxEmployees;
}

export const SECTORS = {
  commerce: 'Comércio e distribuição', services: 'Serviços e consultoria', construction: 'Construção e obras públicas', security: 'Segurança privada',
  mining: 'Mineração', oil_gas: 'Petróleo e gás', manufacturing: 'Indústria transformadora', agriculture: 'Agricultura e pescas',
  hospitality: 'Hotelaria e restauração', health: 'Saúde', education: 'Educação', transport: 'Transportes e logística',
  finance: 'Banca e seguros', telecom: 'Tecnologia e telecomunicações', ngo: 'ONG e associações', public: 'Sector público e empresas públicas', other: 'Outro',
} as const;
export type Sector = keyof typeof SECTORS;
