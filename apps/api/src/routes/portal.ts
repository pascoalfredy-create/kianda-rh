import { angolanIbanProblem, normalizeIban } from '@kianda/core';
import {
  absences, and, auditLogs, companies, desc, documentRequests, employees, eq, expenseClaims, getDb, inArray, issuedDocuments, payrollLines, payrollRuns,
  profileChangeRequests, reviewCycles, reviews, sql, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { composeDocument, issueDocument, templatesFor } from './documents.js';

/** Declarações que o colaborador pode pedir no portal. */
export const SELF_SERVICE_TEMPLATES = ['declaracao_servico', 'declaracao_rendimentos'] as const;

/** Dados pessoais que o colaborador pode pedir para alterar (o RH aprova). */
const PROFILE_FIELDS = {
  phone: 'Telefone', email: 'Email pessoal', address: 'Morada', maritalStatus: 'Estado civil',
  emergencyContactName: 'Contacto de emergência', emergencyContactPhone: 'Telefone de emergência', iban: 'IBAN', bank: 'Banco',
} as const;
type ProfileField = keyof typeof PROFILE_FIELDS;

const isHr = (a: Actor) => a.role === 'owner' || a.role === 'hr_admin';
const self = (a: Actor) => {
  if (!a.employeeId) throw new DomainError('sem_ficha', 'O seu utilizador não está associado a uma ficha de colaborador', 403);
  return a.employeeId;
};

async function companyOf(db: Db, id: string) {
  const [co] = await db.select().from(companies).where(eq(companies.id, id));
  return co!;
}

export function portalRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/portal', '/v1/portal/*', '/v1/document-requests', '/v1/document-requests/*', '/v1/profile-requests', '/v1/profile-requests/*']) app.use(p, requireCompany);

  /** Resumo do colaborador para o Início do portal. */
  app.get('/v1/portal', async (c) => {
    const actor = c.get('actor');
    if (!actor.employeeId) return c.json(null);
    const db = getDb();
    const id = actor.employeeId;
    const [slip] = await db.select({ id: payrollLines.id, period: payrollRuns.period, netMinor: payrollLines.netMinor }).from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId)).where(and(eq(payrollLines.employeeId, id), eq(payrollRuns.status, 'closed'))).orderBy(desc(payrollRuns.period)).limit(1);
    const [pendingAbs] = await db.select({ n: sql<number>`count(*)::int` }).from(absences).where(and(eq(absences.employeeId, id), eq(absences.status, 'pending')));
    const exp = await db.select({ status: expenseClaims.status, total: expenseClaims.totalMinor }).from(expenseClaims).where(and(eq(expenseClaims.employeeId, id), inArray(expenseClaims.status, ['draft', 'submitted', 'approved', 'rejected'])));
    const [docs] = await db.select({ n: sql<number>`count(*)::int` }).from(issuedDocuments).where(and(eq(issuedDocuments.employeeId, id), sql`${issuedDocuments.revokedAt} is null`));
    const docReq = await db.select().from(documentRequests).where(eq(documentRequests.employeeId, id)).orderBy(desc(documentRequests.createdAt)).limit(5);
    const profReq = await db.select().from(profileChangeRequests).where(eq(profileChangeRequests.employeeId, id)).orderBy(desc(profileChangeRequests.createdAt)).limit(5);
    const [review] = await db.select({ id: reviews.id, status: reviews.status, cycle: reviewCycles.name }).from(reviews).innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
      .where(and(eq(reviews.employeeId, id), eq(reviewCycles.status, 'open'), inArray(reviews.status, ['self', 'acknowledgement']))).limit(1);
    const co = await companyOf(db, actor.companyId);
    const templates = (await templatesFor(db, actor.companyId)).filter((t) => (SELF_SERVICE_TEMPLATES as readonly string[]).includes(t.key)).map((t) => ({ key: t.key, title: t.title, description: t.description, inputs: t.inputs }));
    return c.json({
      lastPayslip: slip ?? null, pendingAbsences: pendingAbs?.n ?? 0,
      expenses: { open: exp.filter((x) => x.status !== 'approved').length, toReceiveMinor: exp.filter((x) => x.status === 'approved').reduce((s, x) => s + x.total, 0), rejected: exp.filter((x) => x.status === 'rejected').length },
      documents: docs?.n ?? 0, documentRequests: docReq, profileRequests: profReq, review: review ?? null,
      selfService: { templates, autoIssue: co.autoIssueDeclarations },
    });
  });

  /** RH: pedidos do portal por tratar. */
  app.get('/v1/portal/inbox', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const docs = await db.select({ r: documentRequests, name: employees.name, number: employees.number }).from(documentRequests).innerJoin(employees, eq(employees.id, documentRequests.employeeId))
      .where(and(eq(documentRequests.companyId, actor.companyId), eq(documentRequests.status, 'pending'))).orderBy(documentRequests.createdAt);
    const profiles = await db.select({ r: profileChangeRequests, name: employees.name, number: employees.number }).from(profileChangeRequests).innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
      .where(and(eq(profileChangeRequests.companyId, actor.companyId), eq(profileChangeRequests.status, 'pending'))).orderBy(profileChangeRequests.createdAt);
    const titles = Object.fromEntries((await templatesFor(db, actor.companyId)).map((t) => [t.key, t.title]));
    return c.json({
      documents: docs.map(({ r, name, number }) => ({ ...r, employeeName: name, employeeNumber: number, title: titles[r.templateKey] ?? r.templateKey })),
      profiles: profiles.map(({ r, name, number }) => ({ ...r, employeeName: name, employeeNumber: number })),
      labels: PROFILE_FIELDS,
    });
  });

  // ——— Declarações ———

  app.post('/v1/document-requests', async (c) => {
    const actor = c.get('actor');
    const employeeId = self(actor);
    const b = z.object({ templateKey: z.enum(SELF_SERVICE_TEMPLATES), inputs: z.record(z.string().regex(/^pedido\.\w+$/), z.string().trim().max(300)).default({}) }).parse(await body(c));
    const db = getDb();
    // Validar já (campos em falta na ficha ou no pedido), para o colaborador saber o que falta antes de esperar pelo RH.
    const check = await composeDocument(db, actor.companyId, employeeId, b.templateKey, b.inputs);
    const requestMissing = check.missing.filter((k) => k.startsWith('pedido.'));
    if (requestMissing.length) throw new DomainError('campos_em_falta', `Indique: ${check.missingLabels.filter((_, i) => check.missing[i]!.startsWith('pedido.')).join(', ')}`, 400);
    const co = await companyOf(db, actor.companyId);
    const [req] = await db.insert(documentRequests).values({ companyId: actor.companyId, employeeId, templateKey: b.templateKey, inputs: b.inputs, createdBy: actor.actorId }).returning();
    if (co.autoIssueDeclarations && !check.missing.length) {
      const doc = await issueDocument(db, { companyId: actor.companyId, actorId: actor.actorId }, employeeId, b.templateKey, b.inputs);
      const [u] = await db.update(documentRequests).set({ status: 'issued', documentId: doc.id, decidedAt: new Date(), decisionNote: 'Emitida automaticamente' }).where(eq(documentRequests.id, req!.id)).returning();
      return c.json({ ...u, documentNumber: doc.number }, 201);
    }
    return c.json({ ...req, missingInProfile: check.missingLabels.filter((_, i) => !check.missing[i]!.startsWith('pedido.')) }, 201);
  });

  app.get('/v1/document-requests', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const where = [eq(documentRequests.companyId, actor.companyId)];
    if (!isHr(actor) || c.req.query('scope') === 'mine') where.push(eq(documentRequests.employeeId, self(actor)));
    return c.json(await db.select().from(documentRequests).where(and(...where)).orderBy(desc(documentRequests.createdAt)).limit(200));
  });

  app.post('/v1/document-requests/:id/issue', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [r] = await db.select().from(documentRequests).where(and(eq(documentRequests.id, c.req.param('id')), eq(documentRequests.companyId, actor.companyId)));
    if (!r || r.status !== 'pending') throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    const doc = await issueDocument(db, actor, r.employeeId, r.templateKey, r.inputs as Record<string, string>);
    const [u] = await db.update(documentRequests).set({ status: 'issued', documentId: doc.id, decidedBy: actor.actorId, decidedAt: new Date() }).where(eq(documentRequests.id, r.id)).returning();
    return c.json({ ...u, documentNumber: doc.number });
  });

  app.post('/v1/document-requests/:id/reject', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo') }).parse(await body(c));
    const db = getDb();
    const [u] = await db.update(documentRequests).set({ status: 'rejected', decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(documentRequests.id, c.req.param('id')), eq(documentRequests.companyId, actor.companyId), eq(documentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  // ——— Dados pessoais ———

  const changesBody = z.object({
    phone: z.string().trim().max(30).nullable(), email: z.email('Email inválido').nullable().or(z.literal('')), address: z.string().trim().max(200).nullable(),
    maritalStatus: z.string().trim().max(30).nullable(), emergencyContactName: z.string().trim().max(120).nullable(), emergencyContactPhone: z.string().trim().max(30).nullable(),
    iban: z.string().trim().max(40).nullable(), bank: z.string().trim().max(60).nullable(),
  }).partial();

  app.post('/v1/profile-requests', async (c) => {
    const actor = c.get('actor');
    const employeeId = self(actor);
    const b = z.object({ changes: changesBody, note: z.string().trim().max(500).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, actor.companyId)));
    if (!e) throw new DomainError('nao_encontrado', 'Ficha inexistente', 404);
    const changes: Partial<Record<ProfileField, string | null>> = {};
    const previous: Partial<Record<ProfileField, string | null>> = {};
    for (const [k, v] of Object.entries(b.changes) as [ProfileField, string | null | undefined][]) {
      if (v === undefined) continue;
      let value = v === '' ? null : v;
      if (k === 'iban' && value) {
        const problem = angolanIbanProblem(value);
        if (problem) throw new DomainError('iban_invalido', problem, 400);
        value = normalizeIban(value);
      }
      if ((e[k] ?? null) === value) continue;
      changes[k] = value;
      previous[k] = e[k] ?? null;
    }
    if (!Object.keys(changes).length) throw new DomainError('sem_alteracoes', 'Não alterou nenhum dado', 400);
    const [r] = await db.insert(profileChangeRequests).values({ companyId: actor.companyId, employeeId, changes, previous, note: b.note ?? null, createdBy: actor.actorId }).returning();
    return c.json(r, 201);
  });

  app.get('/v1/profile-requests', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const where = [eq(profileChangeRequests.companyId, actor.companyId)];
    if (!isHr(actor) || c.req.query('scope') === 'mine') where.push(eq(profileChangeRequests.employeeId, self(actor)));
    return c.json({ requests: await db.select().from(profileChangeRequests).where(and(...where)).orderBy(desc(profileChangeRequests.createdAt)).limit(200), labels: PROFILE_FIELDS });
  });

  /** Aprovar: aplica as alterações à ficha (com auditoria). Quem pede não aprova o próprio pedido. */
  app.post('/v1/profile-requests/:id/approve', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [r] = await db.select().from(profileChangeRequests).where(and(eq(profileChangeRequests.id, c.req.param('id')), eq(profileChangeRequests.companyId, actor.companyId)));
    if (!r || r.status !== 'pending') throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    if (r.employeeId === actor.employeeId && actor.role !== 'owner') throw new DomainError('sem_permissao', 'Não pode aprovar alterações aos seus próprios dados', 403);
    const [before] = await db.select().from(employees).where(eq(employees.id, r.employeeId));
    if (before?.status === 'terminated') throw new DomainError('colaborador_cessado', 'A ficha de um colaborador cessado não pode ser alterada');
    const u = await db.transaction(async (tx) => {
      await tx.update(employees).set({ ...(r.changes as Record<string, string | null>), updatedAt: new Date() }).where(eq(employees.id, r.employeeId));
      const [x] = await tx.update(profileChangeRequests).set({ status: 'approved', decidedBy: actor.actorId, decidedAt: new Date() }).where(eq(profileChangeRequests.id, r.id)).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'employee', entityId: r.employeeId, before: r.previous as object, after: { ...(r.changes as object), via: 'portal', requestId: r.id } });
      return x!;
    });
    return c.json(u);
  });

  app.post('/v1/profile-requests/:id/reject', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo') }).parse(await body(c));
    const db = getDb();
    const [u] = await db.update(profileChangeRequests).set({ status: 'rejected', decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(profileChangeRequests.id, c.req.param('id')), eq(profileChangeRequests.companyId, actor.companyId), eq(profileChangeRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  /** O colaborador retira um pedido ainda pendente. */
  app.post('/v1/profile-requests/:id/cancel', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [u] = await db.update(profileChangeRequests).set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(profileChangeRequests.id, c.req.param('id')), eq(profileChangeRequests.employeeId, self(actor)), eq(profileChangeRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  return app;
}
