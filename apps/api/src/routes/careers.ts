/** Portal público de candidaturas; não cria contas de acesso à plataforma. */
import { luandaDate, openingAcceptsApplications, publicOpeningPath } from '@kianda/core';
import { and, auditLogs, candidateEvents, candidates, companies, departments, desc, eq, getDb, gte, isNull, jobOpenings, or, sql, type Db } from '@kianda/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { body, clientIp, rateLimit, type AppEnv } from '../plugins/tenant.js';
import { moduleLicence } from '../services/modules.js';
import { DomainError } from '../services/payroll.js';
import { deleteObjects, detectKind, MAX_FILE_BYTES, storeFile } from '../services/storage.js';
import { queueCandidateStage } from '../services/recruitment-mail.js';

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const httpUrl = z.url().max(2000).refine(v => /^https?:\/\//i.test(v), 'Use uma ligação HTTP ou HTTPS');
const applicationBody = z.object({
  name: z.string().trim().min(3, 'Indique o nome completo').max(120),
  email: z.email('Email inválido').max(254).transform(v => v.toLowerCase()),
  phone: z.string().trim().min(9, 'Indique o telefone').max(30),
  cvUrl: httpUrl.optional().nullable().or(z.literal('')),
  coverLetter: optionalText(3000), expectedSalary: z.number().nonnegative().max(1e11).optional().nullable(),
  availableFrom: z.iso.date().optional().nullable(),
  profile: z.object({ currentRole: optionalText(120), yearsExperience: z.number().int().min(0).max(80).optional().nullable(), highestEducation: optionalText(120), fieldOfStudy: optionalText(160), linkedinUrl: httpUrl.optional().nullable().or(z.literal('')), skills: z.array(z.string().trim().min(1).max(100)).max(30).optional(), languages: z.array(z.string().trim().min(1).max(100)).max(20).optional(), certifications: z.array(z.string().trim().min(1).max(100)).max(30).optional() }).optional(),
  consent: z.literal(true, { message: 'É necessário autorizar o tratamento dos dados' }),
  website: z.string().max(0).optional(),
});

const unavailable = () => new DomainError('vaga_indisponivel', 'Esta vaga já não está a receber candidaturas. Consulte as outras oportunidades da empresa.', 404);
const today = () => luandaDate(new Date());
const visible = (companyId: string) => and(eq(jobOpenings.companyId, companyId), eq(jobOpenings.status, 'open'), eq(jobOpenings.isPublic, true), or(isNull(jobOpenings.closesOn), gte(jobOpenings.closesOn, today())));
const publicFields = { id: jobOpenings.id, title: jobOpenings.title, location: jobOpenings.location, contractType: jobOpenings.contractType, positions: jobOpenings.positions, description: jobOpenings.description, requirements: jobOpenings.requirements, closesOn: jobOpenings.closesOn, department: departments.name };
const list = (db: Db, companyId: string) => db.select(publicFields).from(jobOpenings).leftJoin(departments, and(eq(departments.id, jobOpenings.departmentId), eq(departments.companyId, companyId)));
async function company(db: Db, id: string) {
  const [co] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, id));
  if (!co || !(await moduleLicence(db, id, 'hr')).canWrite) throw new DomainError('carreiras_indisponiveis', 'A página de candidaturas está temporariamente indisponível.', 404);
  return co;
}

export function careersRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/public/careers/*', async (c, next) => { c.header('cache-control', 'no-store'); await next(); });
  app.use('/v1/public/careers/*', bodyLimit({ maxSize: MAX_FILE_BYTES + 65536, onError: c => c.json({ error: 'ficheiro_grande', message: 'O CV deve ter até 5 MB.' }, 413) }));
  app.use('/v1/public/careers/*', rateLimit('careers', 15, 3600000));
  app.get('/v1/public/careers/:companyId', async c => {
    const db = getDb(), co = await company(db, c.req.param('companyId'));
    const openings = await list(db, co.id).where(visible(co.id)).orderBy(desc(jobOpenings.createdAt));
    return c.json({ company: co.name, openings: openings.map(o => ({ ...o, publicPath: publicOpeningPath(co.id, o.id) })) });
  });
  app.get('/v1/public/careers/:companyId/openings/:openingId', async c => {
    const db = getDb(), co = await company(db, c.req.param('companyId'));
    const [o] = await list(db, co.id).where(and(visible(co.id), eq(jobOpenings.id, c.req.param('openingId'))));
    if (!o) throw unavailable();
    return c.json({ company: co.name, opening: { ...o, publicPath: publicOpeningPath(co.id, o.id) } });
  });
  app.post('/v1/public/careers/:companyId/openings/:openingId/apply', async c => {
    let payload: unknown, cv: { name: string; data: Uint8Array } | null = null;
    if (c.req.header('content-type')?.startsWith('multipart/form-data')) {
      let form: FormData;
      try { form = await c.req.formData(); } catch { throw new DomainError('formulario_invalido', 'Não foi possível ler a candidatura. Volte a seleccionar o CV.', 400); }
      try { payload = JSON.parse(String(form.get('data') ?? '')); } catch { throw new DomainError('formulario_invalido', 'Dados de candidatura inválidos.', 400); }
      const selected = form.getAll('cv').filter(v => typeof v !== 'string' && v.size > 0);
      if (selected.length > 1) throw new DomainError('cv_unico', 'Seleccione apenas um CV.', 400);
      const f = selected[0];
      if (f && typeof f !== 'string') {
        if (f.size > MAX_FILE_BYTES) throw new DomainError('ficheiro_grande', 'O CV deve ter até 5 MB.', 413);
        cv = { name: f.name, data: new Uint8Array(await f.arrayBuffer()) };
        detectKind(cv.data); // assinatura real; não confiar na extensão ou no MIME declarado
      }
    } else payload = await body(c);
    const b = applicationBody.parse(payload);
    const companyId = c.req.param('companyId'), openingId = c.req.param('openingId');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${companyId}|${clientIp(c)}`)));
    const ipHash = [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
    let stored: { id: string; storage: string } | null = null;
    try {
      const x = await getDb().transaction(async tx => {
        // Serializa a recepção da empresa: duplicados e quotas também são seguros em concorrência.
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
        await company(tx as unknown as Db, companyId);
        const [o] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, openingId), eq(jobOpenings.companyId, companyId))).for('update');
        if (!o || !openingAcceptsApplications(o, today())) throw unavailable();
        const [dup] = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.openingId, o.id), sql`lower(btrim(${candidates.email})) = ${b.email}`)).limit(1);
        if (dup) throw new DomainError('candidatura_repetida', 'Já recebemos uma candidatura com este email para esta vaga. Os dados anteriores foram preservados.', 409);
        if (!cv && !b.cvUrl) throw new DomainError('cv_obrigatorio', 'Anexe o CV ou indique uma ligação para o currículo.', 400);
        const now = new Date(), day = new Date(now.getTime() - 86400000), hour = new Date(now.getTime() - 3600000);
        const [quota] = await tx.select({ daily: sql<number>`count(*)::int`, hourly: sql<number>`count(*) filter (where ${auditLogs.at} >= ${hour} and ${auditLogs.after}->>'ipHash' = ${ipHash})::int` }).from(auditLogs).where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.action, 'public_apply'), gte(auditLogs.at, day)));
        if (Number(quota?.daily ?? 0) >= 200 || Number(quota?.hourly ?? 0) >= 30) throw new DomainError('limite_candidaturas', 'Foram recebidas muitas candidaturas. Tente novamente mais tarde.', 429);
        const [created] = await tx.insert(candidates).values({ companyId, openingId: o.id, name: b.name, email: b.email, phone: b.phone, source: 'site', cvUrl: b.cvUrl || null, coverLetter: b.coverLetter || null, profile: b.profile ?? {}, expectedSalaryMinor: b.expectedSalary == null ? null : Math.round(b.expectedSalary * 100), availableFrom: b.availableFrom ?? null, consentAt: now }).returning({ id: candidates.id });
        const [ev] = await tx.insert(candidateEvents).values({ candidateId: created!.id, kind: 'stage', toStage: 'applied', text: 'Candidatura recebida pelo portal público, com consentimento.', actorName: 'Portal de candidaturas' }).returning();
        await queueCandidateStage(tx as unknown as Db, { id: created!.id, companyId, name: b.name, email: b.email }, o.title, 'applied', ev!.id);
        await tx.insert(auditLogs).values({ companyId, actorId: 'public-careers', action: 'public_apply', entity: 'candidate', entityId: created!.id, after: { openingId, ipHash, hasAttachment: Boolean(cv), consentAt: now.toISOString() } });
        if (cv) stored = await storeFile(tx as unknown as Db, { companyId, entity: 'candidate', entityId: created!.id, employeeId: null, uploadedBy: 'public-careers', name: cv.name, data: cv.data });
        return created!;
      });
      return c.json({ ok: true, reference: `K-${x.id.slice(0, 8).toUpperCase()}`, message: 'Candidatura recebida. A equipa de recrutamento irá contactá-lo caso o seu perfil avance.' }, 201);
    } catch (error) {
      // O conteúdo R2 não participa no rollback PostgreSQL; remover a cópia de uma transacção falhada.
      const f = stored as { id: string; storage: string } | null;
      if (f?.storage === 'r2') await deleteObjects([`${companyId}/${f.id}`]);
      throw error;
    }
  });
  return app;
}
