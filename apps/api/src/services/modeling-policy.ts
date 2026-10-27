import { canExportModeling, modelingCapacity } from '@kianda/core';
import { and, companies, companyModules, eq, financialModels, isNull, modelingMembers, sql, type Db } from '@kianda/db';
import { DomainError } from './payroll.js';
import { isPlatformAdmin } from './licence.js';

/** Serializa admissões e criação/restauro de projectos dentro da transacção da empresa. */
export async function lockModelingCompany(db: Db, companyId: string) {
  await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
}
export async function modelingUsage(db: Db, companyId: string) {
  const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, 'modeling')));
  const [projects] = await db.select({ n: sql<number>`count(*)::int` }).from(financialModels).where(and(eq(financialModels.companyId, companyId), isNull(financialModels.archivedAt)));
  const [members] = await db.select({ n: sql<number>`count(*)::int` }).from(modelingMembers).where(and(eq(modelingMembers.companyId, companyId), eq(modelingMembers.enabled, true)));
  return modelingCapacity({ projectLimit: grant?.projectLimit ?? 1, extraUsers: grant?.extraUsers ?? 0 }, projects?.n ?? 0, members?.n ?? 0);
}
export async function requireProjectCapacity(db: Db, companyId: string) {
  await lockModelingCompany(db, companyId);
  if (!(await modelingUsage(db, companyId)).canCreateProject) throw new DomainError('limite_projectos', 'Atingiu o número de projectos activos contratado. Arquive um projecto ou amplie a subscrição.', 409);
}
export async function modelingExportOptions(db: Db, actorId: string) {
  const admin = await isPlatformAdmin(db, actorId);
  return { pdf: true, xlsx: canExportModeling('xlsx', actorId, process.env.KIANDA_MODELING_OWNER_USER_ID, admin), csv: false };
}
