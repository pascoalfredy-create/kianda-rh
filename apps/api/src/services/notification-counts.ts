import { checklistDueDate, luandaDate } from '@kianda/core';
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

/**
 * Acolhimento e saída: tarefas por fazer do actor, em atraso ou a vencer em 3 dias, numa só expressão SQL.
 * Mesmas regras de canCompleteTask (@kianda/core) — o teste compara este contador com /v1/checklists/my-tasks.
 */
export function taskCountColumn(actor: Actor) {
  const self = actor.employeeId;
  const own = self ? sql`e.id = ${self}` : sql`false`, notOwn = self ? sql`e.id <> ${self}` : sql`true`;
  const mine = sql`(t.responsible = 'employee' and ${own})`;
  const allowed = actor.role === 'owner' ? sql`true`
    : actor.role === 'hr_admin' ? sql`(${notOwn} or t.responsible = 'employee')`
    : actor.role === 'manager' ? (self ? sql`((t.responsible = 'manager' and e.manager_id = ${self} and ${notOwn}) or ${mine})` : sql`false`)
    : actor.role === 'finance' || actor.role === 'payroll' ? sql`((t.responsible = 'finance' and ${notOwn}) or ${mine})`
    : mine;
  const until = checklistDueDate(luandaDate(new Date()), 3);
  return sql<number>`(select count(*) from checklist_tasks t join employee_checklists l on l.id = t.checklist_id join employees e on e.id = l.employee_id
    where t.company_id = ${actor.companyId} and l.company_id = ${actor.companyId} and e.company_id = ${actor.companyId} and l.status = 'open' and t.done_at is null and t.due_date <= ${until} and ${allowed})`.mapWith(Number);
}

/** Documentos por ler e aceitar do próprio colaborador. */
export function ackCountColumn(actor: Actor) {
  if (!actor.employeeId) return sql<number>`0`.mapWith(Number);
  return sql<number>`(select count(*) from ack_requests r join ack_documents d on d.id = r.document_id
    where r.company_id = ${actor.companyId} and d.company_id = ${actor.companyId} and r.employee_id = ${actor.employeeId} and r.status = 'pending' and d.status = 'published')
    + (select count(*) from issued_documents i where i.company_id = ${actor.companyId} and i.employee_id = ${actor.employeeId} and i.signature_requested_at is not null and i.signed_at is null and i.revoked_at is null)`.mapWith(Number);
}
