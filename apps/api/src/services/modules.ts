import { moduleAccess, luandaDate, type PlatformModule, type SubscriptionStatus } from '@kianda/core';
import { and, companyModules, eq, type Db } from '@kianda/db';
import { licenceOf } from './licence.js';

export async function moduleLicence(db: Db, companyId: string, module: PlatformModule) {
  const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, module)));
  if (module === 'hr') {
    // O pagamento RH continua exclusivamente em subscriptions (sem duplicar calendários).
    if (grant && !grant.enabled) return moduleAccess(null, luandaDate(new Date()));
    const l = await licenceOf(db, companyId);
    return { subscribed: true, status: l.status, canRead: true, canWrite: l.canWrite };
  }
  return moduleAccess(grant ? { ...grant, status: grant.status as SubscriptionStatus } : null, luandaDate(new Date()));
}
