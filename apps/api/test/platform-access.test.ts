import { accessLinks, and, closeDb, companyModules, eq, getDb, platformAdmins, subscriptions } from '@kianda/db';
import { totp } from '@kianda/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';
import { createPlatformUser, PLATFORM_PASSWORD } from './platform-admin.js';

const app = testClient(buildApp({ rateLimit: false }));
const session = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('conta exclusiva de administração', () => {
  const nif = String(Date.now() + 7600).slice(-10), email = `admin-${nif}@platform.test`;
  const password = 'EmpresaSegura2026abc';
  let adminId: string, internalId: string, customerId: string, customerUserId: string;
  let admin: string, customer: string;
  const req = (cookie: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, payload });
  const login = (password: string, area?: 'plataforma') => req('', 'POST', '/v1/auth/login', { email, password, area });

  beforeAll(async () => {
    const reg = await req('', 'POST', '/v1/auth/register', {
      company: { name: 'Empresa com email comum', nif }, name: 'Proprietário', email, password, acceptTerms: true,
    });
    expect(reg.statusCode, reg.body).toBe(201);
    customerId = reg.json().company.id;
    customerUserId = reg.json().user.id;
    customer = session(reg);
    const actor = await createPlatformUser(email);
    adminId = actor.id;
    internalId = actor.companyId;
    // Uma conta administrativa antiga pode ainda ter licenças activas à data do deploy.
    await getDb().insert(subscriptions).values({ companyId: internalId, status: 'active', paidUntil: '2099-12-31' }).onConflictDoNothing();
    await getDb().insert(companyModules).values((['modeling', 'valuation'] as const).map(module => ({
      companyId: internalId, module, status: 'active', enabled: true, paidUntil: '2099-12-31', projectLimit: 5,
    }))).onConflictDoNothing();
  });

  it('encaminha cada início de sessão para a conta correspondente ao mesmo email', async () => {
    const platform = await login(PLATFORM_PASSWORD, 'plataforma');
    expect(platform.statusCode, platform.body).toBe(200);
    expect(platform.json()).toMatchObject({ platformAdmin: true, company: null, user: { id: adminId } });
    admin = session(platform);
    expect((await login(password)).json()).toMatchObject({ platformAdmin: false, company: { id: customerId } });
    expect((await login(password, 'plataforma')).statusCode).toBe(401);
    expect((await req(customer, 'GET', '/v1/auth/me')).json()).toMatchObject({ platformAdmin: false, company: { id: customerId }, modules: { hr: { canAccess: true } } });
    expect((await req(customer, 'GET', '/v1/platform/companies')).statusCode).toBe(403);
    expect((await req(customer, 'GET', '/v1/employees')).statusCode).toBe(200);
  });

  it('mantém o controlo de clientes e bloqueia o acesso directo aos módulos e à facturação própria', async () => {
    const me = await req(admin, 'GET', '/v1/auth/me');
    expect(me.json()).toMatchObject({ platformAdmin: true, company: null, licence: null });
    expect(Object.values(me.json().modules)).toHaveLength(3);
    for (const access of Object.values(me.json().modules)) expect(access).toMatchObject({ subscribed: false, canAccess: false });
    const customers = (await req(admin, 'GET', '/v1/platform/companies')).json().companies;
    expect(customers).toContainEqual(expect.objectContaining({ id: customerId }));
    expect(customers).not.toContainEqual(expect.objectContaining({ id: internalId }));
    for (const path of ['/v1/employees', '/v1/modeling/bootstrap', '/v1/valuation/bootstrap', '/v1/modules', '/v1/billing', '/v1/users', '/v1/company/branding']) {
      const denied = await req(admin, 'GET', path);
      expect(denied.statusCode, path).toBe(403);
      expect(denied.json().error, path).toBe('conta_da_plataforma');
    }
    expect((await req(admin, 'POST', '/v1/employees', {})).statusCode).toBe(403);
    expect((await req(admin, 'PUT', `/v1/platform/companies/${internalId}/modules/hr`, { enabled: true })).statusCode).toBe(403);
    expect((await req(admin, 'GET', `/v1/platform/companies/${internalId}/export`)).statusCode).toBe(403);
  });

  it('envia a recuperação à conta pedida quando o email é partilhado', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_teste');
    vi.stubEnv('MAIL_FROM', 'Kianda <noreply@platform.test>');
    vi.stubEnv('APP_BASE_URL', 'https://kianda.test');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'teste' })));
    try {
      const resets = () => getDb().select({ userId: accessLinks.userId }).from(accessLinks)
        .where(and(eq(accessLinks.email, email), eq(accessLinks.kind, 'self_reset')));
      expect((await req('', 'POST', '/v1/auth/forgot', { email })).statusCode).toBe(200);
      expect(await resets()).toEqual([{ userId: customerUserId }]);
      expect((await req('', 'POST', '/v1/auth/forgot', { email, area: 'plataforma' })).statusCode).toBe(200);
      expect(await resets()).toEqual(expect.arrayContaining([{ userId: customerUserId }, { userId: adminId }]));
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('permite 2FA e logout e retira a consola a uma sessão cujo administrador foi removido', async () => {
    const setup = await req(admin, 'POST', '/v1/auth/2fa/setup');
    expect(setup.statusCode, setup.body).toBe(200);
    const code = await totp(setup.json().secret);
    expect((await req(admin, 'POST', '/v1/auth/2fa/enable', { code })).statusCode).toBe(200);
    const challenge = await login(PLATFORM_PASSWORD, 'plataforma');
    expect(challenge.json().twoFactor).toBe(true);
    const authenticated = await req('', 'POST', '/v1/auth/login/2fa', { ticket: challenge.json().ticket, code });
    expect(authenticated.statusCode, authenticated.body).toBe(200);
    expect(authenticated.json().platformAdmin).toBe(true);
    const newSession = session(authenticated);
    expect((await req(admin, 'POST', '/v1/auth/logout')).statusCode).toBe(200);
    expect((await req(admin, 'GET', '/v1/platform/companies')).statusCode).toBe(401);
    await getDb().delete(platformAdmins).where(eq(platformAdmins.email, email));
    expect((await req(newSession, 'GET', '/v1/platform/companies')).statusCode).toBe(401);
    expect((await req(newSession, 'GET', '/v1/modules')).statusCode).toBe(401);
    expect((await req(customer, 'GET', '/v1/employees')).statusCode).toBe(200);
  });
});
