import {
  canWrite, cyclePrice, CYCLES, DEFAULT_TIERS, LEGACY_CUSTOM_TIER, effectiveStatus, employeeLimit, luandaDate, SUBSCRIPTION_STATUS, tierFor,
  type BillingCycle, type SubscriptionStatus, type Tier,
} from '@kianda/core';
import { and, auditLogs, eq, employees, platformSettings, sql, subscriptions, type Db } from '@kianda/db';

export interface PlatformSettings { bank: { holder: string; bankName: string; iban: string } | null; supportEmail: string | null; supportPhone: string | null }
const DEFAULT_SETTINGS: PlatformSettings = { bank: null, supportEmail: null, supportPhone: null };

export async function platformSettingsGet(db: Db): Promise<PlatformSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'commercial'));
  const v = (row?.value as Partial<PlatformSettings> & { supportContact?: string | null }) ?? {};
  const { supportContact, ...rest } = v;
  // Compatibilidade: o antigo campo único passa para o email (se tiver @) ou para o telefone.
  const legacy = supportContact ? (supportContact.includes('@') ? { supportEmail: supportContact } : { supportPhone: supportContact }) : {};
  // Só devolve parâmetros actuais; preços extra antigos no JSON deixam de ser expostos.
  const { bank, supportEmail, supportPhone } = { ...DEFAULT_SETTINGS, ...legacy, ...rest };
  return { bank, supportEmail, supportPhone };
}

/** Escalão efectivo (o "à medida" usa o limite e o preço negociados). */
export function tierOf(sub: typeof subscriptions.$inferSelect): Tier {
  const base = sub.tierKey === 'custom' ? LEGACY_CUSTOM_TIER : DEFAULT_TIERS.find((t) => t.key === sub.tierKey) ?? DEFAULT_TIERS[0]!;
  if (base.key !== 'custom') return base;
  return { ...base, maxEmployees: sub.customMaxEmployees ?? null, monthlyMinor: sub.customMonthlyMinor ?? null };
}

/** Licença da empresa: estado efectivo hoje, escalão, limite e colaboradores activos. */
export async function licenceOf(db: Db, companyId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId));
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.companyId, companyId), eq(employees.status, 'active')));
  return licenceFromRows(sub ?? null, n?.n ?? 0);
}

export function licenceFromRows(sub: typeof subscriptions.$inferSelect | null, activeEmployees: number) {
  const today = luandaDate(new Date());
  if (!sub) {
    // Empresas sem registo de licença (não deveria acontecer depois da migração 0015): tratadas como activas.
    return { sub: null, status: 'active' as SubscriptionStatus, statusLabel: SUBSCRIPTION_STATUS.active, tier: DEFAULT_TIERS[0]!, limit: null as number | null, activeEmployees, canWrite: true, cycle: 'monthly' as BillingCycle };
  }
  const status = effectiveStatus({ status: sub.status as SubscriptionStatus, trialEndsAt: sub.trialEndsAt, paidUntil: sub.paidUntil }, today);
  const tier = tierOf(sub);
  return {
    sub, status, statusLabel: SUBSCRIPTION_STATUS[status], tier, limit: employeeLimit(tier), activeEmployees,
    canWrite: canWrite(status), cycle: sub.cycle as BillingCycle,
  };
}

/** Tabela de preços por escalão e ciclo (para a página de licença e a consola). */
export function priceTable() {
  return DEFAULT_TIERS.map((t) => ({ ...t, prices: Object.fromEntries((Object.keys(CYCLES) as BillingCycle[]).map((c) => [c, cyclePrice(t, c)])) }));
}

/** Rotas que continuam disponíveis com a licença em só leitura (tratar da licença, sessão). */
const ALWAYS = ['/v1/billing'];

/** Bloqueia escritas quando a licença não está activa. */
export async function licenceBlocks(db: Db, companyId: string, method: string, path: string): Promise<string | null> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method) || ALWAYS.some((p) => path.startsWith(p))) return null;
  const l = await licenceOf(db, companyId);
  if (l.canWrite) return null;
  return l.status === 'trial' || l.sub?.trialEndsAt && !l.sub.paidUntil
    ? 'O período experimental terminou. A conta está em modo de consulta até regularizar a licença (menu Licença).'
    : `Licença ${l.statusLabel.toLowerCase()}: a conta está em modo de consulta até regularizar o pagamento (menu Licença).`;
}

/**
 * Capacidade de colaboradores activos. Em avaliação gratuita, a faixa acompanha a equipa real (sobe
 * automaticamente, sem bloquear a experiência de empresas com mais de 100 pessoas); com licença paga,
 * o limite da faixa contratada mantém-se e a mudança faz-se em Módulos e licenças.
 */
export async function ensureEmployeeCapacity(db: Db, companyId: string, adding: number, actorId?: string): Promise<{ ok: true; tierChanged?: string } | { ok: false; limit: number; activeEmployees: number }> {
  const lic = await licenceOf(db, companyId);
  if (lic.limit === null || lic.activeEmployees + adding <= lic.limit) return { ok: true };
  if (lic.status === 'trial' && lic.sub && lic.sub.tierKey !== 'custom') {
    const tier = tierFor(lic.activeEmployees + adding);
    await db.update(subscriptions).set({ tierKey: tier.key }).where(eq(subscriptions.companyId, companyId));
    await db.insert(auditLogs).values({ companyId, actorId: actorId ?? 'sistema', action: 'trial_tier_adjusted', entity: 'subscription', entityId: companyId, before: { tierKey: lic.sub.tierKey }, after: { tierKey: tier.key, activeEmployees: lic.activeEmployees + adding } });
    return { ok: true, tierChanged: tier.label };
  }
  return { ok: false, limit: lic.limit, activeEmployees: lic.activeEmployees };
}

