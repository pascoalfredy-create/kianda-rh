import { complianceAlerts, contractAlerts, getPack, isValidAngolanBI, isValidAngolanIban, kz, normalizeIban } from '@kianda/core';
import { auditLogs, contracts, departments, employees, getDb } from '@kianda/db';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCompany } from '../plugins/tenant.js';

const createBody = z.object({
  number: z.string().min(1),
  name: z.string().min(2),
  jobTitle: z.string().min(2),
  departmentId: z.string().optional(),
  province: z.string().optional(),
  biNumber: z.string().refine(isValidAngolanBI, 'BI com formato inválido (ex.: 004512398LA041)').optional(),
  inssNumber: z.string().optional(),
  iban: z.string().refine(isValidAngolanIban, 'IBAN angolano inválido (AO06 + 21 dígitos, com dígitos de controlo)').optional(),
  bank: z.string().optional(),
  email: z.email().optional(),
  contract: z.object({
    type: z.enum(['indefinite', 'fixed_term', 'internship']),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
    termJustification: z.string().optional(),
    base: z.number().nonnegative(),
    meal: z.number().nonnegative().default(0),
    transport: z.number().nonnegative().default(0),
  }).refine((c) => c.type !== 'fixed_term' || (c.endDate && c.termJustification), { message: 'Contrato a termo exige data de fim e fundamento do termo' }),
});

export async function employeeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCompany);

  app.get('/v1/employees', async (req) => {
    const db = getDb();
    const rows = await db
      .select({ e: employees, c: contracts, dept: departments.name })
      .from(employees)
      .leftJoin(contracts, eq(contracts.employeeId, employees.id))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.companyId, req.companyId))
      .orderBy(employees.number, desc(contracts.startDate));
    const today = new Date().toISOString().slice(0, 10);
    const pack = getPack('AO', Number(today.slice(0, 4)));
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.e.id) && seen.add(r.e.id)).map(({ e, c, dept }) => ({
      ...e,
      department: dept,
      contract: c,
      alerts: c
        ? [
            ...contractAlerts({ startDate: c.startDate, endDate: c.endDate, type: c.type === 'fixed_term' ? 'fixed-term' : c.type }, today, pack).map((a) => a.message),
            ...complianceAlerts({ baseMinor: c.baseMinor, internship: c.type === 'internship' }, pack),
          ]
        : ['Sem contrato registado'],
    }));
  });

  app.post('/v1/employees', async (req, reply) => {
    const b = createBody.parse(req.body);
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [e] = await tx.insert(employees).values({
        companyId: req.companyId, number: b.number, name: b.name, jobTitle: b.jobTitle, departmentId: b.departmentId, province: b.province,
        biNumber: b.biNumber?.toUpperCase(), nif: b.biNumber?.toUpperCase(), inssNumber: b.inssNumber, iban: b.iban ? normalizeIban(b.iban) : undefined, bank: b.bank, email: b.email,
      }).returning();
      const [c] = await tx.insert(contracts).values({
        employeeId: e!.id, type: b.contract.type, startDate: b.contract.startDate, endDate: b.contract.endDate, termJustification: b.contract.termJustification,
        baseMinor: kz(b.contract.base), mealMinor: kz(b.contract.meal), transportMinor: kz(b.contract.transport),
      }).returning();
      await tx.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'employee', entityId: e!.id, after: { employee: e, contract: c } });
      return { ...e!, contract: c };
    });
    return reply.code(201).send(result);
  });

  app.get('/v1/employees/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const db = getDb();
    const e = await db.query.employees.findFirst({ where: and(eq(employees.id, id), eq(employees.companyId, req.companyId)), with: { contracts: true, absences: true, department: true } });
    if (!e) return reply.code(404).send({ error: 'nao_encontrado' });
    return e;
  });
}
