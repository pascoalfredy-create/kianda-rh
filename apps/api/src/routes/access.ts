import { normalizePhone, otpauthUri, pinProblem, randomBase32, randomToken, sha256Hex, verifyTotp } from '@kianda/core';
import {
  accessLinks, and, auditLogs, companies, desc, employees, eq, getDb, hashPassword, isNull, passwordProblems, sql, users, verifyPassword, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, rateLimit, requireCompany, requireRole, type Actor, type AppEnv, type Role } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { appBaseUrl, mailConfig } from '../services/integrations.js';
import { sendMail } from '../services/mail.js';
import { completeLogin, isLocked, LOCKED, registerFailure } from './auth.js';
import { moduleLicence } from '../services/modules.js';

const LINK_DAYS = 7;
const SELF_RESET_MINUTES = 60;
const ROLES = ['hr_admin', 'payroll', 'finance', 'manager', 'employee'] as const;
const ROLE_LABEL: Record<string, string> = { owner: 'Proprietário', hr_admin: 'Administração de RH', payroll: 'Processamento salarial', finance: 'Finanças', manager: 'Chefia', employee: 'Colaborador' };

/** Só o proprietário mexe em acessos de proprietários e de administradores de RH. */
function assertCanManage(actor: Actor, targetRole: string) {
  if ((targetRole === 'owner' || targetRole === 'hr_admin') && actor.role !== 'owner') throw new DomainError('sem_permissao', 'Só o proprietário gere acessos de administração', 403);
}

async function linkByToken(db: Db, token: string) {
  const [l] = await db.select({ l: accessLinks, company: companies.name, code: companies.code }).from(accessLinks).innerJoin(companies, eq(companies.id, accessLinks.companyId))
    .where(eq(accessLinks.tokenHash, await sha256Hex(token)));
  if (!l) throw new DomainError('ligacao_invalida', 'Ligação inválida. Peça uma nova aos Recursos Humanos.', 404);
  if (l.l.usedAt) throw new DomainError('ligacao_usada', 'Esta ligação já foi usada. Se precisa de recuperar o acesso, peça uma nova aos Recursos Humanos.', 410);
  if (l.l.revokedAt || l.l.expiresAt < new Date()) throw new DomainError('ligacao_expirada', 'Esta ligação expirou. Peça uma nova aos Recursos Humanos.', 410);
  return l;
}

/** Cria uma ligação e devolve o token em claro (só nesta resposta). */
async function createLink(db: Db, actor: Actor, v: { kind: 'invite' | 'reset'; userId?: string | null; employeeId?: string | null; name?: string | null; role: string; email?: string | null; phone?: string | null }) {
  const token = randomToken();
  // Uma ligação activa de cada vez por pessoa: as anteriores deixam de funcionar.
  if (v.employeeId) await db.update(accessLinks).set({ revokedAt: new Date() }).where(and(eq(accessLinks.employeeId, v.employeeId), isNull(accessLinks.usedAt), isNull(accessLinks.revokedAt)));
  if (v.userId) await db.update(accessLinks).set({ revokedAt: new Date() }).where(and(eq(accessLinks.userId, v.userId), isNull(accessLinks.usedAt), isNull(accessLinks.revokedAt)));
  const [l] = await db.insert(accessLinks).values({
    companyId: actor.companyId, kind: v.kind, userId: v.userId ?? null, employeeId: v.employeeId ?? null, name: v.name ?? null, role: v.role,
    email: v.email?.toLowerCase() ?? null, phone: v.phone ? normalizePhone(v.phone) : null, tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000), createdBy: actor.actorId,
  }).returning();
  await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: v.kind === 'invite' ? 'invite' : 'access_reset', entity: 'access_link', entityId: l!.id, after: { role: v.role, employeeId: v.employeeId, userId: v.userId } });
  // Com email configurado e endereço conhecido, a ligação segue também por email (a partilha manual continua possível).
  let emailed = false;
  const base = appBaseUrl();
  if (v.email && base) {
    const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, actor.companyId));
    const invite = v.kind === 'invite';
    emailed = (await sendMail(db, {
      to: v.email, companyId: actor.companyId, kind: invite ? 'convite' : 'recuperacao',
      subject: invite ? `Convite para o Kianda RH — ${co?.name ?? ''}` : `Kianda RH — recuperação de acesso`,
      title: invite ? `Bem-vindo(a) ao Kianda RH${v.name ? `, ${v.name.split(' ')[0]}` : ''}` : 'Recuperação de acesso',
      paragraphs: invite
        ? [`${co?.name ?? 'A sua empresa'} convidou-o(a) para a plataforma Kianda. Depois de entrar, verá os módulos e acessos autorizados pela empresa.`, `A ligação é pessoal, só pode ser usada uma vez e é válida durante ${LINK_DAYS} dias.`]
        : ['Os Recursos Humanos geraram uma ligação para definir uma nova palavra-passe ou PIN.', `A ligação só pode ser usada uma vez e é válida durante ${LINK_DAYS} dias. Se não pediu esta recuperação, avise os Recursos Humanos.`],
      button: { label: invite ? 'Criar o meu acesso' : 'Definir novo acesso', url: `${base}/acesso/${token}` },
    })) === 'sent';
  }
  return { id: l!.id, token, path: `/acesso/${token}`, expiresAt: l!.expiresAt, emailed };
}

const credentials = z.object({
  method: z.enum(['password', 'pin']),
  email: z.email('Email inválido').optional().nullable(),
  password: z.string().optional().nullable(),
  pin: z.string().optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
});

async function credentialValues(b: z.infer<typeof credentials>) {
  if (b.method === 'password') {
    if (!b.email) throw new DomainError('email_obrigatorio', 'Indique o email', 400);
    const p = passwordProblems(b.password ?? '');
    if (p) throw new DomainError('palavra_passe_fraca', p, 400);
    return { email: b.email.toLowerCase(), passwordHash: await hashPassword(b.password!) };
  }
  const p = pinProblem(b.pin ?? '');
  if (p) throw new DomainError('pin_fraco', p, 400);
  return { pinHash: await hashPassword(b.pin!) };
}

export function accessRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/access', '/v1/access/*', '/v1/users/*', '/v1/auth/2fa', '/v1/auth/2fa/*']) app.use(p, requireCompany);

  // ——— Entrada por código da empresa + n.º mecanográfico/telefone + PIN ———
  app.post('/v1/auth/login-pin', rateLimit('login-pin', 10, 900_000), async (c) => {
    const b = z.object({ companyCode: z.string().trim().min(4).max(12), identifier: z.string().trim().min(1).max(30), pin: z.string().trim() }).parse(await body(c));
    const db = getDb();
    const generic = c.json({ error: 'credenciais_invalidas', message: 'Código da empresa, número ou PIN incorrectos.' }, 401);
    const [co] = await db.select().from(companies).where(eq(companies.code, b.companyCode.toUpperCase()));
    if (!co) return generic;
    const id = b.identifier.replace(/\s/g, '');
    const phone = normalizePhone(id);
    const [emp] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.companyId, co.id), sql`(${employees.number} = ${id} or regexp_replace(coalesce(${employees.phone}, ''), '\\D', '', 'g') in (${phone}, ${`244${phone}`}))`)).limit(1);
    const [u] = emp
      ? await db.select().from(users).where(and(eq(users.companyId, co.id), eq(users.employeeId, emp.id)))
      : await db.select().from(users).where(and(eq(users.companyId, co.id), eq(users.phone, phone)));
    if (!u || !u.pinHash) return generic;
    if (isLocked(u)) return c.json(LOCKED, 429);
    if (!(await verifyPassword(b.pin, u.pinHash))) { await registerFailure(db, u); return generic; }
    return completeLogin(c, db, u, co, 'pin');
  });

  // ——— Esqueci a palavra-passe (autosserviço por email) ———
  /**
   * Resposta sempre igual, exista ou não o email (não revela contas). Ligação de uso único válida 1 hora.
   * Ao contrário da recuperação pelo RH, esta NÃO retira a verificação em dois passos: quem só controla o email
   * não passa o segundo passo.
   */
  app.post('/v1/auth/forgot', rateLimit('forgot', 5, 3_600_000), async (c) => {
    const b = z.object({ email: z.email('Email inválido') }).parse(await body(c));
    const base = appBaseUrl();
    const enabled = Boolean(mailConfig() && base);
    const reply = {
      ok: true, emailEnabled: enabled,
      message: enabled
        ? `Se este email tiver acesso ao Kianda RH, vai receber em poucos minutos uma ligação para definir uma nova palavra-passe (válida durante ${SELF_RESET_MINUTES} minutos).`
        : 'A recuperação por email ainda não está activa. Peça aos Recursos Humanos uma ligação de recuperação.',
    };
    if (!enabled) return c.json(reply);
    const db = getDb();
    const rows = await db.select({ u: users, company: companies.name }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
      .where(and(eq(users.email, b.email.toLowerCase()), isNull(users.disabledAt), sql`${users.passwordHash} <> '!'`));
    for (const { u, company } of rows) {
      // No máximo um pedido a cada 2 minutos por conta (evita encher a caixa de correio de alguém).
      const [recent] = await db.select({ id: accessLinks.id }).from(accessLinks)
        .where(and(eq(accessLinks.userId, u.id), eq(accessLinks.kind, 'self_reset'), sql`${accessLinks.createdAt} > now() - interval '2 minutes'`));
      if (recent) continue;
      const token = randomToken();
      await db.update(accessLinks).set({ revokedAt: new Date() }).where(and(eq(accessLinks.userId, u.id), eq(accessLinks.kind, 'self_reset'), isNull(accessLinks.usedAt), isNull(accessLinks.revokedAt)));
      const [l] = await db.insert(accessLinks).values({
        companyId: u.companyId, kind: 'self_reset', userId: u.id, role: u.role, email: u.email, tokenHash: await sha256Hex(token),
        expiresAt: new Date(Date.now() + SELF_RESET_MINUTES * 60_000), createdBy: u.id,
      }).returning();
      await db.insert(auditLogs).values({ companyId: u.companyId, actorId: u.id, action: 'password_reset_requested', entity: 'access_link', entityId: l!.id });
      await sendMail(db, {
        to: u.email, companyId: u.companyId, kind: 'recuperacao',
        subject: 'Kianda RH — definir nova palavra-passe',
        title: 'Definir nova palavra-passe',
        paragraphs: [
          `Recebemos um pedido para definir uma nova palavra-passe do seu acesso à ${company}.`,
          `A ligação só pode ser usada uma vez e é válida durante ${SELF_RESET_MINUTES} minutos. A verificação em dois passos mantém-se.`,
          'Se não fez este pedido, ignore este email — a palavra-passe actual continua válida.',
        ],
        button: { label: 'Definir nova palavra-passe', url: `${base}/acesso/${token}` },
      });
    }
    return c.json(reply);
  });

  // ——— Ligações de acesso (públicas: aceitar convite / recuperar) ———
  app.get('/v1/public/access/:token', async (c) => {
    const db = getDb();
    const { l, company, code } = await linkByToken(db, c.req.param('token'));
    const [emp] = l.employeeId ? await db.select({ name: employees.name, number: employees.number, email: employees.email, phone: employees.phone }).from(employees).where(eq(employees.id, l.employeeId)) : [];
    const [u] = l.userId ? await db.select({ name: users.name, email: users.email, pin: users.pinHash }).from(users).where(eq(users.id, l.userId)) : [];
    return c.json({
      kind: l.kind, company, companyCode: code, role: l.role, roleLabel: ROLE_LABEL[l.role] ?? l.role, name: u?.name ?? emp?.name ?? l.name,
      number: emp?.number ?? null, email: u?.email ?? l.email ?? emp?.email ?? null, phone: l.phone ?? emp?.phone ?? null, hasPin: Boolean(u?.pin), expiresAt: l.expiresAt,
      // Perfis de gestão entram sempre com email e palavra-passe (o PIN é para colaboradores).
      pinAllowed: l.kind !== 'self_reset' && (l.role === 'employee' || l.role === 'manager'),
    });
  });

  app.post('/v1/public/access/:token', rateLimit('access-accept', 10, 900_000), async (c) => {
    const db = getDb();
    const { l } = await linkByToken(db, c.req.param('token'));
    const b = credentials.parse(await body(c));
    if (l.kind === 'self_reset' && b.method !== 'password') throw new DomainError('metodo_invalido', 'Esta ligação serve para definir uma nova palavra-passe', 400);
    if (b.method === 'pin' && !(l.role === 'employee' || l.role === 'manager')) throw new DomainError('metodo_invalido', 'Este perfil entra com email e palavra-passe', 400);
    const creds = await credentialValues(b);
    if ('email' in creds && creds.email) {
      const [dup] = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, l.companyId), eq(users.email, creds.email)));
      if (dup && dup.id !== l.userId) throw new DomainError('email_em_uso', 'Este email já tem acesso nesta empresa', 409);
    }
    const userId = await db.transaction(async (tx) => {
      let id = l.userId;
      if (l.kind === 'invite') {
        const [emp] = l.employeeId ? await tx.select().from(employees).where(eq(employees.id, l.employeeId)) : [];
        const [u] = await tx.insert(users).values({
          companyId: l.companyId, name: emp?.name ?? l.name ?? 'Utilizador', role: l.role as Role, employeeId: l.employeeId,
          phone: b.phone ? normalizePhone(b.phone) : l.phone, passwordHash: ('passwordHash' in creds && creds.passwordHash) || '!',
          email: ('email' in creds && creds.email) || null, pinHash: ('pinHash' in creds && creds.pinHash) || null,
        }).returning();
        id = u!.id;
      } else if (l.kind === 'self_reset') {
        // Autosserviço: só a palavra-passe; o email não muda e a verificação em dois passos fica.
        await tx.update(users).set({ passwordHash: (creds as { passwordHash: string }).passwordHash, failedAttempts: 0, lockedUntil: null }).where(eq(users.id, l.userId!));
      } else {
        // Recuperação: redefine a credencial escolhida, desbloqueia e retira a verificação em dois passos (telemóvel perdido).
        await tx.update(users).set({ ...creds, failedAttempts: 0, lockedUntil: null, totpSecret: null, totpEnabledAt: null }).where(eq(users.id, l.userId!));
      }
      await tx.update(accessLinks).set({ usedAt: new Date() }).where(eq(accessLinks.id, l.id));
      await tx.insert(auditLogs).values({ companyId: l.companyId, actorId: id!, action: l.kind === 'invite' ? 'accept_invite' : l.kind === 'self_reset' ? 'password_reset' : 'access_recovered', entity: 'user', entityId: id!, after: { method: b.method } });
      return id!;
    });
    const [row] = await db.select({ u: users, co: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId)).where(eq(users.id, userId));
    // Com a verificação em dois passos activa, o autosserviço ainda pede o código da aplicação.
    return completeLogin(c, db, row!.u, row!.co, `link_${b.method}`, l.kind !== 'self_reset');
  });

  // ——— Gestão de acessos (RH) ———

  /** Colaboradores e utilizadores com o estado do acesso de cada um. */
  app.get('/v1/access', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const us = await db.select().from(users).where(eq(users.companyId, actor.companyId));
    const hasHr = (await moduleLicence(db, actor.companyId, 'hr')).canRead;
    const emps = hasHr ? await db.select({ id: employees.id, name: employees.name, number: employees.number, email: employees.email, phone: employees.phone, status: employees.status, jobTitle: employees.jobTitle })
      .from(employees).where(eq(employees.companyId, actor.companyId)).orderBy(employees.number) : [];
    const links = await db.select().from(accessLinks).where(and(eq(accessLinks.companyId, actor.companyId), isNull(accessLinks.usedAt), isNull(accessLinks.revokedAt))).orderBy(desc(accessLinks.createdAt));
    const now = new Date();
    const userView = (u: typeof us[number]) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, roleLabel: ROLE_LABEL[u.role] ?? u.role, employeeId: u.employeeId,
      hasPassword: u.passwordHash !== '!', hasPin: Boolean(u.pinHash), twoFactor: Boolean(u.totpEnabledAt), disabled: Boolean(u.disabledAt), locked: isLocked(u), lastLoginAt: u.lastLoginAt,
      self: u.id === actor.actorId,
    });
    const pending = (f: (l: typeof links[number]) => boolean) => links.filter((l) => f(l) && l.expiresAt > now).map((l) => ({ id: l.id, kind: l.kind, role: l.role, expiresAt: l.expiresAt }))[0] ?? null;
    return c.json({
      employees: emps.map((e) => {
        const u = us.find((x) => x.employeeId === e.id);
        return { ...e, user: u ? userView(u) : null, pendingLink: pending((l) => l.employeeId === e.id) };
      }),
      staff: us.filter((u) => !hasHr || !u.employeeId).map((u) => ({ ...userView(u), pendingLink: pending((l) => l.userId === u.id) })),
      staffInvites: links.filter((l) => l.kind === 'invite' && !l.employeeId && l.expiresAt > now).map((l) => ({ id: l.id, name: l.name, email: l.email, role: l.role, roleLabel: ROLE_LABEL[l.role], expiresAt: l.expiresAt })),
      roles: Object.fromEntries(ROLES.map((r) => [r, ROLE_LABEL[r]])),
    });
  });

  /** Convidar: um colaborador (fica ligado à ficha) ou um utilizador de gestão sem ficha (contabilista externo, etc.). */
  app.post('/v1/access/invites', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      employeeId: z.string().optional().nullable(), name: z.string().trim().min(2).max(120).optional().nullable(),
      role: z.enum(ROLES).default('employee'), email: z.email().optional().nullable().or(z.literal('').transform(() => null)), phone: z.string().trim().max(30).optional().nullable(),
    }).parse(await body(c));
    assertCanManage(actor, b.role);
    const db = getDb();
    if (b.employeeId) {
      if (!(await moduleLicence(db, actor.companyId, 'hr')).canWrite) throw new DomainError('rh_inactivo', 'Convidar a partir da ficha de colaborador requer o módulo RH activo.', 403);
      const [e] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
      if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
      if (e.status === 'terminated') throw new DomainError('colaborador_cessado', 'Colaborador cessado: não pode receber acesso', 409);
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.employeeId, e.id));
      if (u) throw new DomainError('ja_tem_acesso', 'Este colaborador já tem acesso: use "Recuperar acesso"', 409);
      return c.json(await createLink(db, actor, { kind: 'invite', employeeId: e.id, name: e.name, role: b.role, email: b.email ?? e.email, phone: b.phone ?? e.phone }), 201);
    }
    if (!b.name || !b.email) throw new DomainError('dados_em_falta', 'Indique o nome e o email do utilizador', 400);
    if (b.role === 'employee') throw new DomainError('perfil_invalido', 'Um colaborador é convidado a partir da sua ficha', 400);
    return c.json(await createLink(db, actor, { kind: 'invite', name: b.name, role: b.role, email: b.email }), 201);
  });

  /** Recuperar acesso (palavra-passe/PIN esquecido, telemóvel da verificação em dois passos perdido). */
  app.post('/v1/users/:id/recovery', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [u] = await db.select().from(users).where(and(eq(users.id, c.req.param('id')), eq(users.companyId, actor.companyId)));
    if (!u) throw new DomainError('nao_encontrado', 'Utilizador inexistente', 404);
    assertCanManage(actor, u.role);
    if (u.id === actor.actorId) throw new DomainError('proprio', 'Para mudar a sua palavra-passe use "A minha conta"', 400);
    return c.json(await createLink(db, actor, { kind: 'reset', userId: u.id, role: u.role, email: u.email, phone: u.phone }), 201);
  });

  app.post('/v1/access/links/:id/revoke', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const [l] = await getDb().update(accessLinks).set({ revokedAt: new Date() }).where(and(eq(accessLinks.id, c.req.param('id')), eq(accessLinks.companyId, actor.companyId), isNull(accessLinks.usedAt))).returning();
    if (!l) throw new DomainError('nao_encontrado', 'Ligação inexistente ou já usada', 404);
    return c.json({ ok: true });
  });

  app.patch('/v1/users/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() }).parse(await body(c));
    const db = getDb();
    const [u] = await db.select().from(users).where(and(eq(users.id, c.req.param('id')), eq(users.companyId, actor.companyId)));
    if (!u) throw new DomainError('nao_encontrado', 'Utilizador inexistente', 404);
    if (u.id === actor.actorId) throw new DomainError('proprio', 'Não pode alterar o seu próprio acesso', 400);
    assertCanManage(actor, u.role);
    if (b.role) assertCanManage(actor, b.role);
    if (b.role === 'employee' && !u.employeeId) throw new DomainError('perfil_invalido', 'O perfil de colaborador exige ficha', 400);
    const [x] = await db.update(users).set({ ...(b.role ? { role: b.role } : {}), ...(b.disabled !== undefined ? { disabledAt: b.disabled ? new Date() : null, failedAttempts: 0, lockedUntil: null } : {}) }).where(eq(users.id, u.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update_access', entity: 'user', entityId: u.id, before: { role: u.role, disabled: Boolean(u.disabledAt) }, after: b });
    return c.json({ id: x!.id, role: x!.role, disabled: Boolean(x!.disabledAt) });
  });

  // ——— Verificação em dois passos (o próprio utilizador) ———

  app.get('/v1/auth/2fa', async (c) => {
    const [u] = await getDb().select().from(users).where(eq(users.id, c.get('actor').actorId));
    return c.json({ enabled: Boolean(u?.totpEnabledAt), enabledAt: u?.totpEnabledAt ?? null, recommended: ['owner', 'finance', 'hr_admin'].includes(u?.role ?? '') });
  });

  app.post('/v1/auth/2fa/setup', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, actor.actorId));
    if (u?.totpEnabledAt) throw new DomainError('ja_activa', 'A verificação em dois passos já está activa', 409);
    const secret = randomBase32();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, actor.actorId));
    return c.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri: otpauthUri(secret, u?.email ?? u?.name ?? 'utilizador') });
  });

  app.post('/v1/auth/2fa/enable', async (c) => {
    const actor = c.get('actor');
    const { code } = z.object({ code: z.string().trim() }).parse(await body(c));
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, actor.actorId));
    if (!u?.totpSecret) throw new DomainError('sem_configuracao', 'Comece por gerar o código QR', 400);
    if (!(await verifyTotp(u.totpSecret, code))) throw new DomainError('codigo_invalido', 'Código incorrecto. Confirme que a hora do telemóvel está certa.', 400);
    await db.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, u.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: '2fa_enabled', entity: 'user', entityId: u.id });
    return c.json({ ok: true });
  });

  app.post('/v1/auth/2fa/disable', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ password: z.string().min(1), code: z.string().trim() }).parse(await body(c));
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, actor.actorId));
    if (!u?.totpEnabledAt || !u.totpSecret) throw new DomainError('nao_activa', 'A verificação em dois passos não está activa', 400);
    if (!(await verifyPassword(b.password, u.passwordHash)) || !(await verifyTotp(u.totpSecret, b.code))) throw new DomainError('credenciais_invalidas', 'Palavra-passe ou código incorrectos', 400);
    await db.update(users).set({ totpSecret: null, totpEnabledAt: null }).where(eq(users.id, u.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: '2fa_disabled', entity: 'user', entityId: u.id });
    return c.json({ ok: true });
  });

  return app;
}
