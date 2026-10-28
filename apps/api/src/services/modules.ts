import { defaultModelingSector, moduleAccess, luandaDate, type CompanyModulesOverview, type FinancialSector, type PlatformModule, type SubscriptionStatus } from '@kianda/core';
import { and, companies, companyModules, eq, modelingMembers, type Db } from '@kianda/db';
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

/** O catálogo comum mostra os dois módulos sem conceder a licença nem um lugar de utilizador. */
export async function companyModulesOverview(db: Db, companyId: string, userId: string, role: string): Promise<CompanyModulesOverview> {
  const grants = await db.select().from(companyModules).where(eq(companyModules.companyId, companyId));
  const hrGrant = grants.find(g => g.module === 'hr');
  const modelingGrant = grants.find(g => g.module === 'modeling');
  const hr = await licenceOf(db, companyId);
  const hrAccess = hrGrant?.enabled === false ? moduleAccess(null, luandaDate(new Date())) : { subscribed: true, status: hr.status, canRead: true, canWrite: hr.canWrite };
  const modeling = moduleAccess(modelingGrant ? { ...modelingGrant, status: modelingGrant.status as SubscriptionStatus } : null, luandaDate(new Date()));
  const [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, companyId), eq(modelingMembers.userId, userId)));
  const [company] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, companyId));
  return {
    hr: { ...hrAccess, canAccess: hrAccess.canRead, trialEndsAt: hr.sub?.trialEndsAt ?? null, paidUntil: hr.sub?.paidUntil ?? null },
    modeling: { ...modeling, canAccess: modeling.canRead && (member ? member.enabled : role === 'owner'), trialEndsAt: modelingGrant?.trialEndsAt ?? null, paidUntil: modelingGrant?.paidUntil ?? null, projectLimit: modelingGrant ? modelingGrant.projectLimit : 1, extraUsers: modelingGrant?.extraUsers ?? 0, userLimit: 5 + (modelingGrant?.extraUsers ?? 0), planKey: modelingGrant?.planKey ?? null, cycle: modelingGrant?.cycle ?? null, primarySector: modelingGrant?.primarySector as FinancialSector || defaultModelingSector(company?.sector), sectors: modelingGrant?.modelingSectors ?? [] },
  };
}
