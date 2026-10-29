import { companies, eq, getDb } from '@kianda/db';
import { Hono } from 'hono';
import { requireCompany, type AppEnv } from '../plugins/tenant.js';
import { notificationColumns } from '../services/notification-counts.js';

export function notificationRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/notifications/counts', requireCompany, async c => {
    const actor = c.get('actor');
    if (!['owner', 'hr_admin', 'manager'].includes(actor.role)) return c.json({ absences: 0, expenses: 0 });
    const [counts] = await getDb().select(notificationColumns(actor)).from(companies).where(eq(companies.id, actor.companyId));
    return c.json(counts ?? { absences: 0, expenses: 0 });
  });
  return app;
}
