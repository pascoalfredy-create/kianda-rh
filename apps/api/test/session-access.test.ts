import { afterAll, describe, expect, it } from 'vitest';
import { and, auditLogs, closeDb, eq, getDb, users } from '@kianda/db';
import { REGISTRATION_TERMS_VERSION } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const registration = () => ({ company: { name: 'Auditoria de acessos', nif: String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0') }, name: 'Dona da empresa', email: `auditoria.${Date.now()}@kianda.test`, password: 'AuditoriaSegura2026' });

it('o servidor exige aceitação explícita dos termos no registo', async () => {
  for (const acceptTerms of [undefined, false]) {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...registration(), acceptTerms } });
    expect(r.statusCode).toBe(400);
  }
});

describe.skipIf(!process.env.DATABASE_URL)('retirada de acessos em sessões já emitidas', () => {
  it('termina apenas a sessão que fez logout, mesmo com dois logins consecutivos', async () => {
    const reg = registration();
    const registered = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...reg, acceptTerms: true } });
    expect(registered.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: reg.email, password: reg.password } });
    const first = { cookie: `kianda_session=${registered.cookies.find(c => c.name === 'kianda_session')!.value}` };
    const second = { cookie: `kianda_session=${login.cookies.find(c => c.name === 'kianda_session')!.value}` };
    expect(first.cookie).not.toBe(second.cookie);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: first })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: first })).json().error).toBe('sessao_terminada');
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: second })).statusCode).toBe(200);
  });
  it('mudar a palavra-passe e «terminar sessões» revogam os tokens antigos e mantêm a sessão actual', async () => {
    const reg = registration();
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...reg, acceptTerms: true } });
    expect(r.statusCode).toBe(201);
    const first = { cookie: `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}` };
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: reg.email, password: reg.password } });
    const second = { cookie: `kianda_session=${login.cookies.find(c => c.name === 'kianda_session')!.value}` };
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: second })).statusCode).toBe(200);
    const ended = await app.inject({ method: 'POST', url: '/v1/auth/sessions/end-others', headers: first });
    expect(ended.statusCode).toBe(200);
    const renewed = { cookie: `kianda_session=${ended.cookies.find(c => c.name === 'kianda_session')!.value}` };
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: second })).json().error).toBe('sessao_terminada');
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: first })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: renewed })).statusCode).toBe(200);
    const changed = await app.inject({ method: 'POST', url: '/v1/auth/password', headers: renewed, payload: { current: reg.password, next: reg.password + 'Novo9' } });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: renewed })).statusCode).toBe(401);
    const after = { cookie: `kianda_session=${changed.cookies.find(c => c.name === 'kianda_session')!.value}` };
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: after })).statusCode).toBe(200);
  });
  it('o cookie de sessão é Secure quando o pedido chega por HTTPS', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { 'x-forwarded-proto': 'https' }, payload: { ...registration(), acceptTerms: true } });
    expect(r.statusCode).toBe(201);
    expect(r.headers['set-cookie']).toMatch(/kianda_session=[^;]+;.*Secure/);
  });
  it('uma conta desactivada perde imediatamente o acesso da sessão antiga', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...registration(), acceptTerms: true } });
    expect(r.statusCode).toBe(201);
    const owner = r.cookies.find(c => c.name === 'kianda_session')!.value;
    const headers = { cookie: `kianda_session=${owner}` };
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers })).statusCode).toBe(200);
    await getDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, r.json().user.id));
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers })).statusCode).toBe(401);
  });
  it('alterar o perfil actualiza permissões e metadados, sem exigir novo login', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...registration(), acceptTerms: true } });
    expect(r.statusCode).toBe(201);
    const headers = { cookie: `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}` };
    const id = r.json().user.id;
    const [event] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, r.json().company.id), eq(auditLogs.action, 'register')));
    expect(event!.after).toMatchObject({ terms: { accepted: true, version: REGISTRATION_TERMS_VERSION } });
    await getDb().update(users).set({ role: 'employee' }).where(eq(users.id, id));
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers });
    expect(me.json().user.role).toBe('employee');
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/users', headers, payload: {} })).statusCode).toBe(403);
  });
});
