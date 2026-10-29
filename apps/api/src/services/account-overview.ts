import { and, companies, companyModules, eq, modelingMembers, sql, subscriptions, type Db } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';
import { licenceFromRows } from './licence.js';
import { companyModulesOverview } from './modules.js';
import { notificationColumns } from './notification-counts.js';

/** Uma leitura para a estrutura autenticada, sem transferir a imagem do logotipo ou contar efectivos. */
export async function accountOverview(db: Db, actor: Actor) {
  const rows = await db.select({
    company: { id: companies.id, name: companies.name, nif: companies.nif, code: companies.code, hasLogo: sql<boolean>`coalesce(length(${companies.logoDataUrl}), 0) > 0` },
    sector: companies.sector, sub: subscriptions, grant: companyModules, memberEnabled: modelingMembers.enabled,
    platformAdmin: sql<boolean>`exists(select 1 from users u join platform_admins p on p.email = lower(u.email) where u.id = ${actor.actorId} and u.company_id = ${actor.companyId})`,
    ...notificationColumns(actor),
  }).from(companies)
    .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
    .leftJoin(companyModules, eq(companyModules.companyId, companies.id))
    .leftJoin(modelingMembers, and(eq(modelingMembers.companyId, companies.id), eq(modelingMembers.userId, actor.actorId)))
    .where(eq(companies.id, actor.companyId));
  const first = rows[0], licence = licenceFromRows(first?.sub ?? null, 0);
  const modules = await companyModulesOverview(db, actor.companyId, actor.actorId, actor.role, {
    licence, sector: first?.sector ?? null, grants: rows.flatMap(r => r.grant ? [r.grant] : []),
    member: first?.memberEnabled == null ? null : { enabled: first.memberEnabled },
  });
  return { company: first?.company ?? null,
    licence: { status: licence.status, label: licence.statusLabel, canWrite: licence.canWrite, trialEndsAt: licence.sub?.trialEndsAt ?? null, paidUntil: licence.sub?.paidUntil ?? null },
    modules, platformAdmin: first?.platformAdmin ?? false,
    notifications: modules.hr.canAccess ? { absences: first?.absences ?? 0, expenses: first?.expenses ?? 0 } : { absences: 0, expenses: 0 },
  };
}
