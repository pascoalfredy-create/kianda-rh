/**
 * Locais de trabalho e regra do ponto com localização (Configuração), quiosque público com código rotativo
 * e lista de excepções de localização para a chefia.
 */
import { KIOSK_STEP_SECONDS, kioskCode, kioskQrPayload, LOCATION_MODES, MAX_RADIUS_M, MIN_RADIUS_M, randomToken, type LocationMode } from '@kianda/core';
import { and, asc, attendanceEntries, auditLogs, companies, desc, employees, eq, getDb, gte, inArray, lte, workplaces } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { visibleEmployeeIds } from '../services/scope.js';

const modes = Object.keys(LOCATION_MODES) as [LocationMode, ...LocationMode[]];
const workplaceBody = z.object({
  name: z.string().trim().min(2, 'Indique o nome do local').max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(MIN_RADIUS_M, `Raio mínimo de ${MIN_RADIUS_M} m`).max(MAX_RADIUS_M, `Raio máximo de ${MAX_RADIUS_M} m`),
  active: z.boolean().default(true),
});
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');
const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number) as [number, number]; return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

const audit = (actor: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) =>
  getDb().insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity, entityId, before: before as object, after: after as object });

/** Vista para a gestão: o token do quiosque só é mostrado a quem gere os locais; o segredo nunca sai. */
const present = (w: typeof workplaces.$inferSelect) => ({
  id: w.id, name: w.name, latitude: w.latitude, longitude: w.longitude, radiusMeters: w.radiusMeters, active: w.active,
  kioskPath: w.kioskToken ? `/quiosque/${w.kioskToken}` : null,
});

async function loadWorkplace(companyId: string, id: string) {
  const [w] = await getDb().select().from(workplaces).where(and(eq(workplaces.id, id), eq(workplaces.companyId, companyId)));
  if (!w) throw new DomainError('nao_encontrado', 'Local de trabalho inexistente', 404);
  return w;
}

export function workplaceRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/workplaces', '/v1/workplaces/*', '/v1/attendance-locations', '/v1/attendance-locations/*']) app.use(p, requireCompany);

  /** Configuração completa: regra, locais e atribuição por colaborador. */
  app.get('/v1/workplaces', requireRole('hr_admin'), async (c) => {
    const { companyId } = c.get('actor'), db = getDb();
    const [company] = await db.select({ mode: companies.punchLocationMode }).from(companies).where(eq(companies.id, companyId));
    const list = await db.select().from(workplaces).where(eq(workplaces.companyId, companyId)).orderBy(asc(workplaces.name));
    const people = await db.select({ id: employees.id, name: employees.name, number: employees.number, workplaceId: employees.workplaceId })
      .from(employees).where(and(eq(employees.companyId, companyId), inArray(employees.status, ['active', 'suspended']))).orderBy(asc(employees.name));
    return c.json({ mode: company?.mode ?? 'off', modes: LOCATION_MODES, workplaces: list.map(present), employees: people });
  });

  app.put('/v1/workplaces/settings', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const { mode } = z.object({ mode: z.enum(modes) }).parse(await body(c));
    const [before] = await db.select({ mode: companies.punchLocationMode }).from(companies).where(eq(companies.id, actor.companyId));
    await db.update(companies).set({ punchLocationMode: mode }).where(eq(companies.id, actor.companyId));
    await audit(actor, 'update', 'punch_location_mode', actor.companyId, before, { mode });
    return c.json({ mode });
  });

  app.post('/v1/workplaces', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = workplaceBody.parse(await body(c));
    const [w] = await getDb().insert(workplaces).values({ ...b, companyId: actor.companyId }).returning();
    await audit(actor, 'create', 'workplace', w!.id, null, present(w!));
    return c.json(present(w!), 201);
  });

  app.patch('/v1/workplaces/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const before = await loadWorkplace(actor.companyId, c.req.param('id'));
    const b = workplaceBody.partial().parse(await body(c));
    const [w] = await getDb().update(workplaces).set({ ...b, updatedAt: new Date() }).where(eq(workplaces.id, before.id)).returning();
    await audit(actor, 'update', 'workplace', before.id, present(before), present(w!));
    return c.json(present(w!));
  });

  /** Eliminar: os colaboradores atribuídos ficam sem local (as marcações antigas conservam o nome do local). */
  app.delete('/v1/workplaces/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const before = await loadWorkplace(actor.companyId, c.req.param('id'));
    await getDb().delete(workplaces).where(eq(workplaces.id, before.id));
    await audit(actor, 'delete', 'workplace', before.id, present(before), null);
    return c.body(null, 204);
  });

  /** Ligar (ou gerar de novo, invalidando o endereço anterior) ou desligar o quiosque do local. */
  app.post('/v1/workplaces/:id/kiosk', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const before = await loadWorkplace(actor.companyId, c.req.param('id'));
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await body(c));
    const [w] = await getDb().update(workplaces).set(enabled ? { kioskSecret: randomToken(32), kioskToken: randomToken(24), updatedAt: new Date() } : { kioskSecret: null, kioskToken: null, updatedAt: new Date() })
      .where(eq(workplaces.id, before.id)).returning();
    await audit(actor, enabled ? 'enable_kiosk' : 'disable_kiosk', 'workplace', before.id, { kiosk: !!before.kioskToken }, { kiosk: enabled });
    return c.json(present(w!));
  });

  /** Atribuição em bloco: cada colaborador a um local (ou a nenhum = qualquer local activo). */
  app.put('/v1/workplaces/assignments', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const { assignments } = z.object({ assignments: z.array(z.object({ employeeId: z.string().min(1), workplaceId: z.string().min(1).nullable() })).min(1).max(2000) }).parse(await body(c));
    const placeIds = [...new Set(assignments.flatMap((a) => (a.workplaceId ? [a.workplaceId] : [])))];
    if (placeIds.length) {
      const found = await db.select({ id: workplaces.id }).from(workplaces).where(and(eq(workplaces.companyId, actor.companyId), inArray(workplaces.id, placeIds)));
      if (found.length !== placeIds.length) throw new DomainError('nao_encontrado', 'Local de trabalho inexistente', 404);
    }
    const people = await db.select({ id: employees.id, workplaceId: employees.workplaceId }).from(employees)
      .where(and(eq(employees.companyId, actor.companyId), inArray(employees.id, assignments.map((a) => a.employeeId))));
    if (people.length !== new Set(assignments.map((a) => a.employeeId)).size) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
    let changed = 0;
    for (const a of assignments) {
      const before = people.find((p) => p.id === a.employeeId)!;
      if (before.workplaceId === a.workplaceId) continue;
      await db.update(employees).set({ workplaceId: a.workplaceId, updatedAt: new Date() }).where(eq(employees.id, a.employeeId));
      await audit(actor, 'update', 'employee', a.employeeId, { workplaceId: before.workplaceId }, { workplaceId: a.workplaceId });
      changed++;
    }
    return c.json({ changed });
  });

  /** Excepções de localização do mês (marcações aceites com problema), para a chefia e o RH. */
  app.get('/v1/attendance-locations/issues', async (c) => {
    const actor = c.get('actor'), db = getDb();
    if (actor.role === 'employee') return c.json({ error: 'sem_permissao', message: 'Sem acesso à lista de excepções.' }, 403);
    const { period } = z.object({ period: periodSchema }).parse(c.req.query());
    const visible = await visibleEmployeeIds(db, actor);
    const conds = [eq(attendanceEntries.companyId, actor.companyId), eq(attendanceEntries.locationIssue, true), gte(attendanceEntries.workDate, `${period}-01`), lte(attendanceEntries.workDate, lastDay(period))];
    if (visible) conds.push(inArray(attendanceEntries.employeeId, visible.length ? visible : ['-']));
    const rows = await db.select({ e: attendanceEntries, name: employees.name, number: employees.number }).from(attendanceEntries)
      .innerJoin(employees, eq(employees.id, attendanceEntries.employeeId)).where(and(...conds)).orderBy(desc(attendanceEntries.workDate), desc(attendanceEntries.clockIn));
    return c.json(rows.map(({ e, name, number }) => ({
      id: e.id, employee: { id: e.employeeId, name, number }, workDate: e.workDate, clockIn: e.clockIn, clockOut: e.clockOut,
      clockInLocation: e.clockInLocation, clockOutLocation: e.clockOutLocation,
    })));
  });

  return app;
}

/** Quiosque à entrada do local: página pública (endereço secreto) que mostra o código rotativo e o QR. */
export function kioskRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/public/kiosk/:token', async (c) => {
    const token = z.string().regex(/^[0-9a-f]{48}$/).safeParse(c.req.param('token'));
    if (!token.success) return c.json({ error: 'nao_encontrado', message: 'Quiosque inexistente ou desligado.' }, 404);
    const [row] = await getDb().select({ w: workplaces, company: companies.name, mode: companies.punchLocationMode }).from(workplaces)
      .innerJoin(companies, eq(companies.id, workplaces.companyId)).where(eq(workplaces.kioskToken, token.data));
    if (!row || !row.w.kioskSecret || !row.w.active) return c.json({ error: 'nao_encontrado', message: 'Quiosque inexistente ou desligado.' }, 404);
    const now = new Date();
    const code = await kioskCode(row.w.kioskSecret, now);
    const expiresInSeconds = KIOSK_STEP_SECONDS - (Math.floor(now.getTime() / 1000) % KIOSK_STEP_SECONDS);
    c.header('Cache-Control', 'no-store');
    return c.json({ company: row.company, workplace: row.w.name, code, qr: kioskQrPayload(row.w.id, code), expiresInSeconds, active: row.mode !== 'off' });
  });
  return app;
}
