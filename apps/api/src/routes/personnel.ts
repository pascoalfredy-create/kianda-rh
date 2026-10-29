import { personnelMonths } from '@kianda/core/personnel-cash';
import { luandaDate } from '@kianda/core';
import { and, auditLogs, departments, employees, eq, getDb, inArray, payrollLines, payrollRuns, personnelCashPlans, sql } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { cashForecast, personnelOverview } from '../services/personnel.js';
import { DomainError } from '../services/payroll.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export function personnelRoutes() {
  const app = new Hono<AppEnv>();
  for (const path of ['/v1/reports/overview', '/v1/reports/analytics', '/v1/personnel-cash']) app.use(path, requireCompany);
  app.get('/v1/reports/overview', requireRole('hr_admin', 'finance', 'payroll', 'manager'), async c => {
    const overview = await personnelOverview(c.get('actor').companyId);
    if (c.get('actor').role === 'manager') return c.json({ ...overview, financial: null, demographics: null, departments: overview.departments.map(d => ({ ...d, costMinor: null })), locations: [] });
    return c.json(overview);
  });
  app.get('/v1/reports/analytics', requireRole('hr_admin', 'finance', 'payroll'), async c => {
    const { from, to } = z.object({ from: period.optional(), to: period.optional() }).parse(c.req.query());
    if (from && to && from > to) throw new DomainError('periodo_invalido', 'O início deve ser anterior ao fim.', 400);
    const db = getDb(), companyId = c.get('actor').companyId;
    const all = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed')));
    const available = all.map(r => r.period).sort();
    const selected = all.filter(r => (!from || r.period >= from) && (!to || r.period <= to)).sort((a, b) => a.period.localeCompare(b.period));
    const runs = from ? selected : selected.slice(-12);
    const months = runs.map(r => r.period);
    const deps = await db.select().from(departments).where(eq(departments.companyId, companyId));
    const lines = runs.length ? await db.select({ l: payrollLines, departmentId: employees.departmentId }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(inArray(payrollLines.runId, runs.map(r => r.id))) : [];
    const centres = new Map<string, { name: string; departments: string[]; values: Record<string, number>; totalMinor: number }>();
    for (const { l, departmentId } of lines) {
      const d = deps.find(d => d.id === departmentId), key = d?.costCenter ?? 'Sem centro';
      const row = centres.get(key) ?? { name: key, departments: [], values: {}, totalMinor: 0 };
      if (!row.departments.includes(d?.name ?? 'Sem departamento')) row.departments.push(d?.name ?? 'Sem departamento');
      const month = runs.find(r => r.id === l.runId)!.period, cost = l.grossMinor + l.inssEmployerMinor;
      row.values[month] = (row.values[month] ?? 0) + cost; row.totalMinor += cost; centres.set(key, row);
    }
    const overview = await personnelOverview(companyId);
    return c.json({ available, months, centres: [...centres.values()], totalMinor: lines.reduce((s, r) => s + r.l.grossMinor + r.l.inssEmployerMinor, 0), locations: overview.locations });
  });
  app.get('/v1/personnel-cash', requireRole('finance', 'payroll'), async c => {
    const from = period.parse(c.req.query('period') || luandaDate(new Date()).slice(0, 7));
    return c.json(await cashForecast(c.get('actor').companyId, from));
  });
  app.put('/v1/personnel-cash', requireRole('finance'), async c => {
    const b = z.object({ period, openingMinor: z.number().int().min(-1e13).max(1e13), receipts: z.record(period, z.number().int().min(0).max(1e13)), revision: z.number().int().min(0) }).parse(await body(c));
    const allowed = new Set(personnelMonths(b.period));
    if (Object.keys(b.receipts).some(p => !allowed.has(p))) throw new DomainError('periodo_invalido', 'Os recebimentos devem pertencer aos seis meses da previsão.', 400);
    const db = getDb(), actor = c.get('actor');
    const rows = await db.insert(personnelCashPlans).values({ companyId: actor.companyId, period: b.period, openingMinor: b.openingMinor, receipts: b.receipts, updatedBy: actor.actorId }).onConflictDoUpdate({
      target: [personnelCashPlans.companyId, personnelCashPlans.period], set: { openingMinor: b.openingMinor, receipts: b.receipts, revision: sql`${personnelCashPlans.revision} + 1`, updatedBy: actor.actorId, updatedAt: new Date() }, setWhere: eq(personnelCashPlans.revision, b.revision),
    }).returning();
    if (!rows.length || b.revision > 0 && rows[0]!.revision === 1) throw new DomainError('versao_alterada', 'Os pressupostos foram alterados por outro utilizador. Recarregue a página antes de gravar.', 409);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'personnel_cash_plan', entityId: rows[0]!.id, after: b });
    return c.json(rows[0]);
  });
  return app;
}
