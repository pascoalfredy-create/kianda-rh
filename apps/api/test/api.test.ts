import { closeDb, companies, getDb } from '@kianda/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const app = await buildApp();
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe('rotas públicas', () => {
  it('saúde e pacotes publicados', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toMatchObject({ status: 'ok', packs: ['AO-2026'] });
  });
  it('simulador salarial: 420 000 Kz → 392 744 Kz líquidos', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/payroll/simulate', payload: { period: '2026-10', base: 420000, meal: 30000, transport: 25000 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().netMinor).toBe(39_274_400);
  });
  it('ano sem pacote devolve 422 com explicação', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/payroll/simulate', payload: { period: '2027-01', base: 200000 } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toBe('pacote_inexistente');
  });
  it('rotas da empresa exigem identificação da empresa', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/employees' });
    expect(r.statusCode).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('fluxo com base de dados', () => {
  let companyId = '';
  const h = () => ({ 'x-company-id': companyId, 'x-actor-id': 'teste' });
  beforeAll(async () => {
    const [c] = await getDb().insert(companies).values({ name: 'Empresa de Teste', nif: String(Date.now()).slice(-10) }).returning();
    companyId = c!.id;
  });

  it('valida BI e IBAN ao criar colaborador', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/employees', headers: h(), payload: { number: '1', name: 'Ana Teste', jobTitle: 'Técnica', biNumber: '123', iban: 'AO06 0000', contract: { type: 'indefinite', startDate: '2026-01-05', base: 300000 } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['biNumber', 'iban']));
  });

  it('cria colaboradores, processa, fecha e gera lançamento equilibrado', async () => {
    const mk = (number: string, base: number) => app.inject({ method: 'POST', url: '/v1/employees', headers: h(), payload: {
      number, name: `Colaborador ${number}`, jobTitle: 'Técnico', biNumber: '004512398LA041', iban: 'AO06 0040 0000 5521 8890 1015 5',
      contract: { type: 'indefinite', startDate: '2026-01-05', base, meal: 30000, transport: 25000 },
    } });
    expect((await mk('10', 420000)).statusCode).toBe(201);
    expect((await mk('11', 95000)).statusCode).toBe(201);

    const list = (await app.inject({ method: 'GET', url: '/v1/employees', headers: h() })).json();
    expect(list.find((e: { number: string }) => e.number === '11').alerts).toContain('Salário base abaixo do salário mínimo nacional');

    const draft = await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: h(), payload: { period: '2026-10' } });
    expect(draft.statusCode).toBe(201);
    const runId = draft.json().run.id;
    const close = await app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/close`, headers: h() });
    expect(close.statusCode).toBe(200);
    expect(close.json().journalReference).toBe('PS-202610');

    const again = await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: h(), payload: { period: '2026-10' } });
    expect(again.statusCode).toBe(409);

    const journal = (await app.inject({ method: 'GET', url: '/v1/journal', headers: h() })).json();
    const lines = journal[0].lines as { debitMinor: number; creditMinor: number }[];
    expect(lines.reduce((s, l) => s + l.debitMinor, 0)).toBe(lines.reduce((s, l) => s + l.creditMinor, 0));
  });

  it('ausência conta dias úteis sem feriados e recusa sobreposição', async () => {
    const emp = (await app.inject({ method: 'GET', url: '/v1/employees', headers: h() })).json()[0];
    const a = await app.inject({ method: 'POST', url: '/v1/absences', headers: h(), payload: { employeeId: emp.id, type: 'vacation', startDate: '2026-10-26', endDate: '2026-11-06' } });
    expect(a.json().workingDays).toBe(9);
    const b = await app.inject({ method: 'POST', url: '/v1/absences', headers: h(), payload: { employeeId: emp.id, type: 'justified', startDate: '2026-11-02', endDate: '2026-11-03' } });
    expect(b.statusCode).toBe(409);
  });
});
