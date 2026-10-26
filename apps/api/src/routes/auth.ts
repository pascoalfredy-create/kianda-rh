import { isValidCompanyNif } from '@kianda/core';
import { auditLogs, companies, employees, getDb, hashPassword, passwordProblems, users, verifyPassword } from '@kianda/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { requireCompany, requireRole, SESSION_COOKIE, type Role, type SessionClaims } from '../plugins/tenant.js';

const SESSION_HOURS = 12;
const password = z.string().superRefine((v, ctx) => { const p = passwordProblems(v); if (p) ctx.addIssue({ code: 'custom', message: p }); });

async function startSession(app: FastifyInstance, reply: FastifyReply, claims: SessionClaims) {
  const token = await reply.jwtSign(claims, { expiresIn: `${SESSION_HOURS}h` });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_HOURS * 3600,
  });
  return token;
}

export async function authRoutes(app: FastifyInstance) {
  /** Registo de uma nova empresa com o seu utilizador proprietário. */
  app.post('/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      company: z.object({ name: z.string().min(2), nif: z.string().refine(isValidCompanyNif, 'NIF de empresa deve ter 10 dígitos') }),
      name: z.string().min(2),
      email: z.email(),
      password,
    }).parse(req.body);
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [c] = await tx.insert(companies).values({ name: b.company.name, nif: b.company.nif }).returning();
      const [u] = await tx.insert(users).values({ companyId: c!.id, email: b.email.toLowerCase(), name: b.name, passwordHash: await hashPassword(b.password), role: 'owner' }).returning();
      await tx.insert(auditLogs).values({ companyId: c!.id, actorId: u!.id, action: 'register', entity: 'company', entityId: c!.id, after: { company: c, owner: { id: u!.id, email: u!.email } } });
      return { company: c!, user: u! };
    });
    const token = await startSession(app, reply, { sub: result.user.id, companyId: result.company.id, role: 'owner', employeeId: null, name: result.user.name });
    return reply.code(201).send({ company: result.company, user: { id: result.user.id, name: result.user.name, email: result.user.email, role: 'owner' }, token });
  });

  app.post('/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const b = z.object({ email: z.email(), password: z.string().min(1), companyNif: z.string().optional() }).parse(req.body);
    const db = getDb();
    const rows = await db.select({ u: users, c: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
      .where(b.companyNif ? and(eq(users.email, b.email.toLowerCase()), eq(companies.nif, b.companyNif)) : eq(users.email, b.email.toLowerCase()));
    if (rows.length > 1) return reply.code(409).send({ error: 'varias_empresas', message: 'Este email existe em várias empresas. Indique o NIF da empresa.' });
    const row = rows[0];
    // Mesma resposta para email inexistente e palavra-passe errada (não revela contas).
    if (!row || !(await verifyPassword(b.password, row.u.passwordHash))) return reply.code(401).send({ error: 'credenciais_invalidas', message: 'Email ou palavra-passe incorrectos.' });
    const token = await startSession(app, reply, { sub: row.u.id, companyId: row.c.id, role: row.u.role, employeeId: row.u.employeeId, name: row.u.name });
    await db.insert(auditLogs).values({ companyId: row.c.id, actorId: row.u.id, action: 'login', entity: 'user', entityId: row.u.id });
    return { user: { id: row.u.id, name: row.u.name, email: row.u.email, role: row.u.role }, company: { id: row.c.id, name: row.c.name }, token };
  });

  app.post('/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/v1/auth/me', { preHandler: requireCompany }, async (req) => {
    const db = getDb();
    const [c] = await db.select().from(companies).where(eq(companies.id, req.companyId));
    return { user: req.user, company: c ? { id: c.id, name: c.name, nif: c.nif } : null };
  });

  /** Gestão de utilizadores da empresa (proprietário e administração de RH). */
  app.get('/v1/users', { preHandler: [requireCompany, requireRole('hr_admin')] }, async (req) => {
    return getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, employeeId: users.employeeId, createdAt: users.createdAt }).from(users).where(eq(users.companyId, req.companyId));
  });

  app.post('/v1/users', { preHandler: [requireCompany, requireRole('hr_admin')] }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(2), email: z.email(), password,
      role: z.enum(['hr_admin', 'payroll', 'finance', 'manager', 'employee']),
      employeeId: z.string().optional(),
    }).parse(req.body);
    if (b.role === 'hr_admin' && req.role !== 'owner') return reply.code(403).send({ error: 'sem_permissao', message: 'Só o proprietário pode criar administradores de RH.' });
    const db = getDb();
    if (b.employeeId) {
      const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, req.companyId)));
      if (!e) return reply.code(404).send({ error: 'colaborador_inexistente' });
    }
    const [u] = await db.insert(users).values({ companyId: req.companyId, name: b.name, email: b.email.toLowerCase(), passwordHash: await hashPassword(b.password), role: b.role as Role, employeeId: b.employeeId }).returning();
    await db.insert(auditLogs).values({ companyId: req.companyId, actorId: req.actorId, action: 'create', entity: 'user', entityId: u!.id, after: { email: u!.email, role: u!.role } });
    return reply.code(201).send({ id: u!.id, name: u!.name, email: u!.email, role: u!.role, employeeId: u!.employeeId });
  });
}
