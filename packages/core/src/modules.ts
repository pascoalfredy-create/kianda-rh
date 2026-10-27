import { canWrite, effectiveStatus, type SubscriptionStatus } from './licensing.js';

export const PLATFORM_MODULES = ['hr', 'modeling'] as const;
export type PlatformModule = typeof PLATFORM_MODULES[number];
export interface ModuleGrant {
  enabled: boolean; status: SubscriptionStatus; trialEndsAt: string | null; paidUntil: string | null;
}
/** Ausência de licença nunca concede Modelagem. RH conserva a licença existente. */
export function moduleAccess(grant: ModuleGrant | null, today: string) {
  if (!grant?.enabled) return { subscribed: false, status: 'cancelled' as SubscriptionStatus, canRead: false, canWrite: false };
  const status = effectiveStatus(grant, today);
  return { subscribed: true, status, canRead: true, canWrite: canWrite(status) };
}

/** Apenas domínios de negócio; sessão, utilizadores, definições e facturação são partilhados. */
export function moduleForPath(path: string): PlatformModule | null {
  if (/^\/v1\/modeling(?:\/|$)/.test(path)) return 'modeling';
  if (/^\/v1\/(auth|users|billing|platform|modules)(?:\/|$)/.test(path)) return null;
  if (/^\/v1\/company\/(branding|logo|export)$/.test(path)) return null;
  return 'hr';
}
