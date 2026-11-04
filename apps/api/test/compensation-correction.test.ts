import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const password = 'CorrecaoSalarial2026abc';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const snapshot = (c: any) => ({ effectiveDate: c.effectiveDate, reason: c.reason, baseMinor: c.baseMinor, mealMinor: c.mealMinor, transportMinor: c.transportMinor, salaryCurrency: c.salaryCurrency, baseForeignMinor: c.baseForeignMinor });

describe.skipIf(!process.env.DATABASE_URL)('correcção auditada de remuneração', () => {
  let owner = '', other = '', payroll = '';
  let number = 0;
  beforeAll(async () => {
    for (const suffix of [1, 2]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Correcções ${suffix}`, nif: String(Number(stamp.slice(-10)) + suffix).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${suffix}@correction.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (suffix === 1) owner = cookie(r); else other = cookie(r);
    }
    const email = `${stamp}.payroll@correction.test`;
    expect((await req(owner, 'POST', '/v1/users', { name: 'Payroll', email, password, role: 'payroll' })).statusCode).toBe(201);
    payroll = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
  });
  async function person() {
    const r = await req(owner, 'POST', '/v1/employees', { number: String(++number), name: 'Salário sintético', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-11-01', base: 285600000, currency: 'USD', baseUsd: 300000, meal: 0, transport: 0 } });
    expect(r.statusCode, r.body).toBe(201);
    return (await req(owner, 'GET', `/v1/employees/${r.json().id}`)).json();
  }
  const values = (p: any, usd = 3000) => ({ base: usd * 952, currency: 'USD', baseUsd: usd, meal: 0, transport: 0, reason: 'Erro de digitação na admissão', expected: snapshot(p.compensation.current) });
  const path = (p: any) => `/v1/employees/${p.id}/compensation/${p.compensation.current.id}`;

  it('corrige USD 300.000 para 3.000 no registo inicial, sem criar uma redução de 99%', async () => {
    const p = await person();
    const r = await req(owner, 'PATCH', path(p), values(p));
    expect(r.statusCode, r.body).toBe(200);
    const after = (await req(owner, 'GET', `/v1/employees/${p.id}`)).json();
    expect(after.compensation.current).toMatchObject({ id: p.compensation.current.id, effectiveDate: '2026-11-01', reason: 'Admissão', baseMinor: 285600000, baseForeignMinor: 300000 });
    expect(after.compensation.history).toHaveLength(1);
    expect(after.compensation.history[0].changeBps).toBeNull();
    expect(after.contract).toMatchObject({ baseMinor: 285600000, baseForeignMinor: 300000 });
    const events = (await req(owner, 'GET', `/v1/employees/${p.id}/history`)).json().filter((e: any) => e.action === 'correct');
    expect(events).toHaveLength(1);
    expect(events[0].before.baseForeignMinor).toBe(30000000);
    expect(events[0].after).toMatchObject({ baseForeignMinor: 300000, correctionReason: 'Erro de digitação na admissão' });
  });

  it('nova alteração futura mantém a data e corrigir essa linha não altera a admissão', async () => {
    const p = await person();
    const future = await req(owner, 'POST', `/v1/employees/${p.id}/compensation`, { effectiveDate: '2026-12-01', base: 3141600, currency: 'USD', baseUsd: 3300, meal: 0, transport: 0, reason: 'Revisão acordada' });
    expect(future.statusCode).toBe(201);
    const r = await req(owner, 'PATCH', `/v1/employees/${p.id}/compensation/${future.json().id}`, { ...values(p, 3400), expected: snapshot(future.json()) });
    expect(r.statusCode, r.body).toBe(200);
    const after = (await req(owner, 'GET', `/v1/employees/${p.id}`)).json();
    expect(after.compensation.current.baseForeignMinor).toBe(30000000);
    expect(after.compensation.upcoming[0]).toMatchObject({ effectiveDate: '2026-12-01', baseForeignMinor: 340000 });
    expect(after.contract.baseForeignMinor).toBe(30000000);
  });

  it('recusa sobreposição de correcções e conserva só a gravação vencedora na auditoria', async () => {
    const p = await person();
    const results = await Promise.all([req(owner, 'PATCH', path(p), values(p, 3100)), req(owner, 'PATCH', path(p), values(p, 3200))]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const audit = (await req(owner, 'GET', `/v1/employees/${p.id}/history`)).json().filter((e: any) => e.action === 'correct');
    expect(audit).toHaveLength(1);
  });

  it('exige justificação e valores esperados; não permite deslocar a data pela correcção', async () => {
    const p = await person();
    expect((await req(owner, 'PATCH', path(p), { ...values(p), reason: '' })).statusCode).toBe(400);
    expect((await req(owner, 'PATCH', path(p), { ...values(p), expected: undefined })).statusCode).toBe(400);
    expect((await req(owner, 'PATCH', path(p), { ...values(p), effectiveDate: '2026-12-01' })).statusCode).toBe(400);
    expect((await req(owner, 'PATCH', path(p), values(p, 300000))).statusCode).toBe(400);
  });

  it('isola empresa e colaborador e exige perfil de RH', async () => {
    const p = await person(), another = await person();
    expect((await req(other, 'PATCH', path(p), values(p))).statusCode).toBe(404);
    expect((await req(owner, 'PATCH', `/v1/employees/${another.id}/compensation/${p.compensation.current.id}`, values(p))).statusCode).toBe(404);
    expect((await req(payroll, 'PATCH', path(p), values(p))).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: path(p), payload: values(p) })).statusCode).toBe(401);
  });

  it('indica os rascunhos a recalcular e preserva remuneração e recibos de meses fechados', async () => {
    const p = await person();
    const draft = await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-11', fx: { rate: 952, date: '2026-11-04' } });
    expect(draft.statusCode, draft.body).toBe(201);
    const correction = await req(owner, 'PATCH', path(p), values(p));
    expect(correction.statusCode).toBe(200); expect(correction.json().draftPeriods).toEqual(['2026-11']);
    expect((await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-11' })).statusCode).toBe(201);
    const runId = draft.json().run.id;
    expect((await req(owner, 'POST', `/v1/payroll-runs/${runId}/close`)).statusCode).toBe(200);
    const frozen = (await req(owner, 'GET', `/v1/payroll-runs/${runId}`)).json();
    const latest = (await req(owner, 'GET', `/v1/employees/${p.id}`)).json();
    const denied = await req(owner, 'PATCH', path(latest), values(latest, 3200));
    expect(denied.statusCode).toBe(409); expect(denied.json().error).toBe('periodo_fechado');
    expect((await req(owner, 'GET', `/v1/payroll-runs/${runId}`)).json()).toEqual(frozen);
    expect((await req(owner, 'GET', `/v1/employees/${p.id}`)).json().compensation.current.baseForeignMinor).toBe(300000);
  });
});
