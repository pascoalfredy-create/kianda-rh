/**
 * Relatórios de gestão de pessoas: custo com pessoal, efectivo, rotatividade, absentismo e horas extra por mês e por
 * departamento, a partir dos processamentos fechados. JSON para o ecrã, Excel (?format=xlsx) para a direcção.
 */
import { ABSENTEEISM_TYPES, COST_GROUP_LABEL, peopleReport, splitAbsenceByMonth, type CostGroup } from '@kianda/core';
import { absences, and, asc, companies, contracts, departments, employees, eq, getDb, inArray, payrollLines, payrollRuns, terminations } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { xlsx, xlsxResponse } from '../lib/xlsx.js';
import { requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM');

export function reportRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/reports/*', requireCompany);

  app.get('/v1/reports/people', requireRole('hr_admin', 'finance', 'payroll'), async (c) => {
    const actor = c.get('actor');
    const q = z.object({ from: period.optional(), to: period.optional(), format: z.enum(['json', 'xlsx']).default('json') }).parse(c.req.query());
    const db = getDb();
    const closed = await db.select({ id: payrollRuns.id, period: payrollRuns.period }).from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.status, 'closed'))).orderBy(asc(payrollRuns.period));
    // Por omissão: os últimos 12 meses fechados.
    const to = q.to ?? closed[closed.length - 1]?.period;
    const inRange = closed.filter((r) => (!q.from || r.period >= q.from) && (!to || r.period <= to));
    const runs = q.from ? inRange : inRange.slice(-12);
    const available = closed.map((r) => r.period);
    if (!runs.length) return c.json({ empty: true, available });

    const runPeriod = new Map(runs.map((r) => [r.id, r.period]));
    const lines = await db.select().from(payrollLines).where(inArray(payrollLines.runId, runs.map((r) => r.id)));
    const emps = await db.select({ id: employees.id, departmentId: employees.departmentId }).from(employees).where(eq(employees.companyId, actor.companyId));
    const ids = emps.map((e) => e.id);
    const firstContract = new Map<string, string>();
    if (ids.length) {
      for (const k of await db.select({ employeeId: contracts.employeeId, startDate: contracts.startDate }).from(contracts).where(inArray(contracts.employeeId, ids))) {
        const cur = firstContract.get(k.employeeId);
        if (!cur || k.startDate < cur) firstContract.set(k.employeeId, k.startDate);
      }
    }
    const exits = new Map((await db.select({ employeeId: terminations.employeeId, effectiveDate: terminations.effectiveDate }).from(terminations)
      .where(and(eq(terminations.companyId, actor.companyId), eq(terminations.status, 'confirmed')))).map((t) => [t.employeeId, t.effectiveDate]));
    const deps = await db.select().from(departments).where(eq(departments.companyId, actor.companyId));
    const first = runs[0]!.period;
    const last = runs[runs.length - 1]!.period;
    // Faltas injustificadas já vêm no recibo (absenceDays); aqui só as outras ausências aprovadas que contam para o absentismo.
    const leave = await db.select().from(absences).where(and(eq(absences.companyId, actor.companyId), eq(absences.status, 'approved'),
      inArray(absences.type, [...ABSENTEEISM_TYPES].filter((t) => t !== 'unjustified') as never[])));
    const periods = new Set(runs.map((r) => r.period));
    const leaveDays = leave.flatMap((a) => splitAbsenceByMonth(a).filter((x) => periods.has(x.period)).map((x) => ({ ...x, employeeId: a.employeeId })));

    const report = peopleReport({
      periods: [...periods],
      lines: lines.map((l) => ({
        period: runPeriod.get(l.runId)!, employeeId: l.employeeId, grossMinor: l.grossMinor, inssEmployerMinor: l.inssEmployerMinor,
        overtimeHours: Number(l.overtimeHours), absenceDays: l.absenceDays, breakdown: l.breakdown as { code: string; kind: string; amountMinor: number }[],
      })),
      employees: emps.map((e) => ({ id: e.id, departmentId: e.departmentId, hireDate: firstContract.get(e.id) ?? null, exitDate: exits.get(e.id) ?? null })),
      departments: deps.map((d) => ({ id: d.id, name: d.name, costCenter: d.costCenter })),
      leaveDays,
    });

    if (q.format === 'xlsx') {
      const [co] = await db.select({ name: companies.name, nif: companies.nif }).from(companies).where(eq(companies.id, actor.companyId));
      const kz = (m: number) => Math.round(m) / 100;
      const t = report.totals;
      const groups = Object.keys(COST_GROUP_LABEL) as CostGroup[];
      return xlsxResponse(xlsx([
        {
          name: 'Resumo', boldRows: [0, 3], widths: [44, 22],
          rows: [
            [`${co?.name ?? ''} — Relatório de pessoas ${first} a ${last}`], [`NIF ${co?.nif ?? ''} · custo com pessoal = ilíquido + INSS da entidade empregadora`], [],
            ['Indicador', 'Valor'],
            ['Custo com pessoal (Kz)', kz(t.costMinor)], ['Remuneração ilíquida (Kz)', kz(t.grossMinor)], ['INSS entidade empregadora (Kz)', kz(t.employerInssMinor)],
            ['Custo médio mensal por trabalhador (Kz)', kz(t.avgMonthlyCostPerHeadMinor)], ['Efectivo no fim do período', t.headcountEnd], ['Efectivo médio', t.avgHeadcount],
            ['Admissões', t.hires], ['Saídas', t.exits], ['Rotatividade (%)', t.turnoverPct], ['Absentismo (%)', t.absenteeismPct],
            ['Horas extra (h)', t.overtimeHours], ['Horas extra (Kz)', kz(t.overtimeMinor)], ['Peso das horas extra no ilíquido (%)', t.overtimeSharePct],
          ],
        },
        {
          name: 'Mensal', header: true, widths: [10, 10, 10, 10, 18, 18, 18, ...groups.map(() => 18), 12, 16, 12, 12],
          rows: [
            ['Mês', 'Efectivo', 'Admissões', 'Saídas', 'Custo com pessoal', 'Ilíquido', 'INSS 8%', ...groups.map((g) => COST_GROUP_LABEL[g]), 'Horas extra (h)', 'Horas extra (Kz)', 'Dias de ausência', 'Absentismo (%)'],
            ...report.months.map((m) => [m.period, m.headcount, m.hires, m.exits, kz(m.costMinor), kz(m.grossMinor), kz(m.employerInssMinor), ...groups.map((g) => kz(m.groups[g])), m.overtimeHours, kz(m.overtimeMinor), m.absenceDays, m.absenteeismPct]),
          ],
        },
        {
          name: 'Departamentos', header: true, widths: [28, 14, 12, 18, 20, 16, 14, 12],
          rows: [
            ['Departamento', 'Centro de custo', 'Efectivo', 'Custo com pessoal', 'Custo médio mensal', 'Horas extra (Kz)', 'Dias de ausência', 'Peso (%)'],
            ...report.departments.map((d) => [d.name, d.costCenter, d.headcount, kz(d.costMinor), kz(d.avgMonthlyCostMinor), kz(d.overtimeMinor), d.absenceDays, d.sharePct]),
          ],
        },
        {
          name: 'Rubricas', header: true, widths: [40, 18, 12],
          rows: [
            ['Rubrica', 'Valor (Kz)', 'Peso (%)'],
            ...groups.map((g) => [COST_GROUP_LABEL[g], kz(t.groups[g]), t.costMinor ? Math.round((t.groups[g] / t.costMinor) * 10_000) / 100 : 0]),
            ['INSS entidade empregadora', kz(t.employerInssMinor), t.costMinor ? Math.round((t.employerInssMinor / t.costMinor) * 10_000) / 100 : 0],
            ['Total', kz(t.costMinor), 100],
          ],
        },
      ]), `relatorio-pessoas-${first}-a-${last}.xlsx`);
    }
    return c.json({ ...report, available, groupLabels: COST_GROUP_LABEL });
  });

  return app;
}
