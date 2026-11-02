/**
 * Aceitação electrónica de documentos: destinatários, impressão digital do conteúdo e efeitos da aceitação
 * (fecho automático das tarefas de acolhimento ligadas, como «Ler e aceitar o regulamento interno»).
 */
import { ACK_CHECKLIST_LINKS, ackAudienceIncludes, ackContentHash, type AckCategory } from '@kianda/core';
import { ackDocuments, ackRequests, and, asc, auditLogs, checklistTasks, employeeChecklists, employees, eq, files, inArray, isNull, ne, type Db } from '@kianda/db';
import { syncChecklistStatus } from './checklists.js';

export const ACK_FILE_ENTITY = 'ack_document';

export async function ackFiles(db: Db, companyId: string, documentId: string) {
  return db.select().from(files).where(and(eq(files.companyId, companyId), eq(files.entity, ACK_FILE_ENTITY), eq(files.entityId, documentId))).orderBy(asc(files.createdAt));
}

export async function documentHash(db: Db, doc: typeof ackDocuments.$inferSelect) {
  const attached = await ackFiles(db, doc.companyId, doc.id);
  return ackContentHash({ title: doc.title, version: doc.version, body: doc.body, fileHashes: attached.map(f => f.sha256) });
}

/** Colaboradores activos abrangidos pelos destinatários (sem duplicar pedidos já existentes). */
export async function createRequests(db: Db, doc: typeof ackDocuments.$inferSelect, onlyEmployeeIds?: string[]) {
  const people = await db.select({ id: employees.id, departmentId: employees.departmentId }).from(employees)
    .where(and(eq(employees.companyId, doc.companyId), ne(employees.status, 'terminated'), ...(onlyEmployeeIds ? [inArray(employees.id, onlyEmployeeIds.length ? onlyEmployeeIds : ['—'])] : [])));
  const targets = onlyEmployeeIds ? people : people.filter(p => ackAudienceIncludes(doc.audience, p));
  if (!targets.length) return 0;
  const inserted = await db.insert(ackRequests).values(targets.map(p => ({ companyId: doc.companyId, documentId: doc.id, employeeId: p.id }))).onConflictDoNothing().returning({ id: ackRequests.id });
  return inserted.length;
}

/** Admissão: o novo colaborador recebe os documentos publicados que o abrangem (ex.: regulamento interno para todos). */
export async function requestsForNewEmployee(db: Db, companyId: string, emp: { id: string; departmentId: string | null }) {
  const published = await db.select().from(ackDocuments).where(and(eq(ackDocuments.companyId, companyId), eq(ackDocuments.status, 'published')));
  const docs = published.filter(d => ackAudienceIncludes(d.audience, emp));
  if (docs.length) await db.insert(ackRequests).values(docs.map(d => ({ companyId, documentId: d.id, employeeId: emp.id }))).onConflictDoNothing();
  return docs.length;
}

/** Depois da aceitação: as tarefas de acolhimento ligadas a esta categoria ficam feitas, com a referência do documento. */
export async function completeLinkedTasks(db: Db, o: { companyId: string; employeeId: string; category: AckCategory; title: string; version: number; actorId: string }) {
  const link = ACK_CHECKLIST_LINKS[o.category];
  if (!link) return 0;
  const tasks = await db.select({ id: checklistTasks.id, checklistId: checklistTasks.checklistId }).from(checklistTasks)
    .innerJoin(employeeChecklists, eq(employeeChecklists.id, checklistTasks.checklistId))
    .where(and(eq(checklistTasks.companyId, o.companyId), eq(employeeChecklists.employeeId, o.employeeId), eq(employeeChecklists.status, 'open'), eq(checklistTasks.linkKey, link), isNull(checklistTasks.doneAt)));
  for (const t of tasks) {
    await db.update(checklistTasks).set({ doneAt: new Date(), doneBy: o.actorId, note: `Aceite electronicamente no portal: ${o.title} (versão ${o.version})` }).where(eq(checklistTasks.id, t.id));
    await db.insert(auditLogs).values({ companyId: o.companyId, actorId: o.actorId, action: 'complete', entity: 'checklist_task', entityId: t.id, after: { via: 'ack', link, checklistId: t.checklistId } });
    await syncChecklistStatus(db, t.checklistId);
  }
  return tasks.length;
}
