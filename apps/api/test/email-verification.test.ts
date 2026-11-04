import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, closeDb, companyModules, emailVerifications, eq, getDb, subscriptions, users } from '@kianda/db';
import { luandaDate, trialEndDate } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

// Esta bateria usa o percurso real; não confirma proprietários pela preparação dos testes de negócio.
const app = testClient(buildApp({ rateLimit: false }), { confirmEmails: false });
const messages: { text: string; subject: string }[] = [];
let sequence = 0;
const register = async () => {
  const unique = `${Date.now()}${sequence++}`;
  return app.inject({ method: 'POST', url: '/v1/auth/register', payload: {
    company: { name: 'Empresa de confirmação', nif: unique.slice(-10), sector: 'services' }, name: 'Responsável', email: `${unique}@confirmacao.test`,
    password: 'ConfirmacaoSegura2026', acceptTerms: true, modules: ['hr', 'modeling', 'valuation'],
  } });
};
const headers = (r: Awaited<ReturnType<typeof register>>) => ({ cookie: `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}` });
const tokenFromMail = () => {
  const text = messages.findLast(m => m.subject === 'Confirme o seu email — Kianda')!.text;
  return new URL(text.match(/https:\/\/kianda\.test\/confirmar-email\?token=\S+/)![0]).searchParams.get('token')!;
};
const confirm = (token: string) => app.inject({ method: 'POST', url: '/v1/public/email-verification', payload: { token } });

afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => {
  messages.length = 0;
  vi.stubEnv('RESEND_API_KEY', 'chave-sintetica'); vi.stubEnv('MAIL_FROM', 'Kianda <nao-responder@kianda.test>'); vi.stubEnv('APP_BASE_URL', 'https://kianda.test');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { messages.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: 'email-sintetico' }), { status: 200 }); }));
});

describe.skipIf(!process.env.DATABASE_URL)('confirmação do email e início do mês experimental', () => {
  it('cria a conta sem planos ou pagamento e bloqueia os módulos até confirmar', async () => {
    const r = await register(); expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ requiresEmailVerification: true, verification: { sent: true } });
    const token = tokenFromMail();
    expect(JSON.stringify(r.json().verification)).not.toContain(token);
    const [link] = await getDb().select().from(emailVerifications).where(eq(emailVerifications.userId, r.json().user.id));
    expect(link!.tokenHash).toMatch(/^[0-9a-f]{64}$/); expect(link!.tokenHash).not.toBe(token); expect(link!.usedAt).toBeNull();
    const h = headers(r);
    for (const url of ['/v1/employees', '/v1/modeling/bootstrap', '/v1/valuation/bootstrap', '/v1/billing']) {
      const denied = await app.inject({ method: 'GET', url, headers: h }); expect(denied.statusCode, url).toBe(403); expect(denied.json().error).toBe('email_por_confirmar');
    }
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: h })).json().user.requiresEmailVerification).toBe(true);
  });
  it('só o POST explícito confirma e inicia trinta dias nos três módulos; a ligação não pode ser repetida', async () => {
    const r = await register(), token = tokenFromMail();
    await getDb().update(subscriptions).set({ trialEndsAt: '2026-01-01' }).where(eq(subscriptions.companyId, r.json().company.id));
    await getDb().update(companyModules).set({ trialEndsAt: '2026-01-01' }).where(eq(companyModules.companyId, r.json().company.id));
    expect((await app.inject({ method: 'GET', url: `/v1/public/email-verification?token=${token}` })).statusCode).toBe(404);
    expect((await getDb().select().from(users).where(eq(users.id, r.json().user.id)))[0]!.emailVerifiedAt).toBeNull();
    expect((await confirm(token)).statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: headers(r) });
    expect(me.json().user.requiresEmailVerification).toBe(false);
    for (const module of ['hr', 'modeling', 'valuation']) expect(me.json().modules[module].trialEndsAt).toBe(trialEndDate(luandaDate(new Date())));
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: headers(r) })).statusCode).toBe(200);
    expect((await confirm(token)).statusCode).toBe(410);
  });
  it('recusa tokens inventados, expirados e de um endereço entretanto alterado', async () => {
    expect((await confirm('inventado'.repeat(8))).statusCode).toBe(400);
    const r = await register(), token = tokenFromMail();
    await getDb().update(emailVerifications).set({ expiresAt: new Date(0) }).where(eq(emailVerifications.userId, r.json().user.id));
    expect((await confirm(token)).statusCode).toBe(410);
    await getDb().update(emailVerifications).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(emailVerifications.userId, r.json().user.id));
    await getDb().update(users).set({ email: 'alterado@confirmacao.test' }).where(eq(users.id, r.json().user.id));
    expect((await confirm(token)).statusCode).toBe(400);
  });
  it('limita reenvios por conta, revoga a ligação anterior e mantém o envio fora da resposta', async () => {
    const r = await register(), oldToken = tokenFromMail();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/email-verification/resend', headers: headers(r), payload: {} })).statusCode).toBe(429);
    await getDb().update(emailVerifications).set({ createdAt: new Date(Date.now() - 121_000) }).where(eq(emailVerifications.userId, r.json().user.id));
    const resent = await app.inject({ method: 'POST', url: '/v1/auth/email-verification/resend', headers: headers(r), payload: {} });
    expect(resent.statusCode).toBe(200); expect(resent.json().sent).toBe(true);
    expect((await confirm(oldToken)).statusCode).toBe(410);
    expect((await confirm(tokenFromMail())).statusCode).toBe(200);
  });
  it('trata confirmação concorrente como uso único e não prolonga a experiência numa repetição', async () => {
    const r = await register(), token = tokenFromMail();
    const results = await Promise.all([confirm(token), confirm(token)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 410]);
    const [sub] = await getDb().select().from(subscriptions).where(eq(subscriptions.companyId, r.json().company.id));
    expect(sub!.trialEndsAt).toBe(trialEndDate(luandaDate(new Date())));
  });
  it('sem fornecedor de email não simula entrega nem confirma automaticamente', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const r = await register(); expect(r.statusCode).toBe(201); expect(r.json().verification).toMatchObject({ sent: false, unavailable: true });
    const status = await app.inject({ method: 'GET', url: '/v1/auth/email-verification', headers: headers(r) });
    expect(status.json()).toMatchObject({ required: true, verified: false, deliveryEnabled: false });
    expect((await app.inject({ method: 'POST', url: '/v1/auth/email-verification/resend', headers: headers(r), payload: {} })).statusCode).toBe(503);
    expect(messages).toHaveLength(0);
  });
  it('não retira acesso a utilizadores anteriores que não tinham confirmação obrigatória', async () => {
    const r = await register();
    await getDb().update(users).set({ emailVerificationRequired: false }).where(and(eq(users.id, r.json().user.id), eq(users.companyId, r.json().company.id)));
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: headers(r) })).statusCode).toBe(200);
  });
});
