import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('apagar processamento em rascunho', () => {
  it('apaga o rascunho e as linhas, mantém as variáveis e permite recomeçar', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Rascunho apagado', nif }, name: 'Dona', email: `rascunho.${Date.now()}@kianda.test`, password: 'RascunhoApagado2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const e = await call('POST', '/v1/employees', { number: '1', name: 'Pessoa', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 } });
    expect(e.statusCode, e.body).toBe(201);
    expect((await call('POST', '/v1/payroll-variables', { employeeId: e.json().id, period: '2026-10', kind: 'bonus', label: 'Prémio', amount: 10000 })).statusCode).toBe(201);
    const run = await call('POST', '/v1/payroll-runs', { period: '2026-10' });
    expect(run.statusCode, run.body).toBe(201);
    const del = await call('DELETE', `/v1/payroll-runs/${run.json().run.id}`);
    expect(del.statusCode, del.body).toBe(200);
    expect((await call('GET', '/v1/payroll-runs?period=2026-10')).json()).toEqual([]);
    expect((await call('GET', '/v1/payroll-variables?period=2026-10')).json()).toHaveLength(1);
    expect((await call('DELETE', `/v1/payroll-runs/${run.json().run.id}`)).statusCode).toBe(404);
    expect((await call('POST', '/v1/payroll-runs', { period: '2026-10' })).statusCode).toBe(201);
  });
});
