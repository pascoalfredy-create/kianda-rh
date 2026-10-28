import { and, eq, isNull, sql } from 'drizzle-orm';
import { auditLogs, companies, companyModules, modelingMembers, platformAdmins, users } from './schema.js';
import type { Db } from './index.js';

/** Acompanhamento do produto pelo único administrador configurado, sem conceder licenças aos clientes. */
export async function provisionModelingReview(db: Db, configuredAdmins: string) {
  const emails = [...new Set(configuredAdmins.split(/[,;\s]+/).map(v => v.trim().toLowerCase()).filter(Boolean))];
  if (emails.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emails[0]!)) return { status: 'skipped', reason: 'configuration' } as const;
  const matches = await db.select({ id: users.id, companyId: users.companyId }).from(users)
    .innerJoin(platformAdmins, eq(users.email, platformAdmins.email))
    .where(and(eq(users.email, emails[0]!), eq(users.role, 'owner'), isNull(users.disabledAt))).limit(2);
  if (matches.length !== 1) return { status: 'skipped', reason: 'account' } as const;
  const actor = matches[0]!;
  return db.transaction(async tx => {
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const [existing] = await tx.select().from(companyModules).where(and(eq(companyModules.companyId, actor.companyId), eq(companyModules.module, 'modeling')));
    // Não reactiva suspensões nem altera quotas que já tenham sido decididas na plataforma.
    if (existing) return { status: 'preserved', companyId: actor.companyId, userId: actor.id, projectLimit: existing.projectLimit } as const;
    const [member] = await tx.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, actor.companyId), eq(modelingMembers.userId, actor.id)));
    if (member && (!member.enabled || member.permission !== 'editor')) return { status: 'skipped', reason: 'member_permission' } as const;
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(modelingMembers).where(and(eq(modelingMembers.companyId, actor.companyId), eq(modelingMembers.enabled, true)));
    if (!member && (count?.n ?? 0) >= 5) return { status: 'skipped', reason: 'capacity' } as const;
    const [grant] = await tx.insert(companyModules).values({ companyId: actor.companyId, module: 'modeling', enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: 20, extraUsers: 0 }).returning();
    if (!member) await tx.insert(modelingMembers).values({ companyId: actor.companyId, userId: actor.id, addedBy: actor.id, permission: 'editor' });
    await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.id, action: 'module_subscription', entity: 'company_module', entityId: grant!.id, before: null, after: { ...grant, purpose: 'product_owner_review', includedUsers: 5, invoiced: false } });
    return { status: 'created', companyId: actor.companyId, userId: actor.id, projectLimit: grant!.projectLimit } as const;
  });
}
