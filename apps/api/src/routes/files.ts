/**
 * Ficheiros anexados: cópias de documentos de identificação e outros da ficha (RH e o próprio),
 * justificativos de ausências (o colaborador, a chefia directa e o RH) e comprovativos de despesas.
 * O envio é o corpo do pedido em bruto (sem multipart); o tipo é detectado pelo conteúdo.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { absences, and, auditLogs, desc, employeeDocuments, employees, eq, expenseClaims, files, getDb, type Db } from '@kianda/db';
import { requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { canSee } from '../services/scope.js';
import { MAX_FILE_BYTES, readFileData, removeFiles, storeFile } from '../services/storage.js';

export const FILE_ENTITIES = ['employee', 'employee_document', 'absence', 'expense_claim'] as const;
type Entity = (typeof FILE_ENTITIES)[number];

const HR = (a: Actor) => a.role === 'owner' || a.role === 'hr_admin';
const notFound = () => new DomainError('nao_encontrado', 'Registo inexistente', 404);

/** Quem pode ver e anexar em cada registo. Registos de outra empresa não existem (RLS + filtro). */
export async function fileAccess(db: Db, actor: Actor, entity: Entity, entityId: string): Promise<{ employeeId: string | null; read: boolean; write: boolean }> {
  if (entity === 'employee' || entity === 'employee_document') {
    let employeeId = entityId;
    if (entity === 'employee_document') {
      const [d] = await db.select({ e: employeeDocuments.employeeId }).from(employeeDocuments).where(and(eq(employeeDocuments.id, entityId), eq(employeeDocuments.companyId, actor.companyId)));
      if (!d) throw notFound();
      employeeId = d.e;
    } else {
      const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, entityId), eq(employees.companyId, actor.companyId)));
      if (!e) throw notFound();
    }
    // Documentos pessoais: só o RH e o próprio (a chefia não vê cópias do BI ou do passaporte).
    return { employeeId, read: HR(actor) || actor.employeeId === employeeId, write: HR(actor) };
  }
  if (entity === 'absence') {
    const [a] = await db.select({ employeeId: absences.employeeId, status: absences.status, managerId: employees.managerId }).from(absences)
      .innerJoin(employees, eq(employees.id, absences.employeeId)).where(and(eq(absences.id, entityId), eq(absences.companyId, actor.companyId)));
    if (!a) throw notFound();
    const read = await canSee(db, actor, a.employeeId);
    const involved = actor.employeeId === a.employeeId || HR(actor) || (actor.role === 'manager' && !!actor.employeeId && a.managerId === actor.employeeId);
    return { employeeId: a.employeeId, read, write: involved && a.status !== 'cancelled' };
  }
  const [c] = await db.select().from(expenseClaims).where(and(eq(expenseClaims.id, entityId), eq(expenseClaims.companyId, actor.companyId)));
  if (!c) throw notFound();
  const mine = actor.employeeId === c.employeeId || actor.actorId === c.createdBy;
  const staff = ['owner', 'hr_admin', 'finance'].includes(actor.role);
  return {
    employeeId: c.employeeId,
    read: mine || (await canSee(db, actor, c.employeeId)),
    // Os comprovativos fazem parte da nota: só se mexem enquanto está em rascunho ou recusada.
    write: (c.status === 'draft' || c.status === 'rejected') && (mine || staff),
  };
}

const target = z.object({ entity: z.enum(FILE_ENTITIES), entityId: z.string().min(1).max(64) });
const view = (f: typeof files.$inferSelect) => ({ id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes, createdAt: f.createdAt, url: `/api/v1/files/${f.id}` });

async function fileById(db: Db, actor: Actor, id: string) {
  const [f] = await db.select().from(files).where(and(eq(files.id, id), eq(files.companyId, actor.companyId)));
  if (!f) throw new DomainError('nao_encontrado', 'Ficheiro inexistente', 404);
  return { f, access: await fileAccess(db, actor, f.entity as Entity, f.entityId) };
}

export function fileRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/files', requireCompany);
  app.use('/v1/files/*', requireCompany);

  app.get('/v1/files', async (c) => {
    const actor = c.get('actor');
    const t = target.parse(c.req.query());
    const db = getDb();
    const acc = await fileAccess(db, actor, t.entity, t.entityId);
    if (!acc.read) throw new DomainError('sem_permissao', 'Não pode ver os ficheiros deste registo', 403);
    const rows = await db.select().from(files).where(and(eq(files.companyId, actor.companyId), eq(files.entity, t.entity), eq(files.entityId, t.entityId))).orderBy(desc(files.createdAt));
    return c.json({ files: rows.map(view), canUpload: acc.write, maxBytes: MAX_FILE_BYTES });
  });

  app.post('/v1/files', async (c) => {
    const actor = c.get('actor');
    const t = target.parse(c.req.query());
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_FILE_BYTES) throw new DomainError('ficheiro_grande', 'O ficheiro passa o limite de 5 MB — reduza a resolução ou divida o PDF', 413);
    const db = getDb();
    const acc = await fileAccess(db, actor, t.entity, t.entityId);
    if (!acc.write) throw new DomainError('sem_permissao', 'Não pode anexar ficheiros a este registo', 403);
    const data = new Uint8Array(await c.req.arrayBuffer());
    const f = await storeFile(db, { companyId: actor.companyId, entity: t.entity, entityId: t.entityId, employeeId: acc.employeeId, name: c.req.query('name'), uploadedBy: actor.actorId, data });
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'file_upload', entity: t.entity, entityId: t.entityId, after: { fileId: f.id, name: f.name, sizeBytes: f.sizeBytes, sha256: f.sha256 } });
    return c.json(view(f), 201);
  });

  app.get('/v1/files/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { f, access } = await fileById(db, actor, c.req.param('id'));
    if (!access.read) throw new DomainError('nao_encontrado', 'Ficheiro inexistente', 404);
    const data = await readFileData(db, f);
    const disposition = c.req.query('download') ? 'attachment' : 'inline';
    return new Response(data, {
      headers: {
        'content-type': f.mime,
        'content-disposition': `${disposition}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

  app.delete('/v1/files/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { f, access } = await fileById(db, actor, c.req.param('id'));
    if (!access.write) throw new DomainError('sem_permissao', 'Não pode remover ficheiros deste registo', 403);
    await removeFiles(db, [f]);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'file_delete', entity: f.entity, entityId: f.entityId, before: { fileId: f.id, name: f.name, sha256: f.sha256 } });
    return c.json({ ok: true });
  });

  return app;
}
