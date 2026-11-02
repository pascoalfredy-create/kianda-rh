/**
 * Aceitação electrónica de documentos. O RH publica (regulamento interno, políticas, avisos) para todos,
 * departamentos ou pessoas; cada colaborador lê e aceita no portal, só por si próprio. A aceitação guarda
 * data e hora, utilizador, IP, navegador e a impressão digital do conteúdo; o documento publicado não muda.
 */
import { ACK_CATEGORIES, ACK_MAX_BODY, ackAudienceIssue, ackState, luandaDate, type AckCategory } from '@kianda/core';
import { ackDocuments, ackRequests, and, auditLogs, departments, desc, employees, eq, getDb, inArray, users } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, clientIp, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { ackFiles, completeLinkedTasks, createRequests, documentHash } from '../services/acknowledgements.js';
import { DomainError } from '../services/payroll.js';
import { notifyEmployees } from '../services/push.js';
import { removeFiles } from '../services/storage.js';

const HR = (a: Actor) => a.role === 'owner' || a.role === 'hr_admin';
const audience = z.object({ all: z.boolean(), departmentIds: z.array(z.string().min(1)).max(200).default([]), employeeIds: z.array(z.string().min(1)).max(5000).default([]) });
const draftBody = z.object({
  title: z.string().trim().min(3, 'Indique o título').max(160),
  body: z.string().max(ACK_MAX_BODY, 'Texto demasiado longo').default(''),
  category: z.enum(ACK_CATEGORIES),
  audience,
  dueDate: z.iso.date('Data inválida').nullable().default(null),
});
const fileView = (f: { id: string; name: string; mime: string; sizeBytes: number; sha256: string }) => ({ id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes, sha256: f.sha256, url: `/api/v1/files/${f.id}` });

export function acknowledgementRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/ack-documents', '/v1/ack-documents/*', '/v1/acknowledgements', '/v1/acknowledgements/*']) app.use(p, requireCompany);

  async function docOf(actor: Actor, id: string, lock = false) {
    const q = getDb().select().from(ackDocuments).where(and(eq(ackDocuments.id, id), eq(ackDocuments.companyId, actor.companyId)));
    const [d] = lock ? await q.for('update') : await q;
    if (!d) throw new DomainError('nao_encontrado', 'Documento inexistente', 404);
    return d;
  }
  const audit = (actor: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) =>
    getDb().insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity, entityId, before: before as object, after: after as object });
  async function checkAudience(actor: Actor, a: z.infer<typeof audience>) {
    const issue = ackAudienceIssue(a);
    if (issue) throw new DomainError('destinatarios', issue);
    const db = getDb();
    if (a.departmentIds.length && (await db.select({ id: departments.id }).from(departments).where(and(eq(departments.companyId, actor.companyId), inArray(departments.id, a.departmentIds)))).length !== new Set(a.departmentIds).size) throw new DomainError('destinatarios', 'Departamento inexistente');
    if (a.employeeIds.length && (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.companyId, actor.companyId), inArray(employees.id, a.employeeIds)))).length !== new Set(a.employeeIds).size) throw new DomainError('destinatarios', 'Colaborador inexistente');
  }

  /* ---------------- RH: documentos ---------------- */
  app.get('/v1/ack-documents', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb(), today = luandaDate(new Date());
    const docs = await db.select().from(ackDocuments).where(eq(ackDocuments.companyId, actor.companyId)).orderBy(desc(ackDocuments.createdAt)).limit(300);
    const reqs = docs.length ? await db.select({ documentId: ackRequests.documentId, status: ackRequests.status }).from(ackRequests).where(inArray(ackRequests.documentId, docs.map(d => d.id))) : [];
    return c.json(docs.map(d => {
      const mine = reqs.filter(r => r.documentId === d.id && r.status !== 'cancelled');
      const pending = mine.filter(r => r.status === 'pending').length;
      return { id: d.id, title: d.title, category: d.category, version: d.version, status: d.status, dueDate: d.dueDate, publishedAt: d.publishedAt, createdAt: d.createdAt,
        recipients: mine.length, accepted: mine.length - pending, pending, overdue: d.dueDate && d.dueDate < today ? pending : 0 };
    }));
  });

  app.post('/v1/ack-documents', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = draftBody.parse(await body(c));
    await checkAudience(actor, b.audience);
    const [d] = await getDb().insert(ackDocuments).values({ companyId: actor.companyId, ...b, createdBy: actor.actorId }).returning();
    await audit(actor, 'create', 'ack_document', d!.id, null, { title: d!.title, category: d!.category });
    return c.json(d, 201);
  });

  app.get('/v1/ack-documents/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb(), today = luandaDate(new Date());
    const d = await docOf(actor, c.req.param('id'));
    const rows = await db.select({ r: ackRequests, name: employees.name, number: employees.number, departmentId: employees.departmentId }).from(ackRequests)
      .innerJoin(employees, eq(employees.id, ackRequests.employeeId)).where(eq(ackRequests.documentId, d.id)).orderBy(employees.name);
    const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, actor.companyId));
    return c.json({ ...d, files: (await ackFiles(db, actor.companyId, d.id)).map(fileView), departments: depts,
      recipients: rows.map(x => ({ requestId: x.r.id, employeeId: x.r.employeeId, name: x.name, number: x.number, department: depts.find(dp => dp.id === x.departmentId)?.name ?? null,
        status: x.r.status, state: ackState({ status: x.r.status, dueDate: d.dueDate }, today), acceptedAt: x.r.acceptedAt })) });
  });

  app.patch('/v1/ack-documents/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = draftBody.parse(await body(c));
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'draft') throw new DomainError('documento_publicado', 'Um documento publicado não se altera: crie uma nova versão.', 409);
    await checkAudience(actor, b.audience);
    const [u] = await getDb().update(ackDocuments).set({ ...b, updatedAt: new Date() }).where(eq(ackDocuments.id, d.id)).returning();
    await audit(actor, 'update', 'ack_document', d.id, { title: d.title, audience: d.audience }, { title: u!.title, audience: u!.audience });
    return c.json(u);
  });

  app.delete('/v1/ack-documents/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'draft') throw new DomainError('documento_publicado', 'Só se elimina um rascunho. Um documento publicado arquiva-se.', 409);
    await removeFiles(db, await ackFiles(db, actor.companyId, d.id));
    await db.delete(ackDocuments).where(eq(ackDocuments.id, d.id));
    await audit(actor, 'delete', 'ack_document', d.id, { title: d.title }, null);
    return c.json({ ok: true });
  });

  /** Publicar: congela o conteúdo (impressão digital), cria os pedidos e substitui a versão anterior. */
  app.post('/v1/ack-documents/:id/publish', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'draft') throw new DomainError('documento_publicado', 'O documento já foi publicado.', 409);
    const attached = await ackFiles(db, actor.companyId, d.id);
    if (!d.body.trim() && !attached.length) throw new DomainError('documento_vazio', 'Escreva o texto ou anexe o documento (PDF) antes de publicar.');
    const hash = await documentHash(db, d);
    const [u] = await db.update(ackDocuments).set({ status: 'published', contentSha256: hash, publishedAt: new Date(), publishedBy: actor.actorId, updatedAt: new Date() }).where(eq(ackDocuments.id, d.id)).returning();
    let replaced = 0;
    if (d.previousId) {
      const [prev] = await db.select().from(ackDocuments).where(and(eq(ackDocuments.id, d.previousId), eq(ackDocuments.companyId, actor.companyId)));
      if (prev && prev.status === 'published') {
        await db.update(ackDocuments).set({ status: 'archived', archivedAt: new Date() }).where(eq(ackDocuments.id, prev.id));
        replaced = (await db.update(ackRequests).set({ status: 'cancelled', cancelledAt: new Date() }).where(and(eq(ackRequests.documentId, prev.id), eq(ackRequests.status, 'pending'))).returning({ id: ackRequests.id })).length;
      }
    }
    const created = await createRequests(db, u!);
    const recipients = await db.select({ employeeId: ackRequests.employeeId }).from(ackRequests).where(and(eq(ackRequests.documentId, d.id), eq(ackRequests.status, 'pending')));
    await notifyEmployees(db, actor.companyId, recipients.map(r => r.employeeId), { title: 'Documento para ler e aceitar', body: `${u!.title}${u!.version > 1 ? ` (versão ${u!.version})` : ''}`, url: '/aceitacao', tag: `aceitacao-${d.id}` });
    await audit(actor, 'publish', 'ack_document', d.id, null, { contentSha256: hash, version: u!.version, recipients: created, replacedPending: replaced, files: attached.map(f => ({ name: f.name, sha256: f.sha256 })) });
    return c.json({ ...u, recipients: created });
  });

  /** Nova versão: rascunho com o mesmo texto e destinatários; os anexos voltam a ser anexados (o conteúdo é outro). */
  app.post('/v1/ack-documents/:id/new-version', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'published') throw new DomainError('estado_invalido', 'Só se cria uma nova versão de um documento publicado.', 409);
    const [draft] = await db.select({ id: ackDocuments.id }).from(ackDocuments).where(and(eq(ackDocuments.previousId, d.id), eq(ackDocuments.status, 'draft')));
    if (draft) return c.json({ id: draft.id });
    const [n] = await db.insert(ackDocuments).values({ companyId: actor.companyId, title: d.title, body: d.body, category: d.category, audience: d.audience, dueDate: null, version: d.version + 1, previousId: d.id, createdBy: actor.actorId }).returning();
    await audit(actor, 'new_version', 'ack_document', n!.id, { previousId: d.id, version: d.version }, { version: n!.version });
    return c.json(n, 201);
  });

  app.post('/v1/ack-documents/:id/archive', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'published') throw new DomainError('estado_invalido', 'Só se arquiva um documento publicado.', 409);
    await db.update(ackDocuments).set({ status: 'archived', archivedAt: new Date() }).where(eq(ackDocuments.id, d.id));
    const cancelled = (await db.update(ackRequests).set({ status: 'cancelled', cancelledAt: new Date() }).where(and(eq(ackRequests.documentId, d.id), eq(ackRequests.status, 'pending'))).returning({ id: ackRequests.id })).length;
    await audit(actor, 'archive', 'ack_document', d.id, null, { cancelledPending: cancelled });
    return c.json({ ok: true, cancelledPending: cancelled });
  });

  /** Acrescentar destinatários a um documento publicado (ex.: um colaborador que mudou de departamento). */
  app.post('/v1/ack-documents/:id/recipients', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const { employeeIds } = z.object({ employeeIds: z.array(z.string().min(1)).min(1).max(5000) }).parse(await body(c));
    const d = await docOf(actor, c.req.param('id'), true);
    if (d.status !== 'published') throw new DomainError('estado_invalido', 'Só um documento publicado recebe destinatários.', 409);
    await checkAudience(actor, { all: false, departmentIds: [], employeeIds });
    const created = await createRequests(db, d, employeeIds);
    await audit(actor, 'add_recipients', 'ack_document', d.id, null, { employeeIds, created });
    return c.json({ created });
  });

  /* ---------------- Colaborador: ler e aceitar ---------------- */
  app.get('/v1/acknowledgements', async (c) => {
    const actor = c.get('actor'), today = luandaDate(new Date());
    if (!actor.employeeId) return c.json([]);
    const rows = await getDb().select({ r: ackRequests, d: { id: ackDocuments.id, title: ackDocuments.title, category: ackDocuments.category, version: ackDocuments.version, dueDate: ackDocuments.dueDate, publishedAt: ackDocuments.publishedAt } })
      .from(ackRequests).innerJoin(ackDocuments, eq(ackDocuments.id, ackRequests.documentId))
      .where(and(eq(ackRequests.companyId, actor.companyId), eq(ackRequests.employeeId, actor.employeeId), inArray(ackRequests.status, ['pending', 'accepted']))).orderBy(desc(ackDocuments.publishedAt));
    return c.json(rows.map(({ r, d }) => ({ id: r.id, status: r.status, state: ackState({ status: r.status, dueDate: d.dueDate }, today), acceptedAt: r.acceptedAt, document: d })));
  });

  async function requestOf(actor: Actor, id: string) {
    const db = getDb();
    const [row] = await db.select({ r: ackRequests, d: ackDocuments, name: employees.name, number: employees.number }).from(ackRequests)
      .innerJoin(ackDocuments, eq(ackDocuments.id, ackRequests.documentId)).innerJoin(employees, eq(employees.id, ackRequests.employeeId))
      .where(and(eq(ackRequests.id, id), eq(ackRequests.companyId, actor.companyId)));
    // Só o próprio e o RH vêem o pedido e a prova.
    if (!row || (row.r.employeeId !== actor.employeeId && !HR(actor))) throw new DomainError('nao_encontrado', 'Documento inexistente', 404);
    return row;
  }

  app.get('/v1/acknowledgements/:id', async (c) => {
    const actor = c.get('actor'), db = getDb(), today = luandaDate(new Date());
    const { r, d, name, number } = await requestOf(actor, c.req.param('id'));
    const [by] = r.acceptedBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, r.acceptedBy)) : [];
    return c.json({ id: r.id, status: r.status, state: ackState({ status: r.status, dueDate: d.dueDate }, today), employee: { id: r.employeeId, name, number },
      canAccept: r.status === 'pending' && d.status === 'published' && actor.employeeId === r.employeeId,
      document: { id: d.id, title: d.title, body: d.body, category: d.category, version: d.version, status: d.status, dueDate: d.dueDate, publishedAt: d.publishedAt, contentSha256: d.contentSha256, files: (await ackFiles(db, actor.companyId, d.id)).map(fileView) },
      proof: r.status === 'accepted' ? { acceptedAt: r.acceptedAt, acceptedByName: by?.name ?? null, ip: r.acceptedIp, userAgent: r.acceptedUserAgent, contentSha256: r.acceptedSha256 } : null });
  });

  /** Aceitar: só o próprio, sobre o conteúdo exacto publicado (a impressão digital enviada tem de coincidir). */
  app.post('/v1/acknowledgements/:id/accept', async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ confirm: z.literal(true, { message: 'Confirme que leu e aceita o documento' }), contentSha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(await body(c));
    const { r, d } = await requestOf(actor, c.req.param('id'));
    if (actor.employeeId !== r.employeeId) return c.json({ error: 'sem_permissao', message: 'Só o próprio colaborador aceita um documento.' }, 403);
    const [locked] = await db.select().from(ackRequests).where(eq(ackRequests.id, r.id)).for('update');
    if (locked!.status === 'accepted') return c.json({ id: r.id, status: 'accepted', acceptedAt: locked!.acceptedAt });
    if (locked!.status !== 'pending' || d.status !== 'published') throw new DomainError('documento_substituido', 'Este documento foi substituído ou arquivado. Consulte a versão em vigor.', 409);
    if (b.contentSha256 !== d.contentSha256 || (await documentHash(db, d)) !== d.contentSha256) throw new DomainError('conteudo_alterado', 'O conteúdo do documento mudou entretanto. Recarregue a página e leia a versão actual.', 409);
    const [u] = await db.update(ackRequests).set({ status: 'accepted', acceptedAt: new Date(), acceptedBy: actor.actorId, acceptedIp: clientIp(c), acceptedUserAgent: (c.req.header('user-agent') ?? '').slice(0, 300), acceptedSha256: d.contentSha256 })
      .where(eq(ackRequests.id, r.id)).returning();
    await audit(actor, 'accept', 'ack_request', r.id, null, { documentId: d.id, title: d.title, version: d.version, contentSha256: d.contentSha256, ip: u!.acceptedIp });
    const tasks = await completeLinkedTasks(db, { companyId: actor.companyId, employeeId: r.employeeId, category: d.category as AckCategory, title: d.title, version: d.version, actorId: actor.actorId });
    return c.json({ id: u!.id, status: u!.status, acceptedAt: u!.acceptedAt, completedTasks: tasks });
  });

  return app;
}
