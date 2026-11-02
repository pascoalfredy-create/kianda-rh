/**
 * Acolhimento e saída: criação das listas a partir do modelo da empresa (admissão, cessação ou manual),
 * deslocação de prazos quando a data de cessação muda e fecho automático quando todas as tarefas estão feitas.
 */
import { canCompleteTask, checklistDueDate, DEFAULT_CHECKLIST_TEMPLATES, luandaDate, shiftDueDate, taskState, type ChecklistKind, type TaskResponsible } from '@kianda/core';
import { and, asc, auditLogs, checklistTasks, checklistTemplates, employeeChecklists, employees, eq, inArray, isNull, type Db } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';
import { visibleEmployeeIds } from './scope.js';

/** Modelo da empresa para o tipo; na primeira utilização grava o modelo-tipo (a empresa ajusta-o depois). */
export async function ensureTemplate(db: Db, companyId: string, kind: ChecklistKind) {
  const [found] = await db.select().from(checklistTemplates).where(and(eq(checklistTemplates.companyId, companyId), eq(checklistTemplates.kind, kind)));
  if (found) return found;
  const base = DEFAULT_CHECKLIST_TEMPLATES[kind];
  await db.insert(checklistTemplates).values({ companyId, kind, name: base.name, autoStart: base.autoStart, items: base.items }).onConflictDoNothing();
  const [created] = await db.select().from(checklistTemplates).where(and(eq(checklistTemplates.companyId, companyId), eq(checklistTemplates.kind, kind)));
  return created!;
}

export interface StartChecklist {
  companyId: string; employeeId: string; kind: ChecklistKind; referenceDate: string; actorId: string;
  terminationId?: string | null; automatic?: boolean;
}

/**
 * Cria a lista do colaborador a partir do modelo. Automática (admissão/cessação): respeita «criar automaticamente»
 * e não duplica uma lista em curso. Devolve null quando nada foi criado.
 */
export async function startChecklist(db: Db, o: StartChecklist) {
  const template = await ensureTemplate(db, o.companyId, o.kind);
  if (o.automatic && (!template.autoStart || !template.items.length)) return null;
  const [open] = await db.select({ id: employeeChecklists.id }).from(employeeChecklists)
    .where(and(eq(employeeChecklists.employeeId, o.employeeId), eq(employeeChecklists.kind, o.kind), eq(employeeChecklists.status, 'open')));
  if (open) return null;
  const [list] = await db.insert(employeeChecklists).values({
    companyId: o.companyId, employeeId: o.employeeId, kind: o.kind, title: template.name, referenceDate: o.referenceDate,
    terminationId: o.terminationId ?? null, createdBy: o.actorId, status: template.items.length ? 'open' : 'completed', completedAt: template.items.length ? null : new Date(),
  }).returning();
  if (template.items.length) {
    await db.insert(checklistTasks).values(template.items.map((item, position) => ({
      companyId: o.companyId, checklistId: list!.id, position, title: item.title, description: item.description ?? null,
      responsible: item.responsible, dueDate: checklistDueDate(o.referenceDate, item.offsetDays),
    })));
  }
  await db.insert(auditLogs).values({ companyId: o.companyId, actorId: o.actorId, action: o.automatic ? 'auto_create' : 'create', entity: 'employee_checklist', entityId: list!.id, after: { kind: o.kind, employeeId: o.employeeId, referenceDate: o.referenceDate, tasks: template.items.length } });
  return list!;
}

/** A cessação mudou de data: as tarefas por fazer acompanham a nova data. */
export async function shiftTerminationChecklist(db: Db, companyId: string, terminationId: string, toReference: string, actorId: string) {
  const [list] = await db.select().from(employeeChecklists).where(and(eq(employeeChecklists.terminationId, terminationId), eq(employeeChecklists.status, 'open')));
  if (!list || list.referenceDate === toReference) return;
  const pending = await db.select().from(checklistTasks).where(and(eq(checklistTasks.checklistId, list.id), isNull(checklistTasks.doneAt)));
  for (const t of pending) await db.update(checklistTasks).set({ dueDate: shiftDueDate(t.dueDate, list.referenceDate, toReference) }).where(eq(checklistTasks.id, t.id));
  await db.update(employeeChecklists).set({ referenceDate: toReference }).where(eq(employeeChecklists.id, list.id));
  await db.insert(auditLogs).values({ companyId, actorId, action: 'reschedule', entity: 'employee_checklist', entityId: list.id, before: { referenceDate: list.referenceDate }, after: { referenceDate: toReference, shifted: pending.length } });
}

/** A cessação foi anulada: a lista de saída em curso deixa de fazer sentido. */
export async function cancelTerminationChecklist(db: Db, companyId: string, terminationId: string, actorId: string) {
  const [list] = await db.select().from(employeeChecklists).where(and(eq(employeeChecklists.terminationId, terminationId), eq(employeeChecklists.status, 'open')));
  if (!list) return;
  await db.update(employeeChecklists).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Cessação anulada' }).where(eq(employeeChecklists.id, list.id));
  await db.insert(auditLogs).values({ companyId, actorId, action: 'cancel', entity: 'employee_checklist', entityId: list.id, after: { reason: 'Cessação anulada' } });
}

/** Fecha a lista quando a última tarefa é feita; reabre-a se uma tarefa voltar a ficar por fazer. */
export async function syncChecklistStatus(db: Db, checklistId: string) {
  const [list] = await db.select().from(employeeChecklists).where(eq(employeeChecklists.id, checklistId));
  if (!list || list.status === 'cancelled') return list;
  const [pending] = await db.select({ id: checklistTasks.id }).from(checklistTasks).where(and(eq(checklistTasks.checklistId, checklistId), isNull(checklistTasks.doneAt))).limit(1);
  const status = pending ? 'open' : 'completed';
  if (status === list.status) return list;
  const [u] = await db.update(employeeChecklists).set({ status, completedAt: status === 'completed' ? new Date() : null }).where(eq(employeeChecklists.id, checklistId)).returning();
  return u;
}

/**
 * Tarefas por fazer que cabem ao actor, nas listas em curso que ele vê. O colaborador só recebe as suas
 * (responsável «colaborador» na sua própria lista); ninguém recebe tarefas de chefia ou Finanças da própria lista.
 */
export async function actionableTasks(db: Db, actor: Actor) {
  const visible = await visibleEmployeeIds(db, actor);
  if (visible !== null && !visible.length) return [];
  const today = luandaDate(new Date());
  const rows = await db.select({ task: checklistTasks, list: { id: employeeChecklists.id, kind: employeeChecklists.kind }, emp: { id: employees.id, name: employees.name, managerId: employees.managerId } })
    .from(checklistTasks).innerJoin(employeeChecklists, eq(employeeChecklists.id, checklistTasks.checklistId)).innerJoin(employees, eq(employees.id, employeeChecklists.employeeId))
    .where(and(eq(checklistTasks.companyId, actor.companyId), eq(employeeChecklists.status, 'open'), isNull(checklistTasks.doneAt), ...(visible === null ? [] : [inArray(employeeChecklists.employeeId, visible)])))
    .orderBy(asc(checklistTasks.dueDate), asc(checklistTasks.position)).limit(1000);
  const staff = ['owner', 'hr_admin', 'payroll', 'finance'].includes(actor.role);
  return rows.filter(r => canCompleteTask(actor, r.task.responsible as TaskResponsible, r.emp) && (staff || actor.employeeId !== r.emp.id || r.task.responsible === 'employee'))
    .map(r => ({ id: r.task.id, checklistId: r.list.id, kind: r.list.kind, title: r.task.title, responsible: r.task.responsible, dueDate: r.task.dueDate, state: taskState(r.task, today), employee: { id: r.emp.id, name: r.emp.name } }));
}
