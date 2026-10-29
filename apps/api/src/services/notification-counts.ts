import { sql } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';

/** As mesmas decisões do RH, reduzidas a contagens; nenhum nome ou documento é carregado. */
export function notificationColumns(actor: Actor) {
  if (!['owner', 'hr_admin', 'manager'].includes(actor.role)) return { absences: sql<number>`0`.mapWith(Number), expenses: sql<number>`0`.mapWith(Number) };
  const decide = actor.role === 'owner' ? sql`true` : actor.role === 'hr_admin'
    ? actor.employeeId ? sql`e.id <> ${actor.employeeId}` : sql`true`
    : actor.employeeId ? sql`e.manager_id = ${actor.employeeId} and e.id <> ${actor.employeeId}` : sql`false`;
  return {
    absences: sql<number>`(select count(*) from absences a join employees e on e.id = a.employee_id where a.company_id = ${actor.companyId} and e.company_id = ${actor.companyId} and a.status = 'pending' and ${decide})`.mapWith(Number),
    expenses: sql<number>`(select count(*) from expense_claims x join employees e on e.id = x.employee_id where x.company_id = ${actor.companyId} and e.company_id = ${actor.companyId} and x.status = 'submitted' and ${decide})`.mapWith(Number),
  };
}
