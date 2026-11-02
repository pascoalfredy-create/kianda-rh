import { companies, eq, getDb } from '@kianda/db';
import { Hono } from 'hono';
import { requireCompany, type AppEnv } from '../plugins/tenant.js';
import { ackCountColumn, notificationColumns, taskCountColumn } from '../services/notification-counts.js';

export function notificationRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/notifications/counts', requireCompany, async c => {
    const actor = c.get('actor');
    // Acolhimento e saída: tarefas do próprio em atraso ou a vencer em 3 dias (todos os perfis).
    const [counts] = await getDb().select({ ...notificationColumns(actor), tasks: taskCountColumn(actor), acks: ackCountColumn(actor) }).from(companies).where(eq(companies.id, actor.companyId));
    return c.json(counts ?? { absences: 0, expenses: 0, tasks: 0, acks: 0 });
  });
  return app;
}
