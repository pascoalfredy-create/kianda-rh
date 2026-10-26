import { getDb, journalEntries, payrollLines, payrollRuns } from '@kianda/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCompany, requireRole } from '../plugins/tenant.js';
import { closePayroll, draftPayroll } from '../services/payroll.js';

export async function payrollRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCompany);

  app.post('/v1/payroll-runs', { preHandler: requireRole('payroll') }, async (req, reply) => {
    const { period } = z.object({ period: z.string() }).parse(req.body);
    return reply.code(201).send(await draftPayroll(getDb(), req.companyId, period, req.actorId));
  });

  app.get('/v1/payroll-runs/:id', { preHandler: requireRole('payroll', 'finance') }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const db = getDb();
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, req.companyId)));
    if (!run) return reply.code(404).send({ error: 'nao_encontrado' });
    const lines = await db.select().from(payrollLines).where(eq(payrollLines.runId, id));
    return { ...run, lines };
  });

  app.post('/v1/payroll-runs/:id/close', { preHandler: requireRole('finance') }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return closePayroll(getDb(), req.companyId, id, req.actorId, req.role);
  });

  app.get('/v1/journal', { preHandler: requireRole('finance', 'payroll') }, async (req) => {
    const db = getDb();
    return db.query.journalEntries.findMany({ where: eq(journalEntries.companyId, req.companyId), with: { lines: true }, orderBy: (j, { desc }) => [desc(j.date)] });
  });
}
