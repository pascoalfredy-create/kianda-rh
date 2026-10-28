import { DEFAULT_TIERS, FINANCIAL_SECTORS, MODELING_PLANS, defaultModelingSector, isValidCompanyNif, luandaDate, SECTORS, tierFor, TRIAL_DAYS, verifyTotp } from '@kianda/core';
import { auditLogs, companies, companyModules, employees, getDb, modelingMembers, platformAdmins, hashPassword, passwordProblems, subscriptions, users, verifyPassword, type Db } from '@kianda/db';
import { and, eq } from '@kianda/db';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';
import { isPlatformAdmin, licenceOf } from '../services/licence.js';
import { body, jwtSecret, rateLimit, requireCompany, requireRole, SESSION_COOKIE, type AppEnv, type Ctx, type Role, type SessionClaims } from '../plugins/tenant.js';
import { applySectorPreset } from '../services/sector.js';
import { appBaseUrl } from '../services/integrations.js';
import { sendMail } from '../services/mail.js';
import { companyModulesOverview } from '../services/modules.js';
import { validateModelingSectors } from '../services/modeling-policy.js';

const SESSION_HOURS = 12;
const password = z.string().superRefine((v, ctx) => { const p = passwordProblems(v); if (p) ctx.addIssue({ code: 'custom', message: p }); });

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
export const LOCKED = { error: 'conta_bloqueada', message: `Demasiadas tentativas falhadas. Tente de novo dentro de ${LOCK_MINUTES} minutos ou peça ao RH uma ligação de recuperação.` };
export const isLocked = (u: { lockedUntil: Date | null }) => Boolean(u.lockedUntil && u.lockedUntil > new Date());

/** Conta falhas por utilizador: à 5.ª, bloqueia 15 minutos (protege PINs de 6 dígitos contra tentativas). */
export async function registerFailure(db: Db, u: { id: string; failedAttempts: number }) {
  const n = u.failedAttempts + 1;
  await db.update(users).set(n >= MAX_FAILURES ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedAttempts: n }).where(eq(users.id, u.id));
}

/** Fim do login: verificação em dois passos (se activa), sessão, auditoria. */
export async function completeLogin(c: Ctx, db: Db, u: typeof users.$inferSelect, co: typeof companies.$inferSelect, method: string, secondFactorDone = false) {
  if (u.disabledAt) return c.json({ error: 'acesso_desactivado', message: 'O seu acesso foi desactivado. Contacte os Recursos Humanos.' }, 403);
  if (u.totpEnabledAt && !secondFactorDone) {
    const ticket = await sign({ sub: u.id, purpose: '2fa', exp: Math.floor(Date.now() / 1000) + 300 }, jwtSecret(), 'HS256');
    return c.json({ twoFactor: true, ticket });
  }
  const token = await startSession(c, { sub: u.id, companyId: co.id, role: u.role, employeeId: u.employeeId, name: u.name });
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await db.insert(auditLogs).values({ companyId: co.id, actorId: u.id, action: 'login', entity: 'user', entityId: u.id, after: { method } });
  return c.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role }, company: { id: co.id, name: co.name }, token });
}

export async function startSession(c: Ctx, claims: SessionClaims) {
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
      modules: z.array(z.enum(['hr', 'modeling'])).min(1, 'Escolha pelo menos um módulo').max(2).refine(v => new Set(v).size === v.length, 'Módulo repetido').default(['hr']),
      hrPlan: z.object({ tierKey: z.enum(DEFAULT_TIERS.map(t => t.key) as [string, ...string[]]), cycle: z.enum(['monthly', 'semiannual', 'annual']) }).optional(),
      modelingPlan: z.object({ key: z.enum(MODELING_PLANS.map(p => p.key) as [string, ...string[]]), cycle: z.enum(['monthly', 'semiannual', 'annual']), primarySector: z.enum(FINANCIAL_SECTORS), sectors: z.array(z.enum(FINANCIAL_SECTORS)).min(1).max(8) }).optional(),
    }).parse(await body(c));
    const hasHr = b.modules.includes('hr'), hasModeling = b.modules.includes('modeling');
    const hrTier = DEFAULT_TIERS.find(t => t.key === b.hrPlan?.tierKey) ?? tierFor(b.company.employeesEstimate ?? 1);
    if (hasHr && hrTier.maxEmployees !== null && hrTier.maxEmployees < (b.company.employeesEstimate ?? 1)) return c.json({ error: 'escalao_pequeno', message: 'Escolha uma faixa que inclua todos os colaboradores declarados.' }, 400);
    const modelingPlan = MODELING_PLANS.find(p => p.key === b.modelingPlan?.key) ?? MODELING_PLANS[0];
    const modelingCycle = b.modelingPlan?.cycle ?? 'monthly';
    if (hasModeling && !b.modelingPlan) return c.json({ error: 'plano_obrigatorio', message: 'Escolha o plano, o sector principal e os sectores adicionais da Modelagem.' }, 400);
    const modelingSectors = hasModeling ? validateModelingSectors(modelingPlan.key, b.modelingPlan!.primarySector, b.modelingPlan!.sectors) : [];
    if (hasModeling && modelingPlan.prices[modelingCycle] === null) return c.json({ error: 'ciclo_indisponivel', message: 'O plano ilimitado só está disponível com pagamento semestral ou anual.' }, 400);
    const db = getDb();
    const passwordHash = await hashPassword(b.password);
    const result = await db.transaction(async (tx) => {
      const [co] = await tx.insert(companies).values({ name: b.company.name, nif: b.company.nif, sector: b.company.sector ?? null, address: b.company.address ?? null, code: companyCode() }).returning();
      // Período experimental com o escalão adequado à dimensão declarada.
      const trialEnd = new Date(Date.parse(luandaDate(new Date())) + TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10);
      await tx.insert(subscriptions).values({ companyId: co!.id, status: hasHr ? 'trial' : 'cancelled', tierKey: hrTier.key, cycle: b.hrPlan?.cycle ?? 'monthly', trialEndsAt: hasHr ? trialEnd : null });
      const [u] = await tx.insert(users).values({ companyId: co!.id, email: b.email.toLowerCase(), name: b.name, passwordHash, role: 'owner' }).returning();
      await tx.insert(companyModules).values([
        { companyId: co!.id, module: 'hr', enabled: hasHr, status: hasHr ? 'trial' : 'cancelled' },
        { companyId: co!.id, module: 'modeling', enabled: hasModeling, status: hasModeling ? 'trial' : 'cancelled', trialEndsAt: hasModeling ? trialEnd : null, planKey: hasModeling ? modelingPlan.key : null, cycle: hasModeling ? modelingCycle : null, projectLimit: hasModeling ? modelingPlan.projectLimit : 1, primarySector: hasModeling ? b.modelingPlan!.primarySector : defaultModelingSector(b.company.sector), modelingSectors },
      ]);
      if (hasModeling) await tx.insert(modelingMembers).values({ companyId: co!.id, userId: u!.id, addedBy: u!.id });
      // Pré-configuração do sector: regimes de horário e subsídios sugeridos (a empresa ajusta depois).
      if (hasHr) await applySectorPreset(tx, co!.id, co!.sector, u!.id);
      await tx.insert(auditLogs).values({ companyId: co!.id, actorId: u!.id, action: 'register', entity: 'company', entityId: co!.id, after: { company: co, owner: { id: u!.id, email: u!.email }, modules: b.modules, hrPlan: hasHr ? { tierKey: hrTier.key, cycle: b.hrPlan?.cycle ?? 'monthly' } : null, modelingPlan: hasModeling ? { key: modelingPlan.key, cycle: modelingCycle } : null } });
      return { company: co!, user: u! };
    });
    const token = await startSession(c, { sub: result.user.id, companyId: result.company.id, role: 'owner', employeeId: null, name: result.user.name });
    // Boas-vindas ao proprietário e aviso à administração da plataforma (sem bloquear o registo).
    const base = appBaseUrl();
    const trialEnd = new Date(Date.parse(luandaDate(new Date())) + TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10).split('-').reverse().join('/');
    await sendMail(db, {
      to: result.user.email, companyId: result.company.id, kind: 'boas_vindas', subject: 'Bem-vindo ao Kianda RH', title: `Bem-vindo ao Kianda RH, ${result.user.name.split(' ')[0]}`,
      paragraphs: [`A conta de ${result.company.name} está criada, com ${TRIAL_DAYS} dias de período experimental (até ${trialEnd}) nos módulos escolhidos: ${[hasHr ? 'Recursos Humanos' : '', hasModeling ? 'Modelagem Financeira' : ''].filter(Boolean).join(' e ')}.`, 'Consulte os módulos, planos e pagamentos na página Módulos e licenças. Cada módulo tem a sua subscrição.'],
      facts: [['Código da empresa', result.company.code ?? '—']], button: base ? { label: 'Ver módulos e licenças', url: `${base}/licenca` } : null,
    });
    for (const a of await db.select().from(platformAdmins)) {
      await sendMail(db, {
        to: a.email, kind: 'plataforma_registo', subject: `Nova empresa no Kianda RH — ${result.company.name}`, title: 'Nova empresa registada',
        paragraphs: [`${result.company.name} (NIF ${result.company.nif}) registou-se${b.company.sector ? ` — sector ${SECTORS[b.company.sector]}` : ''}${b.company.employeesEstimate ? `, cerca de ${b.company.employeesEstimate} colaboradores` : ''}.`, `Proprietário: ${result.user.name} (${result.user.email}).`],
        button: base ? { label: 'Abrir consola', url: `${base}/plataforma` } : null,
      });
    }
    return c.json({ company: result.company, user: { id: result.user.id, name: result.user.name, email: result.user.email, role: 'owner' }, token }, 201);
  });

  app.post('/v1/auth/login', rateLimit('login', 10, 900_000), async (c) => {
    const b = z.object({ email: z.email(), password: z.string().min(1), companyNif: z.string().optional() }).parse(await body(c));
    const db = getDb();
    const rows = await db.select({ u: users, co: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
      .where(b.companyNif ? and(eq(users.email, b.email.toLowerCase()), eq(companies.nif, b.companyNif)) : eq(users.email, b.email.toLowerCase()));
    if (rows.length > 1) return c.json({ error: 'varias_empresas', message: 'Este email existe em várias empresas. Indique o NIF da empresa.' }, 409);
    const row = rows[0];
    if (row && isLocked(row.u)) return c.json(LOCKED, 429);
    // Mesma resposta para email inexistente e palavra-passe errada (não revela contas).
    if (!row || !(await verifyPassword(b.password, row.u.passwordHash))) {
      if (row) await registerFailure(db, row.u);
      return c.json({ error: 'credenciais_invalidas', message: 'Email ou palavra-passe incorrectos.' }, 401);
    }
    return completeLogin(c, db, row.u, row.co, 'password');
  });

  /** Segundo passo: código da aplicação autenticadora (bilhete de 5 minutos emitido no primeiro passo). */
  app.post('/v1/auth/login/2fa', rateLimit('login2fa', 10, 900_000), async (c) => {
    const b = z.object({ ticket: z.string(), code: z.string().trim() }).parse(await body(c));
    let claims: { sub: string; purpose: string };
    try {
      claims = (await verify(b.ticket, jwtSecret(), 'HS256')) as unknown as { sub: string; purpose: string };
      if (claims.purpose !== '2fa') throw new Error('bilhete');
    } catch {
      return c.json({ error: 'bilhete_expirado', message: 'O pedido expirou. Volte a iniciar sessão.' }, 401);
    }
    const db = getDb();
    const [row] = await db.select({ u: users, co: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId)).where(eq(users.id, claims.sub));
    if (!row || !row.u.totpSecret || !row.u.totpEnabledAt) return c.json({ error: 'bilhete_expirado', message: 'Volte a iniciar sessão.' }, 401);
    if (isLocked(row.u)) return c.json(LOCKED, 429);
    if (!(await verifyTotp(row.u.totpSecret, b.code))) {
      await registerFailure(db, row.u);
      return c.json({ error: 'codigo_invalido', message: 'Código incorrecto. Confirme a hora do telemóvel e use o código mais recente.' }, 401);
    }
    return completeLogin(c, db, row.u, row.co, '2fa', true);
  });

  /** Alterar a própria palavra-passe (confirma a actual). */
  app.post('/v1/auth/password', requireCompany, rateLimit('password', 10, 900_000), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ current: z.string().min(1, 'Indique a palavra-passe actual'), next: password }).parse(await body(c));
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, actor.actorId));
    if (!u || !(await verifyPassword(b.current, u.passwordHash))) return c.json({ error: 'credenciais_invalidas', message: 'A palavra-passe actual está errada.' }, 400);
    if (b.current === b.next) return c.json({ error: 'igual', message: 'A nova palavra-passe tem de ser diferente da actual.' }, 400);
    await db.update(users).set({ passwordHash: await hashPassword(b.next) }).where(eq(users.id, u.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'change_password', entity: 'user', entityId: u.id });
    return c.json({ ok: true });
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
      modules: await companyModulesOverview(db, companyId, session.sub, session.role),
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
