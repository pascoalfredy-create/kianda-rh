import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('recibo: só o processado, discriminado, com as ocorrências do mês', () => {
  it('férias, falta, subsídio de férias e descontos discriminados; sem rubricas a zero', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Recibo completo', nif }, name: 'Dona', email: `recibo.${Date.now()}@kianda.test`, password: 'ReciboCompleto2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    expect((await call('PATCH', '/v1/company/settings', { holidaySubsidyMonth: 10 })).statusCode).toBe(200);
    const e = await call('POST', '/v1/employees', { number: '1', name: 'Pessoa Recibo', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2025-01-01', base: 300000, meal: 20000, transport: 15000 } });
    expect(e.statusCode, e.body).toBe(201);
    const id = e.json().id;
    expect((await call('POST', '/v1/absences', { employeeId: id, type: 'vacation', startDate: '2026-10-05', endDate: '2026-10-09', approve: true })).statusCode).toBe(201);
    expect((await call('POST', '/v1/absences', { employeeId: id, type: 'unjustified', startDate: '2026-10-20', endDate: '2026-10-20', approve: true })).statusCode).toBe(201);
    for (const label of ['Devolução de equipamento', 'Quota do refeitório']) expect((await call('POST', '/v1/payroll-variables', { employeeId: id, period: '2026-10', kind: 'other_deduction', label, amount: 2000 })).statusCode).toBe(201);
    const run = await call('POST', '/v1/payroll-runs', { period: '2026-10' });
    expect(run.statusCode, run.body).toBe(201);
    const detail = (await call('GET', `/v1/payroll-runs/${run.json().run.id}`)).json();
    const line = detail.lines[0];
    const slip = (await call('GET', `/v1/payslips/${line.id}`)).json();
    const names = slip.lines.map((l: { name: string }) => l.name);
    expect(names).toEqual(expect.arrayContaining(['Devolução de equipamento', 'Quota do refeitório']));
    expect(names).not.toContain('Outros descontos');
    // Regra da empresa (por omissão): alimentação e transporte só nos dias trabalhados — férias e falta cortam.
    expect(names).toContain('Subsídio de alimentação (sem 5 dia(s) de férias) (sem 1 dia(s) de falta)');
    expect(slip.lines.find((l: { name: string }) => l.name.startsWith('Subsídio de alimentação')).amountMinor).toBe(Math.round(2_000_000 - 2_000_000 * 6 / 22));
    expect(names.some((n: string) => n.startsWith('Subsídio de férias'))).toBe(true);
    expect(slip.leave).toEqual([expect.objectContaining({ type: 'vacation', startDate: '2026-10-05', endDate: '2026-10-09', workingDays: 5 }), expect.objectContaining({ type: 'unjustified' })]);
    expect(slip.termination).toBeNull();
    expect(slip.lines.every((l: { amountMinor: number }) => l.amountMinor !== 0)).toBe(true);
  });
});
