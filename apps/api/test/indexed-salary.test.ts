import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Salário indexado ao dólar: contrato em USD, câmbio do dia no processamento, conversão ao cêntimo e recibo. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'Indexado2026seguro!';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

describe.skipIf(!process.env.DATABASE_URL)('salários indexados ao dólar', () => {
  let owner = '', usdId = '', kzId = '';
  const req = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: owner }, ...(payload === undefined ? {} : { payload }) });
  /** Prepara (ou recalcula) e devolve o detalhe do processamento com as linhas. */
  const draft = async (payload: unknown) => { const r = await req('POST', '/v1/payroll-runs', payload); expect(r.statusCode, r.body).toBe(201); return (await req('GET', `/v1/payroll-runs/${r.json().run.id}`)).json(); };
  const employee = (number: string, name: string, contract: Record<string, unknown>) => ({ number, name, gender: 'M', jobTitle: 'Engenheiro', province: 'Luanda', nif: `20000${number.padStart(5, '0')}`, contract: { type: 'indefinite', startDate: '2026-01-05', meal: 30000, transport: 25000, ...contract } });

  beforeAll(async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Indexados', sector: 'services', nif: String(Number(stamp.slice(-9)) * 10 + 7).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}@indexado.test`, password, modules: ['hr'] } });
    expect(r.statusCode).toBe(201); owner = cookieOf(r);
  });

  it('o contrato em USD exige o montante em dólares e guarda a referência em Kz', async () => {
    const bad = await req('POST', '/v1/employees', employee('41', 'Sem Dólares', { base: 900000, currency: 'USD' }));
    expect(bad.statusCode).toBe(400);
    const u = await req('POST', '/v1/employees', employee('41', 'Paulo Indexado', { base: 1_350_000, currency: 'USD', baseUsd: 1500 }));
    expect(u.statusCode).toBe(201); usdId = u.json().id;
    const k = await req('POST', '/v1/employees', employee('42', 'Rita Kwanza', { base: 450_000 }));
    expect(k.statusCode).toBe(201); kzId = k.json().id;
    const p = (await req('GET', `/v1/employees/${usdId}`)).json();
    expect(p.compensation.current).toMatchObject({ salaryCurrency: 'USD', baseForeignMinor: 150_000, baseMinor: 135_000_000 });
  });

  it('o processamento pede o câmbio do dia e converte a base ao cêntimo', async () => {
    expect((await req('GET', '/v1/payroll-runs/opening?period=2026-10')).json().indexedEmployees).toBe(1);
    const missing = await req('POST', '/v1/payroll-runs', { period: '2026-10' });
    expect(missing.statusCode).toBe(422); expect(missing.json()).toMatchObject({ error: 'cambio_em_falta' });
    expect(missing.json().message).toContain('Paulo Indexado');
    expect((await req('POST', '/v1/payroll-runs', { period: '2026-10', fx: { rate: '0', date: '2026-10-30' } })).statusCode).toBe(400);
    const body = await draft({ period: '2026-10', fx: { rate: '912,50', date: '2026-10-30', source: 'BNA — câmbio de referência' } });
    expect(body).toMatchObject({ fxDate: '2026-10-30', fxSource: 'BNA — câmbio de referência' });
    expect(Number(body.fxRate)).toBe(912.5);
    const line = (id: string) => body.lines.find((l: { employeeId: string }) => l.employeeId === id);
    const base = line(usdId).breakdown.find((b: { code: string }) => b.code === 'BASE');
    expect(base.amountMinor).toBe(136_875_000);
    expect(base.name).toMatch(/^Vencimento base \(USD 1.500,00 × 912,50 Kz\)$/);
    expect(line(kzId).breakdown.find((b: { code: string }) => b.code === 'BASE')).toMatchObject({ amountMinor: 45_000_000, name: 'Vencimento base' });
    // Recalcular sem indicar o câmbio usa o gravado; um novo câmbio substitui-o.
    const again = await draft({ period: '2026-10' });
    expect(again.lines.find((l: { employeeId: string }) => l.employeeId === usdId).grossMinor).toBe(line(usdId).grossMinor);
    const moved = await draft({ period: '2026-10', fx: { rate: 920, date: '2026-10-31' } });
    expect(moved.lines.find((l: { employeeId: string }) => l.employeeId === usdId).breakdown.find((b: { code: string }) => b.code === 'BASE').amountMinor).toBe(138_000_000);
  });

  it('alteração salarial em USD e passagem para Kz seguem a data de efeito', async () => {
    expect((await req('POST', `/v1/employees/${usdId}/compensation`, { effectiveDate: '2026-11-01', base: 1_440_000, currency: 'USD', baseUsd: 1600, meal: 30000, transport: 25000, reason: 'Actualização anual' })).statusCode).toBe(201);
    const nov = await draft({ period: '2026-11', fx: { rate: '900', date: '2026-11-28' } });
    expect(nov.lines.find((l: { employeeId: string }) => l.employeeId === usdId).breakdown.find((b: { code: string }) => b.code === 'BASE').amountMinor).toBe(144_000_000);
    expect((await req('POST', `/v1/employees/${usdId}/compensation`, { effectiveDate: '2026-12-01', base: 1_500_000, meal: 30000, transport: 25000, reason: 'Passa a Kz' })).statusCode).toBe(201);
    expect((await req('GET', '/v1/payroll-runs/opening?period=2026-12')).json().indexedEmployees).toBeUndefined();
    const dec = await draft({ period: '2026-12' });
    expect(dec.lines.find((l: { employeeId: string }) => l.employeeId === usdId).breakdown.find((b: { code: string }) => b.code === 'BASE')).toMatchObject({ amountMinor: 150_000_000, name: 'Vencimento base' });
  });
});
