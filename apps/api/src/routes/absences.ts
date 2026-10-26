import { businessDays, getPack } from '@kianda/core';
import { absences, auditLogs, employees, getDb } from '@kianda/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCompany } from '../plugins/tenant.js';

const body = z.object({
  employeeId: z.string(),
  type: z.enum(['vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training']),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().optional(),
}).refine((b) => b.endDate >= b.startDate, { message: 'A data de fim tem de ser igual ou posterior à de início' });

export async function absenceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCompany);

  app.post('/v1/absences', async (req, reply) => {
    const b = body.parse(req.body);
    const db = getDb();
    const [emp] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, req.companyId)));
    if (!emp) return reply.code(404).send({ error: 'colaborador_inexistente' });
    const years = [...new Set([Number(b.startDate.slice(0, 4)), Number(b.endDate.slice(0, 4))])];
    const workingDays = businessDays(b.startDate, b.endDate, years.map((y) => getPack('AO', y)));
    if (!workingDays) return reply.code(422).send({ error: 'sem_dias_uteis', message: 'O período não contém dias úteis' });
    const overlap = await db.select().from(absences).where(and(eq(absences.employeeId, b.employeeId), lte(absences.startDate, b.endDate), gte(absences.endDate, b.startDate)));
    if (overlap.some((a) => a.status !== 'rejected' && a.status !== 'cancelled')) return reply.code(409).send({ error: 'sobreposicao', message: 'Já existe uma ausência neste período' });
    const [a] = await db.insert(absences).values({ companyId: req.companyId, employeeId: b.employeeId, type: b.type, startDate: b.startDate, endDate: b.endDate, workingDays, reason: b.reason }).returning();
    await db.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'absence', entityId: a!.id, after: a });
    return reply.code(201).send(a);
  });

  app.get('/v1/absences', async (req) => getDb().select().from(absences).where(eq(absences.companyId, req.companyId)));
}
