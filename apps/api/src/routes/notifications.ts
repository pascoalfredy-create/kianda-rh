import { getDb, sql } from '@kianda/db';
import { Hono } from 'hono';
import { requireCompany, type AppEnv } from '../plugins/tenant.js';

export function notificationRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/notifications/counts', requireCompany, async c => {
    const actor = c.get('actor');
    if (!['owner', 'hr_admin', 'manager'].includes(actor.role)) return c.json({ absences: 0, expenses: 0 });
    const decide = actor.role === 'owner' ? sql`true` : actor.role === 'hr_admin'
      ? actor.employeeId ? sql`e.id <> ${actor.employeeId}` : sql`true`
      : actor.employeeId ? sql`e.manager_id = ${actor.employeeId} and e.id <> ${actor.employeeId}` : sql`false`;
    const [counts] = (await getDb().execute(sql`select
      (select count(*)::int from absences a join employees e on e.id = a.employee_id where a.company_id = ${actor.companyId} and e.company_id = ${actor.companyId} and a.status = 'pending' and ${decide}) as absences,
      (select count(*)::int from expense_claims x join employees e on e.id = x.employee_id where x.company_id = ${actor.companyId} and e.company_id = ${actor.companyId} and x.status = 'submitted' and ${decide}) as expenses`)).rows;
    return c.json({ absences: Number(counts?.absences ?? 0), expenses: Number(counts?.expenses ?? 0) });
  });
  return app;
}
