/** Modelagem é licenciada por projectos, sem relação com o efectivo do RH. */
export const MODELING_INCLUDED_USERS = 5;
export interface ModelingLimits { projectLimit: number; extraUsers: number }
export function modelingCapacity(limits: ModelingLimits, activeProjects: number, enabledUsers: number) {
  for (const value of [limits.projectLimit, limits.extraUsers, activeProjects, enabledUsers]) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Limite inválido');
  if (limits.projectLimit < 1) throw new RangeError('O contrato deve incluir pelo menos um projecto');
  const userLimit = MODELING_INCLUDED_USERS + limits.extraUsers;
  return { projectLimit: limits.projectLimit, includedUsers: MODELING_INCLUDED_USERS, extraUsers: limits.extraUsers, userLimit,
    activeProjects, enabledUsers, canCreateProject: activeProjects < limits.projectLimit, canAddUser: enabledUsers < userLimit };
}
/** Ser proprietário de uma empresa cliente não concede acesso aos modelos Excel. */
export function canExportModeling(format: string, actorId: string, configuredProductOwnerId: string | undefined, platformAdmin: boolean): boolean {
  if (format === 'pdf') return true;
  return format === 'xlsx' && Boolean(configuredProductOwnerId) && actorId === configuredProductOwnerId && platformAdmin;
}
