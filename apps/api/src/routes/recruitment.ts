import { luandaDate, openingAcceptsApplications, pipelineStats, publicOpeningPath, SOURCES, STAGES, stageTransitionProblem, type Stage } from '@kianda/core';
import {
  and, asc, auditLogs, candidateEvents, candidates, departments, desc, employees, eq, getDb, inArray, jobOpenings, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const isHr = (a: Actor) => a.role === 'owner' || a.role === 'hr_admin';
const kz = z.number().nonnegative().max(1e11);
const toMinor = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));

const openingFields = z.object({
  title: z.string().trim().min(3, 'Indique o título da vaga').max(120),
  departmentId: z.string().optional().nullable(),
  hiringManagerId: z.string().optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  contractType: z.enum(['indefinite', 'fixed_term', 'internship']),
  positions: z.number().int().min(1).max(500),
  salaryMin: kz.optional().nullable(),
  salaryMax: kz.optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  requirements: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(['draft', 'open', 'on_hold', 'closed']),
  isPublic: z.boolean(),
  closesOn: z.iso.date().optional().nullable(),
});
const openingBody = openingFields.extend({
  contractType: openingFields.shape.contractType.default('indefinite'), positions: openingFields.shape.positions.default(1),
  status: openingFields.shape.status.default('draft'), isPublic: openingFields.shape.isPublic.default(false),
}).refine((b) => b.salaryMin == null || b.salaryMax == null || b.salaryMin <= b.salaryMax, { message: 'Mínimo acima do máximo', path: ['salaryMax'] });

const openingView = (o: typeof jobOpenings.$inferSelect) => ({ ...o, publicPath: publicOpeningPath(o.companyId, o.id), acceptingApplications: openingAcceptsApplications(o, luandaDate(new Date())) });

async function checkOpening(db: Db, companyId: string, b: z.infer<typeof openingBody>) {
  if (b.departmentId && !(await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, b.departmentId), eq(departments.companyId, companyId)))).length) throw new DomainError('departamento_invalido', 'Escolha um departamento desta empresa', 400);
  if (b.hiringManagerId && !(await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.hiringManagerId), eq(employees.companyId, companyId)))).length) throw new DomainError('chefia_invalida', 'Escolha uma chefia desta empresa', 400);
  if (b.isPublic && b.status === 'open' && b.closesOn && b.closesOn < luandaDate(new Date())) throw new DomainError('prazo_vencido', 'Actualize o prazo de candidatura antes de publicar', 400);
}

const candidateBody = z.object({
  name: z.string().trim().min(3, 'Indique o nome').max(120),
  email: z.email().optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  source: z.enum(Object.keys(SOURCES) as [keyof typeof SOURCES]).default('other'),
  cvUrl: z.url().optional().nullable().or(z.literal('')),
  coverLetter: z.string().trim().max(5000).optional().nullable(),
  expectedSalary: kz.optional().nullable(),
  availableFrom: z.iso.date().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

async function opening(db: Db, actor: Actor, id: string, lock = false) {
  const query = db.select().from(jobOpenings).where(and(eq(jobOpenings.id, id), eq(jobOpenings.companyId, actor.companyId)));
  const [o] = lock ? await query.for('update') : await query;
  if (!o || (!isHr(actor) && (!actor.employeeId || o.hiringManagerId !== actor.employeeId))) throw new DomainError('nao_encontrado', 'Vaga inexistente', 404);
  return o;
}

async function candidate(db: Db, actor: Actor, id: string, lockOpening = false) {
  const [c] = await db.select().from(candidates).where(and(eq(candidates.id, id), eq(candidates.companyId, actor.companyId)));
  if (!c) throw new DomainError('nao_encontrado', 'Candidato inexistente', 404);
  const o = await opening(db, actor, c.openingId, lockOpening);
  return { c, o };
}

const event = (db: Db, actor: Actor, v: Omit<typeof candidateEvents.$inferInsert, 'actorId' | 'actorName'>) =>
  db.insert(candidateEvents).values({ ...v, actorId: actor.actorId, actorName: actor.session.name ?? null });

export function recruitmentRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/openings', '/v1/openings/*', '/v1/candidates/*']) app.use(p, requireCompany);

  /** Vagas: RH vê todas; a chefia vê aquelas de que é responsável. */
  app.get('/v1/openings', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor) && actor.role !== 'manager') return c.json([]);
    const db = getDb();
    const where = [eq(jobOpenings.companyId, actor.companyId)];
    if (!isHr(actor)) where.push(eq(jobOpenings.hiringManagerId, actor.employeeId ?? '-'));
    const rows = await db.select({ o: jobOpenings, dept: departments.name, manager: employees.name }).from(jobOpenings)
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId)).leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerId))
      .where(and(...where)).orderBy(desc(jobOpenings.createdAt));
    const cs = rows.length ? await db.select({ id: candidates.id, name: candidates.name, rating: candidates.rating, openingId: candidates.openingId, stage: candidates.stage, source: candidates.source, createdAt: candidates.createdAt, hiredAt: candidates.hiredAt })
      .from(candidates).where(inArray(candidates.openingId, rows.map((r) => r.o.id))) : [];
    return c.json(rows.map(({ o, dept, manager }) => ({
      ...openingView(o), departmentName: dept, hiringManagerName: manager,
      ...(c.req.query('includeCandidates') === '1' ? { candidates: cs.filter(x => x.openingId === o.id).map(x => ({ id: x.id, name: x.name, rating: x.rating, stage: x.stage, source: x.source })) } : {}),
      stats: pipelineStats(cs.filter((x) => x.openingId === o.id).map((x) => ({ stage: x.stage as Stage, source: x.source, createdAt: x.createdAt.toISOString(), hiredAt: x.hiredAt?.toISOString() ?? null }))),
    })));
  });

  app.post('/v1/openings', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH cria vagas', 403);
    const b = openingBody.parse(await body(c));
    await checkOpening(getDb(), actor.companyId, b);
    const { salaryMin, salaryMax, ...rest } = b;
    const [o] = await getDb().insert(jobOpenings).values({ companyId: actor.companyId, ...rest, isPublic: b.status === 'open' && b.isPublic, salaryMinMinor: toMinor(salaryMin), salaryMaxMinor: toMinor(salaryMax), createdBy: actor.actorId, closedAt: b.status === 'closed' ? new Date() : null }).returning();
    await getDb().insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'job_opening', entityId: o!.id, after: o });
    return c.json(openingView(o!), 201);
  });

  app.patch('/v1/openings/:id', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH altera vagas', 403);
    const db = getDb();
    const before = await opening(db, actor, c.req.param('id'), true);
    const patch = openingFields.partial().parse(await body(c));
    const b = openingBody.parse({ ...before, salaryMin: before.salaryMinMinor == null ? null : before.salaryMinMinor / 100, salaryMax: before.salaryMaxMinor == null ? null : before.salaryMaxMinor / 100, ...patch });
    await checkOpening(db, actor.companyId, b);
    const { salaryMin, salaryMax, ...rest } = b;
    const [o] = await db.update(jobOpenings).set({
      ...rest,
      salaryMinMinor: toMinor(salaryMin), salaryMaxMinor: toMinor(salaryMax),
      isPublic: b.status === 'open' && b.isPublic,
      closedAt: b.status === 'closed' ? before.closedAt ?? new Date() : null,
    }).where(and(eq(jobOpenings.id, before.id), eq(jobOpenings.companyId, actor.companyId), eq(jobOpenings.status, before.status))).returning();
    if (!o) throw new DomainError('vaga_alterada', 'A vaga foi alterada entretanto. Actualize o ecrã e tente novamente.', 409);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'job_opening', entityId: before.id, before, after: o });
    return c.json(openingView(o));
  });

  app.get('/v1/openings/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const o = await opening(db, actor, c.req.param('id'));
    const cs = await db.select().from(candidates).where(eq(candidates.openingId, o.id)).orderBy(asc(candidates.createdAt));
    return c.json({
      ...openingView(o), canEdit: isHr(actor),
      candidates: cs.map((x) => ({ ...x, cvUrl: x.cvUrl })),
      stats: pipelineStats(cs.map((x) => ({ stage: x.stage as Stage, source: x.source, createdAt: x.createdAt.toISOString(), hiredAt: x.hiredAt?.toISOString() ?? null }))),
    });
  });

  app.post('/v1/openings/:id/candidates', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const o = await opening(db, actor, c.req.param('id'));
    if (o.status === 'closed') throw new DomainError('vaga_fechada', 'A vaga está fechada');
    const b = candidateBody.parse(await body(c));
    const [x] = await db.insert(candidates).values({
      companyId: actor.companyId, openingId: o.id, name: b.name, email: b.email || null, phone: b.phone ?? null, source: b.source, cvUrl: b.cvUrl || null,
      coverLetter: b.coverLetter ?? null, expectedSalaryMinor: toMinor(b.expectedSalary), availableFrom: b.availableFrom ?? null,
    }).returning();
    await event(db, actor, { candidateId: x!.id, kind: 'stage', toStage: 'applied', text: b.note ?? `Registado por ${actor.session.name ?? 'RH'}` });
    return c.json(x, 201);
  });

  app.get('/v1/candidates/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { c: x, o } = await candidate(db, actor, c.req.param('id'));
    const events = await db.select().from(candidateEvents).where(eq(candidateEvents.candidateId, x.id)).orderBy(desc(candidateEvents.createdAt));
    return c.json({ ...x, opening: { id: o.id, title: o.title, status: o.status, contractType: o.contractType, departmentId: o.departmentId, hiringManagerId: o.hiringManagerId }, events, canHire: isHr(actor) && x.stage === 'offer' && o.status !== 'closed' });
  });

  app.patch('/v1/candidates/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { c: x } = await candidate(db, actor, c.req.param('id'));
    const b = candidateBody.partial().extend({ rating: z.number().int().min(1).max(5).nullable().optional() }).parse(await body(c));
    const { expectedSalary, note: _note, ...rest } = b;
    const [u] = await db.update(candidates).set({
      ...rest, email: rest.email === '' ? null : rest.email, cvUrl: rest.cvUrl === '' ? null : rest.cvUrl,
      ...(expectedSalary !== undefined ? { expectedSalaryMinor: toMinor(expectedSalary) } : {}), updatedAt: new Date(),
    }).where(eq(candidates.id, x.id)).returning();
    return c.json(u);
  });

  /** Mudar de etapa. A contratação faz-se pela admissão (cria a ficha e fecha o candidato). */
  app.post('/v1/candidates/:id/stage', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ stage: z.enum(STAGES), expectedStage: z.enum(STAGES).optional(), reason: z.string().trim().max(500).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const { c: x, o } = await candidate(db, actor, c.req.param('id'), true);
    if (o.status === 'closed') throw new DomainError('vaga_fechada', 'Reabra a vaga antes de avançar candidaturas', 409);
    if (b.expectedStage && b.expectedStage !== x.stage) throw new DomainError('candidatura_alterada', 'A etapa mudou entretanto. Actualize a candidatura.', 409);
    const problem = stageTransitionProblem(x.stage as Stage, b.stage);
    if (problem) throw new DomainError('etapa_invalida', problem, 409);
    if (b.stage === 'hired') throw new DomainError('usar_admissao', 'Para contratar, use "Admitir" — cria a ficha do colaborador', 409);
    if (b.stage === 'rejected' && !b.reason) throw new DomainError('motivo_obrigatorio', 'Indique o motivo da recusa', 400);
    const [u] = await db.update(candidates).set({ stage: b.stage, rejectionReason: b.stage === 'rejected' ? b.reason! : null, updatedAt: new Date() }).where(and(eq(candidates.id, x.id), eq(candidates.stage, x.stage))).returning();
    if (!u) throw new DomainError('candidatura_alterada', 'A etapa mudou entretanto. Actualize a candidatura.', 409);
    await event(db, actor, { candidateId: x.id, kind: 'stage', fromStage: x.stage, toStage: b.stage, text: b.reason ?? null });
    return c.json(u);
  });

  app.post('/v1/candidates/:id/events', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ kind: z.enum(['comment', 'interview']), text: z.string().trim().min(2).max(3000), scheduledAt: z.iso.datetime({ offset: true }).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const { c: x } = await candidate(db, actor, c.req.param('id'));
    if (b.kind === 'interview' && !b.scheduledAt) throw new DomainError('data_obrigatoria', 'Indique a data e hora da entrevista', 400);
    const [e] = await event(db, actor, { candidateId: x.id, kind: b.kind, text: b.text, scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null }).returning();
    return c.json(e, 201);
  });

  return app;
}
