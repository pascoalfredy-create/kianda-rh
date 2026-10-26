import { getDb, journalEntries, payrollLines, payrollRuns } from '@kianda/db';
import { and, eq } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { closePayroll, draftPayroll } from '../services/payroll.js';

export function payrollRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/payroll-runs/*', requireCompany);
  app.use('/v1/payroll-runs', requireCompany);
  app.use('/v1/journal', requireCompany);

  app.post('/v1/payroll-runs', requireRole('payroll'), async (c) => {
    const { companyId, actorId } = c.get('actor');
    const { period } = z.object({ period: z.string() }).parse(await body(c));
    return c.json(await draftPayroll(getDb(), companyId, period, actorId), 201);
  });

  app.get('/v1/payroll-runs/:id', requireRole('payroll', 'finance'), async (c) => {
    const { id } = c.req.param();
    const db = getDb();
    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, c.get('actor').companyId)));
    if (!run) return c.json({ error: 'nao_encontrado', message: 'Processamento inexistente' }, 404);
    const lines = await db.select().from(payrollLines).where(eq(payrollLines.runId, id));
    return c.json({ ...run, lines });
  });

  app.post('/v1/payroll-runs/:id/close', requireRole('finance'), async (c) => {
    const { companyId, actorId, role } = c.get('actor');
    return c.json(await closePayroll(getDb(), companyId, c.req.param('id'), actorId, role));
  });

  app.get('/v1/journal', requireRole('finance', 'payroll'), async (c) => {
    return c.json(await getDb().query.journalEntries.findMany({ where: eq(journalEntries.companyId, c.get('actor').companyId), with: { lines: true }, orderBy: (j, { desc }) => [desc(j.date)] }));
  });

  return app;
}
