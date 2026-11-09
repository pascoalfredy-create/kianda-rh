import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('férias segundo a LGT', () => {
  it('doença durante as férias devolve os dias ao saldo (art. 210.º); termo até 1 ano: 2 dias/mês (art. 205.º)', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Férias LGT', nif }, name: 'Dona', email: `ferias.${Date.now()}@kianda.test`, password: 'FeriasLgt2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const a = await call('POST', '/v1/employees', { number: '1', name: 'Sem Termo', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2024-01-01', base: 300000 } });
    const b = await call('POST', '/v1/employees', { number: '2', name: 'A Termo', jobTitle: 'Técnico', contract: { type: 'fixed_term', startDate: '2026-06-01', endDate: '2027-05-31', base: 300000, termJustification: 'Acréscimo temporário de actividade' } });
    expect(a.statusCode, a.body).toBe(201); expect(b.statusCode, b.body).toBe(201);
    expect((await call('POST', '/v1/absences', { employeeId: a.json().id, type: 'vacation', startDate: '2026-03-02', endDate: '2026-03-13', approve: true })).statusCode).toBe(201);
    const sick = await call('POST', '/v1/absences', { employeeId: a.json().id, type: 'sick', startDate: '2026-03-09', endDate: '2026-03-11', approve: true });
    expect(sick.statusCode, sick.body).toBe(201);
    expect((await call('POST', '/v1/absences', { employeeId: a.json().id, type: 'justified', startDate: '2026-03-10', endDate: '2026-03-10', approve: true })).statusCode).toBe(409);
    const balances = (await call('GET', '/v1/leave/balances?year=2026')).json();
    const byName = (n: string) => balances.find((x: { employee: { name: string } }) => x.employee.name === n);
    expect(byName('Sem Termo')).toMatchObject({ entitlement: 22, taken: 7 });
    expect(byName('A Termo')).toMatchObject({ entitlement: 14 });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('licença sem remuneração', () => {
  it('desconta na folha e, acima de 30 dias, reduz as férias do ano', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Licença', nif }, name: 'Dona', email: `licenca.${Date.now()}@kianda.test`, password: 'LicencaSemRem2026seguro' } });
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const id = (await call('POST', '/v1/employees', { number: '1', name: 'Em Licença', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2024-01-01', base: 300000, meal: 22000 } })).json().id;
    const l = await call('POST', '/v1/absences', { employeeId: id, type: 'unpaid_leave', startDate: '2026-03-01', endDate: '2026-04-30', reason: 'Assuntos pessoais', approve: true });
    expect(l.statusCode, l.body).toBe(201);
    const bal = (await call('GET', '/v1/leave/balances?year=2026')).json().find((x: { employee: { name: string } }) => x.employee.name === 'Em Licença');
    expect(bal.entitlement).toBe(20);
    const run = await call('POST', '/v1/payroll-runs', { period: '2026-03' });
    const line = (await call('GET', `/v1/payroll-runs/${run.json().run.id}`)).json().lines[0];
    // Mês inteiro de licença: nada a pagar (vencimento e subsídios proporcionais aos dias pagos = 0).
    expect(line.grossMinor).toBe(0);
    const apr = await call('POST', '/v1/payroll-runs', { period: '2026-05' });
    expect((await call('GET', `/v1/payroll-runs/${apr.json().run.id}`)).json().lines[0].grossMinor).toBe(32_200_000);
  });
});
