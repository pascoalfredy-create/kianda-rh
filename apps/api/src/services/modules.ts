import { defaultModelingSector, moduleAccess, luandaDate, type CompanyModulesOverview, type FinancialSector, type PlatformModule, type SubscriptionStatus } from '@kianda/core';
import { and, companies, subscriptions, companyModules, eq, modelingMembers, type Db } from '@kianda/db';
import { licenceOf } from './licence.js';

export async function moduleLicence(db: Db, companyId: string, module: PlatformModule) {
  if (module === 'hr') {
    // A autorização só precisa do estado da licença, não da contagem de efectivos.
    const [row] = await db.select({ enabled: companyModules.enabled, status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt, paidUntil: subscriptions.paidUntil }).from(companies)
      .leftJoin(companyModules, and(eq(companyModules.companyId, companies.id), eq(companyModules.module, 'hr')))
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id)).where(eq(companies.id, companyId));
    if (row?.enabled === false) return moduleAccess(null, luandaDate(new Date()));
    return moduleAccess({ enabled: true, status: (row?.status ?? 'active') as SubscriptionStatus, trialEndsAt: row?.trialEndsAt ?? null, paidUntil: row?.paidUntil ?? null }, luandaDate(new Date()));
  }
  const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, module)));
  return moduleAccess(grant ? { ...grant, status: grant.status as SubscriptionStatus } : null, luandaDate(new Date()));
}

/** O catálogo comum mostra os dois módulos sem conceder a licença nem um lugar de utilizador. */
export async function companyModulesOverview(db: Db, companyId: string, userId: string, role: string, loaded?: { licence: Awaited<ReturnType<typeof licenceOf>>; sector: string | null }): Promise<CompanyModulesOverview> {
  const grants = await db.select().from(companyModules).where(eq(companyModules.companyId, companyId));
  const hrGrant = grants.find(g => g.module === 'hr');
  const modelingGrant = grants.find(g => g.module === 'modeling');
  const hr = loaded?.licence ?? await licenceOf(db, companyId);
  const hrAccess = hrGrant?.enabled === false ? moduleAccess(null, luandaDate(new Date())) : { subscribed: true, status: hr.status, canRead: true, canWrite: hr.canWrite };
  const modeling = moduleAccess(modelingGrant ? { ...modelingGrant, status: modelingGrant.status as SubscriptionStatus } : null, luandaDate(new Date()));
  const [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, companyId), eq(modelingMembers.userId, userId)));
  const company = loaded ? { sector: loaded.sector } : (await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, companyId)))[0];
  return {
    hr: { ...hrAccess, canAccess: hrAccess.canRead, trialEndsAt: hr.sub?.trialEndsAt ?? null, paidUntil: hr.sub?.paidUntil ?? null },
    modeling: { ...modeling, canAccess: modeling.canRead && (member ? member.enabled : role === 'owner'), trialEndsAt: modelingGrant?.trialEndsAt ?? null, paidUntil: modelingGrant?.paidUntil ?? null, projectLimit: modelingGrant ? modelingGrant.projectLimit : 1, extraUsers: modelingGrant?.extraUsers ?? 0, userLimit: 5 + (modelingGrant?.extraUsers ?? 0), planKey: modelingGrant?.planKey ?? null, cycle: modelingGrant?.cycle ?? null, primarySector: modelingGrant?.primarySector as FinancialSector || defaultModelingSector(company?.sector), sectors: modelingGrant?.modelingSectors ?? [] },
  };
}
