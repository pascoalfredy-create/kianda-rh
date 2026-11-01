/**
 * Acesso dos participantes do Integra por projecto.
 * - scope 'all': todos os projectos da empresa, com a permissão geral do participante (comportamento anterior).
 * - scope 'selected': só os projectos atribuídos; em cada um, a permissão nunca excede a geral.
 * O proprietário da empresa vê sempre todos os projectos. Um projecto não atribuído responde 404 (não revela existência).
 */
import { and, eq, inArray, modelingMembers, modelingProjectAccess, type Db } from '@kianda/db';

export type ModelingPermission = 'editor' | 'viewer';
export type ModelingMember = typeof modelingMembers.$inferSelect;

const rank = (p: string) => (p === 'editor' ? 2 : p === 'viewer' ? 1 : 0);
/** A permissão mais restritiva das duas. */
export const capPermission = (general: string, project: string): ModelingPermission => (rank(project) <= rank(general) ? project : general) as ModelingPermission;

/** Restrito a projectos atribuídos? (o proprietário nunca é.) */
export const isRestricted = (member: ModelingMember, role: string) => role !== 'owner' && member.scope === 'selected';

/** Permissão efectiva num projecto; null = sem acesso. */
export async function projectPermission(db: Db, member: ModelingMember, role: string, modelId: string): Promise<ModelingPermission | null> {
  if (!isRestricted(member, role)) return member.permission as ModelingPermission;
  const [row] = await db.select({ permission: modelingProjectAccess.permission }).from(modelingProjectAccess)
    .where(and(eq(modelingProjectAccess.companyId, member.companyId), eq(modelingProjectAccess.userId, member.userId), eq(modelingProjectAccess.modelId, modelId)));
  return row ? capPermission(member.permission, row.permission) : null;
}

/** Permissões por projecto para filtrar listas; null = sem restrição (todos com a permissão geral). */
export async function projectPermissions(db: Db, member: ModelingMember, role: string): Promise<Map<string, ModelingPermission> | null> {
  if (!isRestricted(member, role)) return null;
  const rows = await db.select().from(modelingProjectAccess)
    .where(and(eq(modelingProjectAccess.companyId, member.companyId), eq(modelingProjectAccess.userId, member.userId)));
  return new Map(rows.map((r) => [r.modelId, capPermission(member.permission, r.permission)]));
}

/** Filtra uma lista de projectos e acrescenta a permissão efectiva de cada um. */
export async function visibleModels<T extends { id: string }>(db: Db, member: ModelingMember, role: string, models: T[]): Promise<(T & { permission: ModelingPermission })[]> {
  const map = await projectPermissions(db, member, role);
  return models.flatMap((m) => {
    const permission = map ? map.get(m.id) : (member.permission as ModelingPermission);
    return permission ? [{ ...m, permission }] : [];
  });
}

/** Quem cria um projecto e está restrito passa a tê-lo atribuído como editor (sem isto, perdia o que acabou de criar). */
export async function grantCreator(db: Db, member: ModelingMember, role: string, modelId: string) {
  if (!isRestricted(member, role)) return;
  await db.insert(modelingProjectAccess).values({ companyId: member.companyId, modelId, userId: member.userId, permission: 'editor', addedBy: member.userId })
    .onConflictDoNothing();
}

/** Atribuições de vários participantes (para a gestão de acessos). */
export async function accessOfMembers(db: Db, companyId: string, userIds: string[]) {
  if (!userIds.length) return [];
  return db.select({ userId: modelingProjectAccess.userId, modelId: modelingProjectAccess.modelId, permission: modelingProjectAccess.permission })
    .from(modelingProjectAccess).where(and(eq(modelingProjectAccess.companyId, companyId), inArray(modelingProjectAccess.userId, userIds)));
}
