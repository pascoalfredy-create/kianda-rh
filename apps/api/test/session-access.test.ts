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
