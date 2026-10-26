import {
  cycleProblems, DEFAULT_COMPETENCIES, ratingDistribution, ratingLabel, RECOMMENDATIONS, reviewScore, type Competency, type Objective,
} from '@kianda/core';
import { and, asc, auditLogs, contracts, desc, employees, eq, getDb, inArray, reviewCycles, reviews, sql, type Db } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const isHr = (a: Actor) => a.role === 'owner' || a.role === 'hr_admin';
const competencyBody = z.object({ key: z.string().trim().regex(/^[a-z0-9_]+$/).max(40), label: z.string().trim().min(2).max(120), weight: z.number().int().min(1).max(100) });
const cycleBody = z.object({
  name: z.string().trim().min(3).max(120), periodFrom: z.iso.date(), periodTo: z.iso.date(), deadline: z.iso.date().optional().nullable(),
  selfReview: z.boolean().default(true), competencies: z.array(competencyBody).max(20).optional(), competencyWeight: z.number().int().min(0).max(100).default(60),
}).refine((b) => b.periodFrom <= b.periodTo, { message: 'O fim do período é anterior ao início', path: ['periodTo'] });
const scoresBody = z.record(z.string(), z.number().int().min(1).max(5).nullable());

async function cycle(db: Db, actor: Actor, id: string) {
  const [x] = await db.select().from(reviewCycles).where(and(eq(reviewCycles.id, id), eq(reviewCycles.companyId, actor.companyId)));
  if (!x) throw new DomainError('nao_encontrado', 'Ciclo inexistente', 404);
  return x;
}

/** A avaliação e o papel do actor nela (RH, avaliado, avaliador). */
async function review(db: Db, actor: Actor, id: string) {
  const [r] = await db.select().from(reviews).where(and(eq(reviews.id, id), eq(reviews.companyId, actor.companyId)));
  if (!r) throw new DomainError('nao_encontrado', 'Avaliação inexistente', 404);
  const self = actor.employeeId === r.employeeId;
  const reviewer = Boolean(actor.employeeId) && actor.employeeId === r.reviewerEmployeeId && !self;
  const hr = isHr(actor) && !(self && actor.role !== 'owner');
  if (!self && !reviewer && !hr) throw new DomainError('nao_encontrado', 'Avaliação inexistente', 404);
  const c = await cycle(db, actor, r.cycleId);
  return { r, c, self, reviewer, hr };
}

function score(c: typeof reviewCycles.$inferSelect, r: typeof reviews.$inferSelect) {
  return reviewScore(c.competencies as Competency[], r.managerScores as Record<string, number>, r.objectives as Objective[], c.competencyWeight);
}

export function performanceRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/review-cycles', '/v1/review-cycles/*', '/v1/reviews', '/v1/reviews/*']) app.use(p, requireCompany);

  app.get('/v1/review-cycles', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) return c.json([]);
    const db = getDb();
    const cycles = await db.select().from(reviewCycles).where(eq(reviewCycles.companyId, actor.companyId)).orderBy(desc(reviewCycles.periodTo));
    const counts = cycles.length ? await db.select({ cycleId: reviews.cycleId, status: reviews.status, n: sql<number>`count(*)::int` }).from(reviews)
      .where(inArray(reviews.cycleId, cycles.map((x) => x.id))).groupBy(reviews.cycleId, reviews.status) : [];
    return c.json(cycles.map((x) => {
      const mine = counts.filter((k) => k.cycleId === x.id);
      return { ...x, total: mine.reduce((s, k) => s + k.n, 0), done: mine.filter((k) => k.status === 'done' || k.status === 'acknowledgement').reduce((s, k) => s + k.n, 0) };
    }));
  });

  app.post('/v1/review-cycles', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH cria ciclos de avaliação', 403);
    const b = cycleBody.parse(await body(c));
    const competencies = b.competencies ?? DEFAULT_COMPETENCIES;
    const problems = cycleProblems(competencies, b.competencyWeight);
    if (problems.length) throw new DomainError('ciclo_invalido', problems.join(' · '), 400);
    const [x] = await getDb().insert(reviewCycles).values({ companyId: actor.companyId, ...b, competencies, createdBy: actor.actorId }).returning();
    return c.json(x, 201);
  });

  app.patch('/v1/review-cycles/:id', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH altera ciclos', 403);
    const db = getDb();
    const x = await cycle(db, actor, c.req.param('id'));
    if (x.status !== 'draft') throw new DomainError('estado_invalido', 'Só se altera um ciclo em preparação');
    const b = cycleBody.parse(await body(c));
    const competencies = b.competencies ?? (x.competencies as Competency[]);
    const problems = cycleProblems(competencies, b.competencyWeight);
    if (problems.length) throw new DomainError('ciclo_invalido', problems.join(' · '), 400);
    const [u] = await db.update(reviewCycles).set({ ...b, competencies }).where(eq(reviewCycles.id, x.id)).returning();
    return c.json(u);
  });

  /** Lançar: cria uma avaliação por colaborador activo admitido até ao fim do período; avaliador = chefia directa. */
  app.post('/v1/review-cycles/:id/launch', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH lança ciclos', 403);
    const db = getDb();
    const x = await cycle(db, actor, c.req.param('id'));
    if (x.status !== 'draft') throw new DomainError('estado_invalido', 'O ciclo já foi lançado');
    const active = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(and(eq(employees.companyId, actor.companyId), eq(employees.status, 'active')));
    const hires = active.length ? await db.select({ id: contracts.employeeId, start: sql<string>`min(${contracts.startDate})` }).from(contracts).where(inArray(contracts.employeeId, active.map((e) => e.id))).groupBy(contracts.employeeId) : [];
    const staff = active.filter((e) => { const h = hires.find((x) => x.id === e.id)?.start; return h && h <= x.periodTo; });
    if (!staff.length) throw new DomainError('sem_colaboradores', 'Não há colaboradores activos para avaliar');
    await db.transaction(async (tx) => {
      await tx.insert(reviews).values(staff.map((e) => ({ companyId: actor.companyId, cycleId: x.id, employeeId: e.id, reviewerEmployeeId: e.managerId, status: x.selfReview ? 'self' : 'manager' })));
      await tx.update(reviewCycles).set({ status: 'open', launchedAt: new Date() }).where(eq(reviewCycles.id, x.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'launch', entity: 'review_cycle', entityId: x.id, after: { reviews: staff.length } });
    });
    return c.json({ ok: true, reviews: staff.length });
  });

  app.post('/v1/review-cycles/:id/close', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('sem_permissao', 'Só o RH fecha ciclos', 403);
    const db = getDb();
    const x = await cycle(db, actor, c.req.param('id'));
    if (x.status !== 'open') throw new DomainError('estado_invalido', 'O ciclo não está aberto');
    const [u] = await db.update(reviewCycles).set({ status: 'closed', closedAt: new Date() }).where(eq(reviewCycles.id, x.id)).returning();
    return c.json(u);
  });

  /** Ciclo com o estado de cada avaliação e a distribuição das notas (calibração). */
  app.get('/v1/review-cycles/:id', async (c) => {
    const actor = c.get('actor');
    if (!isHr(actor)) throw new DomainError('nao_encontrado', 'Ciclo inexistente', 404);
    const db = getDb();
    const x = await cycle(db, actor, c.req.param('id'));
    const rows = await db.select({ r: reviews, name: employees.name, number: employees.number, jobTitle: employees.jobTitle }).from(reviews)
      .innerJoin(employees, eq(employees.id, reviews.employeeId)).where(eq(reviews.cycleId, x.id)).orderBy(asc(employees.number));
    const names = new Map((await db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.companyId, actor.companyId))).map((e) => [e.id, e.name]));
    const list = rows.map(({ r, name, number, jobTitle }) => ({
      id: r.id, employeeId: r.employeeId, employeeName: name, number, jobTitle, reviewerName: r.reviewerEmployeeId ? names.get(r.reviewerEmployeeId) ?? '—' : 'RH',
      status: r.status, finalScore: r.finalScore === null ? null : Number(r.finalScore), rating: ratingLabel(r.finalScore === null ? null : Number(r.finalScore)), recommendation: r.recommendation,
    }));
    return c.json({ ...x, reviews: list, distribution: ratingDistribution(list.map((l) => l.finalScore)) });
  });

  /** As minhas avaliações (como avaliado) e as que tenho de fazer (como chefia). */
  app.get('/v1/reviews', async (c) => {
    const actor = c.get('actor');
    if (!actor.employeeId) return c.json({ mine: [], team: [] });
    const db = getDb();
    const sel = { r: reviews, cycleName: reviewCycles.name, cycleStatus: reviewCycles.status, deadline: reviewCycles.deadline, name: employees.name };
    const mine = await db.select(sel).from(reviews).innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId)).innerJoin(employees, eq(employees.id, reviews.employeeId))
      .where(and(eq(reviews.employeeId, actor.employeeId), inArray(reviewCycles.status, ['open', 'closed']))).orderBy(desc(reviewCycles.periodTo));
    const team = await db.select(sel).from(reviews).innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId)).innerJoin(employees, eq(employees.id, reviews.employeeId))
      .where(and(eq(reviews.reviewerEmployeeId, actor.employeeId), inArray(reviewCycles.status, ['open', 'closed']))).orderBy(asc(employees.name));
    const map = (x: (typeof mine)[number]) => ({ id: x.r.id, cycleName: x.cycleName, cycleStatus: x.cycleStatus, deadline: x.deadline, employeeName: x.name, status: x.r.status, finalScore: x.r.status === 'self' || x.r.status === 'manager' ? null : x.r.finalScore });
    return c.json({ mine: mine.map(map), team: team.map(map) });
  });

  app.get('/v1/reviews/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { r, c: cy, self, reviewer, hr } = await review(db, actor, c.req.param('id'));
    const [e] = await db.select({ name: employees.name, jobTitle: employees.jobTitle, number: employees.number }).from(employees).where(eq(employees.id, r.employeeId));
    const [m] = r.reviewerEmployeeId ? await db.select({ name: employees.name }).from(employees).where(eq(employees.id, r.reviewerEmployeeId)) : [];
    const managerVisible = hr || reviewer || ['acknowledgement', 'done'].includes(r.status);
    const open = cy.status === 'open';
    const s = score(cy, r);
    return c.json({
      ...r, managerScores: managerVisible ? r.managerScores : {}, managerComment: managerVisible ? r.managerComment : null, recommendation: managerVisible ? r.recommendation : null,
      finalScore: managerVisible && r.finalScore !== null ? Number(r.finalScore) : null, rating: managerVisible ? ratingLabel(r.finalScore === null ? null : Number(r.finalScore)) : null,
      preview: managerVisible ? s : null,
      cycle: { id: cy.id, name: cy.name, periodFrom: cy.periodFrom, periodTo: cy.periodTo, deadline: cy.deadline, status: cy.status, selfReview: cy.selfReview, competencies: cy.competencies, competencyWeight: cy.competencyWeight },
      employee: e, reviewerName: m?.name ?? 'RH', role: self ? 'self' : reviewer ? 'reviewer' : 'hr',
      can: {
        self: open && self && r.status === 'self',
        objectives: open && (reviewer || hr) && ['self', 'manager'].includes(r.status),
        manager: open && (reviewer || hr) && r.status === 'manager',
        skipSelf: open && hr && r.status === 'self',
        acknowledge: open && self && r.status === 'acknowledgement',
        reopen: open && hr && ['acknowledgement', 'done'].includes(r.status),
      },
      recommendations: RECOMMENDATIONS,
    });
  });

  app.put('/v1/reviews/:id/objectives', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ objectives: z.array(z.object({ title: z.string().trim().min(3).max(200), weight: z.number().int().min(0).max(100), result: z.string().trim().max(1000).optional().nullable(), score: z.number().int().min(1).max(5).optional().nullable() })).max(10) }).parse(await body(c));
    const db = getDb();
    const { r, c: cy, reviewer, hr } = await review(db, actor, c.req.param('id'));
    if (cy.status !== 'open' || !(reviewer || hr) || !['self', 'manager'].includes(r.status)) throw new DomainError('estado_invalido', 'Os objectivos já não podem ser alterados');
    const sum = b.objectives.reduce((s, o) => s + o.weight, 0);
    if (b.objectives.length && sum !== 100) throw new DomainError('pesos_invalidos', `Os pesos dos objectivos somam ${sum}% (têm de somar 100%)`, 400);
    const [u] = await db.update(reviews).set({ objectives: b.objectives, updatedAt: new Date() }).where(eq(reviews.id, r.id)).returning();
    return c.json(u);
  });

  app.put('/v1/reviews/:id/self', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ scores: scoresBody, comment: z.string().trim().max(3000).optional().nullable(), submit: z.boolean().default(false) }).parse(await body(c));
    const db = getDb();
    const { r, c: cy, self } = await review(db, actor, c.req.param('id'));
    if (!self || cy.status !== 'open' || r.status !== 'self') throw new DomainError('estado_invalido', 'A auto-avaliação já não pode ser alterada');
    const comps = cy.competencies as Competency[];
    if (b.submit && comps.some((k) => typeof b.scores[k.key] !== 'number')) throw new DomainError('incompleta', 'Classifique todas as competências antes de submeter', 400);
    const [u] = await db.update(reviews).set({ selfScores: b.scores, selfComment: b.comment ?? null, ...(b.submit ? { status: 'manager', selfSubmittedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(reviews.id, r.id)).returning();
    return c.json(u);
  });

  /** RH dispensa a auto-avaliação (ex.: colaborador ausente). */
  app.post('/v1/reviews/:id/skip-self', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { r, hr } = await review(db, actor, c.req.param('id'));
    if (!hr || r.status !== 'self') throw new DomainError('estado_invalido', 'Só o RH dispensa a auto-avaliação pendente');
    const [u] = await db.update(reviews).set({ status: 'manager', updatedAt: new Date() }).where(eq(reviews.id, r.id)).returning();
    return c.json(u);
  });

  app.put('/v1/reviews/:id/manager', async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      scores: scoresBody, objectives: z.array(z.object({ result: z.string().trim().max(1000).optional().nullable(), score: z.number().int().min(1).max(5).nullable().optional() })).max(10).optional(),
      comment: z.string().trim().max(3000).optional().nullable(), recommendation: z.enum(Object.keys(RECOMMENDATIONS) as [keyof typeof RECOMMENDATIONS]).optional().nullable(), submit: z.boolean().default(false),
    }).parse(await body(c));
    const db = getDb();
    const { r, c: cy, reviewer, hr } = await review(db, actor, c.req.param('id'));
    if (!(reviewer || hr) || cy.status !== 'open' || r.status !== 'manager') throw new DomainError('estado_invalido', 'A avaliação da chefia não está disponível');
    const objectives = (r.objectives as Objective[]).map((o, i) => ({ ...o, result: b.objectives?.[i]?.result ?? o.result ?? null, score: b.objectives?.[i]?.score ?? o.score ?? null }));
    const s = reviewScore(cy.competencies as Competency[], b.scores as Record<string, number>, objectives, cy.competencyWeight);
    if (b.submit && !s.complete) throw new DomainError('incompleta', 'Classifique todas as competências e objectivos antes de submeter', 400);
    if (b.submit && !b.comment) throw new DomainError('comentario_obrigatorio', 'Escreva um comentário de fecho para o colaborador', 400);
    const [u] = await db.update(reviews).set({
      managerScores: b.scores, objectives, managerComment: b.comment ?? null, recommendation: b.recommendation ?? null, finalScore: s.final === null ? null : String(s.final),
      ...(b.submit ? { status: 'acknowledgement', managerSubmittedAt: new Date(), managerSubmittedBy: actor.actorId } : {}), updatedAt: new Date(),
    }).where(eq(reviews.id, r.id)).returning();
    if (b.submit) await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'submit', entity: 'review', entityId: r.id, after: { finalScore: s.final } });
    return c.json(u);
  });

  /** O colaborador toma conhecimento (pode deixar um comentário, inclusive de discordância). */
  app.post('/v1/reviews/:id/acknowledge', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ comment: z.string().trim().max(3000).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const { r, self } = await review(db, actor, c.req.param('id'));
    if (!self || r.status !== 'acknowledgement') throw new DomainError('estado_invalido', 'Não há avaliação para tomar conhecimento');
    const [u] = await db.update(reviews).set({ status: 'done', employeeComment: b.comment ?? null, acknowledgedAt: new Date(), updatedAt: new Date() }).where(eq(reviews.id, r.id)).returning();
    return c.json(u);
  });

  app.post('/v1/reviews/:id/reopen', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { r, hr } = await review(db, actor, c.req.param('id'));
    if (!hr || !['acknowledgement', 'done'].includes(r.status)) throw new DomainError('estado_invalido', 'Só o RH reabre avaliações submetidas');
    const [u] = await db.update(reviews).set({ status: 'manager', acknowledgedAt: null, updatedAt: new Date() }).where(eq(reviews.id, r.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'reopen', entity: 'review', entityId: r.id, before: r });
    return c.json(u);
  });

  return app;
}
