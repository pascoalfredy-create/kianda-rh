/**
 * Regras de visibilidade e de decisão partilhadas (ausências, assiduidade…):
 * - RH, proprietário, processamento e finanças vêem todos;
 * - a chefia vê-se a si e à equipa directa (managerId);
 * - o colaborador vê-se só a si;
 * - ninguém decide sobre si próprio, excepto o proprietário (empresas pequenas).
 */
import { and, employees, eq, type Db } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';

const ALL_SCOPE = ['owner', 'hr_admin', 'payroll', 'finance'];

export function canDecideFor(actor: Actor, emp: { id: string; managerId: string | null }): boolean {
  if (actor.role === 'owner') return true;
  if (actor.employeeId && actor.employeeId === emp.id) return false;
  if (actor.role === 'hr_admin') return true;
  return actor.role === 'manager' && !!actor.employeeId && emp.managerId === actor.employeeId;
}

/** Colaboradores visíveis para o actor (null = todos da empresa). */
export async function visibleEmployeeIds(db: Db, actor: Actor): Promise<string[] | null> {
  if (ALL_SCOPE.includes(actor.role)) return null;
  const own = actor.employeeId ? [actor.employeeId] : [];
  if (actor.role !== 'manager' || !actor.employeeId) return own;
  const team = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.companyId, actor.companyId), eq(employees.managerId, actor.employeeId)));
  return [...own, ...team.map((t) => t.id)];
}

export async function canSee(db: Db, actor: Actor, employeeId: string): Promise<boolean> {
  const v = await visibleEmployeeIds(db, actor);
  return v === null || v.includes(employeeId);
}
