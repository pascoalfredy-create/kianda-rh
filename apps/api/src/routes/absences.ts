import { businessDays, getPack } from '@kianda/core';
import { absences, auditLogs, employees, getDb } from '@kianda/db';
import { and, eq, gte, lte } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body as readBody, requireCompany, type AppEnv } from '../plugins/tenant.js';

const body = z.object({
  employeeId: z.string(),
  type: z.enum(['vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training']),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().optional(),
}).refine((b) => b.endDate >= b.startDate, { message: 'A data de fim tem de ser igual ou posterior à de início' });

export function absenceRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/absences', requireCompany);

  app.post('/v1/absences', async (c) => {
    const req = c.get('actor');
    const b = body.parse(await readBody(c));
    const canManage = ['owner', 'hr_admin', 'manager'].includes(req.role);
    if (!canManage && req.employeeId !== b.employeeId) return c.json({ error: 'sem_permissao', message: 'Só pode registar ausências próprias.' }, 403);
    const db = getDb();
    const [emp] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, req.companyId)));
    if (!emp) return c.json({ error: 'colaborador_inexistente', message: 'Colaborador inexistente' }, 404);
    const years = [...new Set([Number(b.startDate.slice(0, 4)), Number(b.endDate.slice(0, 4))])];
    const workingDays = businessDays(b.startDate, b.endDate, years.map((y) => getPack('AO', y)));
    if (!workingDays) return c.json({ error: 'sem_dias_uteis', message: 'O período não contém dias úteis' }, 422);
    const overlap = await db.select().from(absences).where(and(eq(absences.employeeId, b.employeeId), lte(absences.startDate, b.endDate), gte(absences.endDate, b.startDate)));
    if (overlap.some((a) => a.status !== 'rejected' && a.status !== 'cancelled')) return c.json({ error: 'sobreposicao', message: 'Já existe uma ausência neste período' }, 409);
    const [a] = await db.insert(absences).values({ companyId: req.companyId, employeeId: b.employeeId, type: b.type, startDate: b.startDate, endDate: b.endDate, workingDays, reason: b.reason }).returning();
    await db.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'absence', entityId: a!.id, after: a });
    return c.json(a, 201);
  });

  app.get('/v1/absences', async (c) => {
    const req = c.get('actor');
    const own = !['owner', 'hr_admin', 'manager', 'payroll'].includes(req.role);
    const where = own ? and(eq(absences.companyId, req.companyId), eq(absences.employeeId, req.employeeId ?? '-')) : eq(absences.companyId, req.companyId);
    return c.json(await getDb().select().from(absences).where(where));
  });

  return app;
}
