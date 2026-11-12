import type { CompanyModulesOverview } from '@kianda/core';
import { and, companies, companyModules, eq, modelingMembers, sql, subscriptions, valuationMembers, type Db } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';
import { licenceFromRows } from './licence.js';
import { companyModulesOverview } from './modules.js';
import { ackCountColumn, notificationColumns, taskCountColumn } from './notification-counts.js';

const unavailable = { subscribed: false, status: 'cancelled' as const, canRead: false, canWrite: false, canAccess: false, trialEndsAt: null, paidUntil: null };
const noModules: CompanyModulesOverview = {
  hr: unavailable,
  modeling: { ...unavailable, projectLimit: 0, extraUsers: 0, userLimit: 0, planKey: null, cycle: null, primarySector: null, sectors: [] },
  valuation: { ...unavailable, analysisLimit: 0, extraUsers: 0, userLimit: 0, planKey: null, cycle: null },
};

/** Uma leitura para a estrutura da empresa. A consola tem identidade própria e prescinde de licenças. */
export async function accountOverview(db: Db, actor: Actor) {
  if (actor.platformAdmin) return { company: null, licence: null, modules: noModules, platformAdmin: true };
  const rows = await db.select({
    company: { id: companies.id, name: companies.name, nif: companies.nif, code: companies.code, hasLogo: sql<boolean>`coalesce(length(${companies.logoDataUrl}), 0) > 0` },
    sector: companies.sector, sub: subscriptions, grant: companyModules, memberEnabled: modelingMembers.enabled, valuationMemberEnabled: valuationMembers.enabled,
    ...notificationColumns(actor), tasks: taskCountColumn(actor), acks: ackCountColumn(actor),
  }).from(companies)
    .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
    .leftJoin(companyModules, eq(companyModules.companyId, companies.id))
    .leftJoin(modelingMembers, and(eq(modelingMembers.companyId, companies.id), eq(modelingMembers.userId, actor.actorId)))
    .leftJoin(valuationMembers, and(eq(valuationMembers.companyId, companies.id), eq(valuationMembers.userId, actor.actorId)))
    .where(eq(companies.id, actor.companyId));
  const first = rows[0], licence = licenceFromRows(first?.sub ?? null, 0);
  const modules = await companyModulesOverview(db, actor.companyId, actor.actorId, actor.role, {
    licence, sector: first?.sector ?? null, grants: rows.flatMap(r => r.grant ? [r.grant] : []),
    member: first?.memberEnabled == null ? null : { enabled: first.memberEnabled },
    valuationMember: first?.valuationMemberEnabled == null ? null : { enabled: first.valuationMemberEnabled },
  });
  return { company: first?.company ?? null,
    licence: { status: licence.status, label: licence.statusLabel, canWrite: licence.canWrite, trialEndsAt: licence.sub?.trialEndsAt ?? null, paidUntil: licence.sub?.paidUntil ?? null },
    modules, platformAdmin: false,
    notifications: modules.hr.canAccess
      ? { absences: first?.absences ?? 0, expenses: first?.expenses ?? 0, tasks: first?.tasks ?? 0, acks: first?.acks ?? 0 }
      : { absences: 0, expenses: 0, tasks: 0, acks: 0 },
  };
}
