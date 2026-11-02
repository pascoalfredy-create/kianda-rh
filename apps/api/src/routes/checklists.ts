/**
 * Acolhimento e saída (Talento): listas por colaborador, tarefas com responsável e prazo, modelos da empresa.
 * Visibilidade: RH, proprietário, processamento e Finanças vêem todas; a chefia a sua equipa; o colaborador
 * só as tarefas que lhe cabem na sua própria lista.
 */
import {
  CHECKLIST_KINDS, CHECKLIST_LINKS, CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_OFFSET_DAYS, canCompleteTask, checklistProgress, checklistTemplateIssue, luandaDate,
  TASK_RESPONSIBLES, taskState, type ChecklistKind, type TaskResponsible,
} from '@kianda/core';
import { and, asc, auditLogs, checklistTasks, checklistTemplates, desc, employeeChecklists, employees, eq, getDb, inArray, isNull, users, type Db } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { actionableTasks, ensureTemplate, startChecklist, syncChecklistStatus } from '../services/checklists.js';
import { DomainError } from '../services/payroll.js';
import { visibleEmployeeIds } from '../services/scope.js';

const kindSchema = z.enum(CHECKLIST_KINDS);
const responsibleSchema = z.enum(TASK_RESPONSIBLES);
const date = z.iso.date('Data inválida');
const STAFF = ['owner', 'hr_admin', 'payroll', 'finance'];

type TaskRow = typeof checklistTasks.$inferSelect;
type Emp = { id: string; name: string; number: string; managerId: string | null };

/** Tarefas que o actor vê numa lista: o colaborador só vê as suas, na sua própria lista. */
function visibleTasks(actor: Actor, emp: Emp, tasks: TaskRow[]) {
  if (STAFF.includes(actor.role) || actor.role === 'manager' && actor.employeeId !== emp.id) return tasks;
  return actor.employeeId === emp.id ? tasks.filter(t => t.responsible === 'employee') : [];
}

async function names(db: Db, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  return new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique))).map(u => [u.id, u.name]));
}

function presentTask(actor: Actor, emp: Emp, t: TaskRow, today: string, who: Map<string, string>) {
  return {
    id: t.id, position: t.position, title: t.title, description: t.description, responsible: t.responsible as TaskResponsible, dueDate: t.dueDate,
    doneAt: t.doneAt, doneByName: t.doneBy ? who.get(t.doneBy) ?? '—' : null, note: t.note, state: taskState(t, today), linkKey: t.linkKey,
    canComplete: canCompleteTask(actor, t.responsible as TaskResponsible, emp),
  };
}

export function checklistRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/checklists', '/v1/checklists/*', '/v1/checklist-templates', '/v1/checklist-templates/*']) app.use(p, requireCompany);

  async function load(c: { get: (k: 'actor') => Actor }, id: string) {
    const actor = c.get('actor'), db = getDb();
    const [row] = await db.select({ list: employeeChecklists, emp: { id: employees.id, name: employees.name, number: employees.number, managerId: employees.managerId } })
      .from(employeeChecklists).innerJoin(employees, eq(employees.id, employeeChecklists.employeeId))
      .where(and(eq(employeeChecklists.id, id), eq(employeeChecklists.companyId, actor.companyId)));
    if (!row) throw new DomainError('nao_encontrado', 'Lista inexistente', 404);
    const visible = await visibleEmployeeIds(db, actor);
    if (visible !== null && !visible.includes(row.emp.id)) throw new DomainError('nao_encontrado', 'Lista inexistente', 404);
    return row;
  }

  /** Listas visíveis, com progresso e atrasos (sem as tarefas). */
  app.get('/v1/checklists', async (c) => {
    const actor = c.get('actor'), db = getDb(), today = luandaDate(new Date());
    const q = z.object({ kind: kindSchema.optional(), status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open'), employeeId: z.string().optional() }).parse(c.req.query());
    const visible = await visibleEmployeeIds(db, actor);
    if (visible !== null && !visible.length) return c.json([]);
    const where = [eq(employeeChecklists.companyId, actor.companyId)];
    if (q.kind) where.push(eq(employeeChecklists.kind, q.kind));
    if (q.status !== 'all') where.push(eq(employeeChecklists.status, q.status));
    if (q.employeeId) where.push(eq(employeeChecklists.employeeId, q.employeeId));
    if (visible !== null) where.push(inArray(employeeChecklists.employeeId, visible));
    const rows = await db.select({ list: employeeChecklists, emp: { id: employees.id, name: employees.name, number: employees.number, managerId: employees.managerId } })
      .from(employeeChecklists).innerJoin(employees, eq(employees.id, employeeChecklists.employeeId)).where(and(...where)).orderBy(desc(employeeChecklists.createdAt)).limit(300);
    const tasks = rows.length ? await db.select().from(checklistTasks).where(inArray(checklistTasks.checklistId, rows.map(r => r.list.id))) : [];
    return c.json(rows.map(({ list, emp }) => {
      const mine = visibleTasks(actor, emp, tasks.filter(t => t.checklistId === list.id));
      return { id: list.id, kind: list.kind, title: list.title, status: list.status, referenceDate: list.referenceDate, terminationId: list.terminationId, createdAt: list.createdAt, completedAt: list.completedAt,
        employee: { id: emp.id, name: emp.name, number: emp.number }, progress: checklistProgress(mine, today),
        actionable: mine.filter(t => !t.doneAt && canCompleteTask(actor, t.responsible as TaskResponsible, emp)).length };
    }).filter(l => l.progress.total > 0 || STAFF.includes(actor.role)));
  });

  /** Tarefas por fazer que cabem ao actor (painel inicial, portal e contador do menu). */
  app.get('/v1/checklists/my-tasks', async (c) => c.json((await actionableTasks(getDb(), c.get('actor'))).slice(0, 100)));

  app.get('/v1/checklists/:id', async (c) => {
    const actor = c.get('actor'), db = getDb(), today = luandaDate(new Date());
    const { list, emp } = await load(c, c.req.param('id'));
    const tasks = visibleTasks(actor, emp, await db.select().from(checklistTasks).where(eq(checklistTasks.checklistId, list.id)).orderBy(asc(checklistTasks.position)));
    const who = await names(db, tasks.map(t => t.doneBy));
    return c.json({ id: list.id, kind: list.kind, title: list.title, status: list.status, referenceDate: list.referenceDate, terminationId: list.terminationId, createdAt: list.createdAt, completedAt: list.completedAt, cancelReason: list.cancelReason,
      employee: { id: emp.id, name: emp.name, number: emp.number }, progress: checklistProgress(tasks, today), canManage: ['owner', 'hr_admin'].includes(actor.role),
      tasks: tasks.map(t => presentTask(actor, emp, t, today, who)) });
  });

  /** Iniciar manualmente (ex.: colaboradores admitidos antes desta funcionalidade). */
  app.post('/v1/checklists', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ employeeId: z.string().min(1), kind: kindSchema, referenceDate: date }).parse(await body(c));
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
    if (!emp) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
    const list = await startChecklist(db, { companyId: actor.companyId, employeeId: b.employeeId, kind: b.kind, referenceDate: b.referenceDate, actorId: actor.actorId });
    if (!list) throw new DomainError('lista_existente', 'Já existe uma lista em curso deste tipo para o colaborador.', 409);
    return c.json(list, 201);
  });

  /** Marcar ou desmarcar uma tarefa (com nota opcional), segundo o responsável. */
  app.patch('/v1/checklists/:id/tasks/:taskId', async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ done: z.boolean(), note: z.string().trim().max(500).nullable().optional() }).parse(await body(c));
    const { list, emp } = await load(c, c.req.param('id'));
    if (list.status === 'cancelled') throw new DomainError('lista_anulada', 'A lista foi anulada.', 409);
    const [task] = await db.select().from(checklistTasks).where(and(eq(checklistTasks.id, c.req.param('taskId')), eq(checklistTasks.checklistId, list.id))).for('update');
    if (!task || !visibleTasks(actor, emp, [task]).length) throw new DomainError('nao_encontrado', 'Tarefa inexistente', 404);
    if (!canCompleteTask(actor, task.responsible as TaskResponsible, emp)) return c.json({ error: 'sem_permissao', message: 'Esta tarefa cabe a outro responsável.' }, 403);
    const values = b.done ? { doneAt: task.doneAt ?? new Date(), doneBy: task.doneBy ?? actor.actorId, note: b.note === undefined ? task.note : b.note } : { doneAt: null, doneBy: null, note: b.note === undefined ? task.note : b.note };
    const [u] = await db.update(checklistTasks).set(values).where(eq(checklistTasks.id, task.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: b.done ? 'complete' : 'reopen', entity: 'checklist_task', entityId: task.id, before: { doneAt: task.doneAt, note: task.note }, after: { doneAt: u!.doneAt, note: u!.note, checklistId: list.id } });
    const synced = await syncChecklistStatus(db, list.id);
    return c.json({ task: presentTask(actor, emp, u!, luandaDate(new Date()), await names(db, [u!.doneBy])), status: synced?.status ?? list.status });
  });

  /** Tarefa extra só para este colaborador. */
  app.post('/v1/checklists/:id/tasks', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ title: z.string().trim().min(2, 'Indique a tarefa').max(200), responsible: responsibleSchema, dueDate: date, description: z.string().trim().max(500).nullable().optional() }).parse(await body(c));
    const { list } = await load(c, c.req.param('id'));
    if (list.status === 'cancelled') throw new DomainError('lista_anulada', 'A lista foi anulada.', 409);
    const existing = await db.select({ position: checklistTasks.position }).from(checklistTasks).where(eq(checklistTasks.checklistId, list.id));
    if (existing.length >= CHECKLIST_MAX_ITEMS) throw new DomainError('limite_tarefas', `Uma lista tem no máximo ${CHECKLIST_MAX_ITEMS} tarefas.`);
    const [t] = await db.insert(checklistTasks).values({ companyId: actor.companyId, checklistId: list.id, position: Math.max(-1, ...existing.map(e => e.position)) + 1, title: b.title, description: b.description ?? null, responsible: b.responsible, dueDate: b.dueDate }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'checklist_task', entityId: t!.id, after: t });
    await syncChecklistStatus(db, list.id);
    return c.json(t, 201);
  });

  app.delete('/v1/checklists/:id/tasks/:taskId', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const { list } = await load(c, c.req.param('id'));
    const [task] = await db.select().from(checklistTasks).where(and(eq(checklistTasks.id, c.req.param('taskId')), eq(checklistTasks.checklistId, list.id)));
    if (!task) throw new DomainError('nao_encontrado', 'Tarefa inexistente', 404);
    if (task.doneAt) throw new DomainError('tarefa_feita', 'Uma tarefa feita fica no registo; desmarque-a primeiro se foi marcada por engano.');
    await db.delete(checklistTasks).where(eq(checklistTasks.id, task.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'delete', entity: 'checklist_task', entityId: task.id, before: task });
    await syncChecklistStatus(db, list.id);
    return c.json({ ok: true });
  });

  app.post('/v1/checklists/:id/cancel', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const { reason } = z.object({ reason: z.string().trim().min(3, 'Indique o motivo').max(300) }).parse(await body(c));
    const { list } = await load(c, c.req.param('id'));
    if (list.status === 'cancelled') return c.json(list);
    const [u] = await db.update(employeeChecklists).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason }).where(eq(employeeChecklists.id, list.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'cancel', entity: 'employee_checklist', entityId: list.id, before: { status: list.status }, after: { status: 'cancelled', reason } });
    return c.json(u);
  });

  /** Modelos da empresa (criados a partir do modelo-tipo na primeira consulta). */
  app.get('/v1/checklist-templates', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    return c.json(await Promise.all(CHECKLIST_KINDS.map(async kind => {
      const t = await ensureTemplate(db, actor.companyId, kind);
      return { kind, name: t.name, autoStart: t.autoStart, items: t.items, updatedAt: t.updatedAt };
    })));
  });

  app.put('/v1/checklist-templates/:kind', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const kind = kindSchema.parse(c.req.param('kind')) as ChecklistKind;
    const b = z.object({
      name: z.string().trim().min(2, 'Indique o nome do modelo').max(120), autoStart: z.boolean(),
      items: z.array(z.object({ title: z.string().trim().min(2, 'Indique a tarefa').max(200), description: z.string().trim().max(500).optional(), responsible: responsibleSchema, offsetDays: z.number().int().min(-CHECKLIST_MAX_OFFSET_DAYS).max(CHECKLIST_MAX_OFFSET_DAYS), link: z.enum(CHECKLIST_LINKS).optional() })).max(CHECKLIST_MAX_ITEMS),
    }).parse(await body(c));
    const issue = checklistTemplateIssue(b);
    if (issue) throw new DomainError('modelo_invalido', issue);
    const before = await ensureTemplate(db, actor.companyId, kind);
    const items = b.items.map(i => ({ title: i.title, responsible: i.responsible, offsetDays: i.offsetDays, ...(i.description ? { description: i.description } : {}), ...(i.link ? { link: i.link } : {}) }));
    const [u] = await db.update(checklistTemplates).set({ name: b.name, autoStart: b.autoStart, items, updatedBy: actor.actorId, updatedAt: new Date() }).where(eq(checklistTemplates.id, before.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'checklist_template', entityId: before.id, before: { name: before.name, autoStart: before.autoStart, items: before.items }, after: { name: u!.name, autoStart: u!.autoStart, items: u!.items } });
    return c.json({ kind, name: u!.name, autoStart: u!.autoStart, items: u!.items, updatedAt: u!.updatedAt });
  });

  return app;
}
