import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('assinatura electrónica de documentos emitidos', () => {
  it('RH pede, só o próprio colaborador assina com o nome da ficha; fica registado e verificável', async () => {
    const stamp = Date.now(), nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Assinaturas', nif }, name: 'Dona', email: `assina.${stamp}@kianda.test`, password: 'Assinaturas2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const owner = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (cookie: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    await call(owner, 'PATCH', '/v1/company/settings', { address: 'Rua Principal, Luanda' });
    const e = await call(owner, 'POST', '/v1/employees', { number: '1', name: 'Ana Assinante', jobTitle: 'Técnica', biNumber: '001234567LA041', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 } });
    expect(e.statusCode, e.body).toBe(201);
    const doc = await call(owner, 'POST', '/v1/documents', { employeeId: e.json().id, templateKey: 'contrato_indeterminado', inputs: { 'pedido.local_trabalho': 'Luanda' } });
    expect(doc.statusCode, doc.body).toBe(201);
    const id = doc.json().id;
    // Acesso do colaborador ao portal.
    const email = `ana.user.${stamp}@kianda.test`, password = 'AnaAssinante2026seguro';
    expect((await call(owner, 'POST', '/v1/users', { name: 'Ana Assinante', email, password, role: 'employee', employeeId: e.json().id })).statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
    const ana = `kianda_session=${login.cookies.find(c => c.name === 'kianda_session')!.value}`;
    expect((await call(ana, 'POST', `/v1/documents/${id}/sign`, { name: 'Ana Assinante', accept: true })).json().error).toBe('assinatura_nao_pedida');
    expect((await call(owner, 'POST', `/v1/documents/${id}/request-signature`, {})).statusCode).toBe(200);
    expect((await call(ana, 'GET', '/v1/notifications/counts')).json().acks).toBe(1);
    expect((await call(owner, 'POST', `/v1/documents/${id}/sign`, { name: 'Dona', accept: true })).statusCode).toBe(404);
    expect((await call(ana, 'POST', `/v1/documents/${id}/sign`, { name: 'Outra Pessoa', accept: true })).json().error).toBe('nome_diferente');
    const ok = await call(ana, 'POST', `/v1/documents/${id}/sign`, { name: 'ana  assinante', accept: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ signedName: 'Ana Assinante' });
    expect(ok.json().signedHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(ana, 'POST', `/v1/documents/${id}/sign`, { name: 'Ana Assinante', accept: true })).json().error).toBe('ja_assinado');
    expect((await call(ana, 'GET', '/v1/notifications/counts')).json().acks).toBe(0);
    const pub = await app.inject({ method: 'GET', url: `/v1/public/documents/${ok.json().verificationCode}` });
    expect(pub.json()).toMatchObject({ valid: true, signedName: 'Ana Assinante' });
  });
});
