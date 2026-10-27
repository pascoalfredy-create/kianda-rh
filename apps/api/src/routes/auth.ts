import { isValidCompanyNif, luandaDate, SECTORS, tierFor, TRIAL_DAYS } from '@kianda/core';
import { auditLogs, companies, employees, getDb, hashPassword, passwordProblems, subscriptions, users, verifyPassword } from '@kianda/db';
import { and, eq } from '@kianda/db';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import { z } from 'zod';
import { isPlatformAdmin, licenceOf } from '../services/licence.js';
import { body, jwtSecret, rateLimit, requireCompany, requireRole, SESSION_COOKIE, type AppEnv, type Ctx, type Role, type SessionClaims } from '../plugins/tenant.js';

const SESSION_HOURS = 12;
const password = z.string().superRefine((v, ctx) => { const p = passwordProblems(v); if (p) ctx.addIssue({ code: 'custom', message: p }); });

async function startSession(c: Ctx, claims: SessionClaims) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const token = await sign({ ...claims, exp }, jwtSecret(), 'HS256');
  setCookie(c, SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_HOURS * 3600,
  });
  return token;
}

/** Código curto da empresa (6 caracteres sem ambiguidades) para a entrada por n.º/telefone + PIN. */
export function companyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join('');
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  /** Registo de uma nova empresa com o seu utilizador proprietário. */
  app.post('/v1/auth/register', rateLimit('register', 5, 3_600_000), async (c) => {
    const b = z.object({
      company: z.object({
        name: z.string().trim().min(2), nif: z.string().trim().refine(isValidCompanyNif, 'NIF de empresa deve ter 10 dígitos'),
        sector: z.enum(Object.keys(SECTORS) as [keyof typeof SECTORS]).optional(), address: z.string().trim().max(200).optional().nullable(),
        employeesEstimate: z.number().int().min(1).max(100_000).optional(),
      }),
      name: z.string().min(2),
      email: z.email(),
      password,
      acceptTerms: z.literal(true, { message: 'É necessário aceitar os termos de utilização' }).optional(),
    }).parse(await body(c));
    const db = getDb();
    const passwordHash = await hashPassword(b.password);
    const result = await db.transaction(async (tx) => {
      const [co] = await tx.insert(companies).values({ name: b.company.name, nif: b.company.nif, sector: b.company.sector ?? null, address: b.company.address ?? null, code: companyCode() }).returning();
      // Período experimental com o escalão adequado à dimensão declarada.
      const trialEnd = new Date(Date.parse(luandaDate(new Date())) + TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10);
      await tx.insert(subscriptions).values({ companyId: co!.id, status: 'trial', tierKey: tierFor(b.company.employeesEstimate ?? 1).key, cycle: 'monthly', trialEndsAt: trialEnd });
      const [u] = await tx.insert(users).values({ companyId: co!.id, email: b.email.toLowerCase(), name: b.name, passwordHash, role: 'owner' }).returning();
      await tx.insert(auditLogs).values({ companyId: co!.id, actorId: u!.id, action: 'register', entity: 'company', entityId: co!.id, after: { company: co, owner: { id: u!.id, email: u!.email } } });
      return { company: co!, user: u! };
    });
    const token = await startSession(c, { sub: result.user.id, companyId: result.company.id, role: 'owner', employeeId: null, name: result.user.name });
    return c.json({ company: result.company, user: { id: result.user.id, name: result.user.name, email: result.user.email, role: 'owner' }, token }, 201);
  });

  app.post('/v1/auth/login', rateLimit('login', 10, 900_000), async (c) => {
    const b = z.object({ email: z.email(), password: z.string().min(1), companyNif: z.string().optional() }).parse(await body(c));
    const db = getDb();
    const rows = await db.select({ u: users, co: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
      .where(b.companyNif ? and(eq(users.email, b.email.toLowerCase()), eq(companies.nif, b.companyNif)) : eq(users.email, b.email.toLowerCase()));
    if (rows.length > 1) return c.json({ error: 'varias_empresas', message: 'Este email existe em várias empresas. Indique o NIF da empresa.' }, 409);
    const row = rows[0];
    // Mesma resposta para email inexistente e palavra-passe errada (não revela contas).
    if (!row || !(await verifyPassword(b.password, row.u.passwordHash))) return c.json({ error: 'credenciais_invalidas', message: 'Email ou palavra-passe incorrectos.' }, 401);
    if (row.u.disabledAt) return c.json({ error: 'acesso_desactivado', message: 'O seu acesso foi desactivado. Contacte os Recursos Humanos.' }, 403);
    const token = await startSession(c, { sub: row.u.id, companyId: row.co.id, role: row.u.role, employeeId: row.u.employeeId, name: row.u.name });
    await db.insert(auditLogs).values({ companyId: row.co.id, actorId: row.u.id, action: 'login', entity: 'user', entityId: row.u.id });
    return c.json({ user: { id: row.u.id, name: row.u.name, email: row.u.email, role: row.u.role }, company: { id: row.co.id, name: row.co.name }, token });
  });

  app.post('/v1/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/v1/auth/me', requireCompany, async (c) => {
    const { companyId, session } = c.get('actor');
    const [co] = await getDb().select().from(companies).where(eq(companies.id, companyId));
    const { exp: _exp, ...user } = session as SessionClaims & { exp?: number };
    const db = getDb();
    const licence = await licenceOf(db, companyId);
    return c.json({
      user, company: co ? { id: co.id, name: co.name, nif: co.nif, code: co.code, hasLogo: Boolean(co.logoDataUrl) } : null,
      licence: { status: licence.status, label: licence.statusLabel, canWrite: licence.canWrite, trialEndsAt: licence.sub?.trialEndsAt ?? null, paidUntil: licence.sub?.paidUntil ?? null },
      platformAdmin: await isPlatformAdmin(db, session.sub),
    });
  });

  /** Gestão de utilizadores da empresa (proprietário e administração de RH). */
  app.get('/v1/users', requireCompany, requireRole('hr_admin'), async (c) => {
    return c.json(await getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role, employeeId: users.employeeId, createdAt: users.createdAt }).from(users).where(eq(users.companyId, c.get('actor').companyId)));
  });

  app.post('/v1/users', requireCompany, requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      name: z.string().min(2), email: z.email(), password,
      role: z.enum(['hr_admin', 'payroll', 'finance', 'manager', 'employee']),
      employeeId: z.string().optional(),
    }).parse(await body(c));
    if (b.role === 'hr_admin' && actor.role !== 'owner') return c.json({ error: 'sem_permissao', message: 'Só o proprietário pode criar administradores de RH.' }, 403);
    const db = getDb();
    if (b.employeeId) {
      const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
      if (!e) return c.json({ error: 'colaborador_inexistente', message: 'Colaborador inexistente' }, 404);
    }
    const [u] = await db.insert(users).values({ companyId: actor.companyId, name: b.name, email: b.email.toLowerCase(), passwordHash: await hashPassword(b.password), role: b.role as Role, employeeId: b.employeeId }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'user', entityId: u!.id, after: { email: u!.email, role: u!.role } });
    return c.json({ id: u!.id, name: u!.name, email: u!.email, role: u!.role, employeeId: u!.employeeId }, 201);
  });

  return app;
}
