import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, companyModules, employees, eq, getDb, subscriptions, withTenant } from '@kianda/db';
import { DEFAULT_PGC_ACCOUNTS, kz } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, password = 'LotesSalariais2026abc';

describe.skipIf(!process.env.DATABASE_URL)('INSS e variáveis salariais em lote', () => {
  let owner = '', other = '', payroll = '', finance = '', hr = '', companyId = '', a = '', b = '', foreign = '', noContract = '', runId = '';
  const batch = (period = '2026-10') => ({ requestId: randomUUID(), period, kind: 'bonus', label: 'Prémio do lote', inInss: true, inIrt: true, rows: [{ employeeId: a, amount: 10000 }, { employeeId: b, amount: 20000 }] });
  const variables = async (period = '2026-10') => (await req(owner, 'GET', `/v1/payroll-variables?period=${period}`)).json();
  beforeAll(async () => {
    for (const suffix of [1, 2]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Lotes ${suffix}`, nif: String(Number(stamp.slice(-10)) + suffix).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${suffix}@payroll-batch.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (suffix === 1) { owner = cookie(r); companyId = r.json().company.id; } else other = cookie(r);
    }
    for (const [role, name] of [['payroll', 'Folha'], ['finance', 'Finanças'], ['hr_admin', 'RH']] as const) {
      const email = `${stamp}.${role}@payroll-batch.test`;
      expect((await req(owner, 'POST', '/v1/users', { name, email, password, role })).statusCode).toBe(201);
      const session = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
      if (role === 'payroll') payroll = session; else if (role === 'finance') finance = session; else hr = session;
    }
    const person = async (session: string, number: string, name: string) => {
      const r = await req(session, 'POST', '/v1/employees', { number, name, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 100000 } });
      expect(r.statusCode).toBe(201); return r.json().id;
    };
    a = await person(owner, '1', 'Amélia Lote'); b = await person(owner, '2', 'Bento Lote'); foreign = await person(other, '1', 'Nome reservado de outra empresa');
    await withTenant(companyId, async () => {
      const [e] = await getDb().insert(employees).values({ companyId, number: '3', name: 'Sem contrato', jobTitle: 'Técnico' }).returning(); noContract = e!.id;
      // A exportação oficial é verificada numa empresa sintética paga, sem efectuar pagamentos reais.
      await getDb().update(subscriptions).set({ status: 'active', paidUntil: '2099-12-31' }).where(eq(subscriptions.companyId, companyId));
      await getDb().update(companyModules).set({ status: 'active', paidUntil: '2099-12-31' }).where(eq(companyModules.companyId, companyId));
    });
  });

  it('grava um lote, calcula a equipa e mantém os 8% fora do líquido, do recibo e da conta de salários', async () => {
    const body = batch('2026-09');
    const created = await req(owner, 'POST', '/v1/payroll-variables/batch', body);
    expect(created.statusCode, created.body).toBe(201); expect(created.json()).toMatchObject({ count: 2, totalMinor: kz(30000), replayed: false });
    expect((await req(owner, 'GET', '/v1/payroll-runs?period=2026-09')).json()).toEqual([]);
    const replay = await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, rows: [...body.rows].reverse() });
    expect(replay.statusCode).toBe(200); expect(replay.json().variableIds).toEqual(created.json().variableIds);
    expect(await variables('2026-09')).toHaveLength(2);
    const discount = await req(owner, 'POST', '/v1/payroll-variables/batch', { ...batch('2026-09'), kind: 'other_deduction', label: 'Desconto acordado', rows: [{ employeeId: b, amount: 5000 }] });
    expect(discount.statusCode).toBe(201);
    const draft = await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-09' });
    expect(draft.statusCode).toBe(201); runId = draft.json().run.id;
    const run = (await req(owner, 'GET', `/v1/payroll-runs/${runId}`)).json();
    expect(run.lines).toHaveLength(2);
    expect(run.lines.find((l: any) => l.employeeId === a)).toMatchObject({ grossMinor: kz(110000), inssEmployeeMinor: kz(3300), inssEmployerMinor: kz(8800), irtMinor: 0, netMinor: kz(106700) });
    const line = run.lines.find((l: any) => l.employeeId === b);
    expect(line).toMatchObject({ grossMinor: kz(120000), inssEmployeeMinor: kz(3600), inssEmployerMinor: kz(9600), irtMinor: 0, netMinor: kz(111400) });
    const slip = (await req(owner, 'GET', `/v1/payslips/${line.id}`)).json();
    expect(slip.lines.filter((l: any) => l.kind === 'deduction').map((l: any) => l.code)).not.toContain('INSS_EMP');
    expect(slip.lines.filter((l: any) => l.kind === 'deduction').reduce((s: number, l: any) => s + l.amountMinor, 0)).toBe(kz(8600));
    expect((await req(owner, 'POST', `/v1/payroll-runs/${runId}/close`)).statusCode).toBe(200);
    const journal = (await req(owner, 'GET', '/v1/journal')).json().find((j: any) => j.reference === 'PS-202609');
    expect(journal.lines.find((l: any) => l.account === DEFAULT_PGC_ACCOUNTS.netPayable).creditMinor).toBe(kz(218100));
    expect(journal.lines.find((l: any) => l.account === DEFAULT_PGC_ACCOUNTS.socialSecurityPayable).creditMinor).toBe(kz(25300));
    expect(journal.lines.filter((l: any) => l.account === DEFAULT_PGC_ACCOUNTS.employerSocialSecurity).reduce((s: number, l: any) => s + l.debitMinor, 0)).toBe(kz(18400));
    expect(journal.lines.reduce((s: number, l: any) => s + l.debitMinor, 0)).toBe(kz(248400));
    const map = await req(owner, 'GET', `/v1/payroll-runs/${runId}/maps/inss`);
    expect(map.statusCode, map.body).toBe(200);
    expect(map.json().rows.find((r: any) => r.name === 'Amélia Lote')).toMatchObject({ employee: kz(3300), employer: kz(8800), total: kz(12100) });
  });

  it('pedidos concorrentes com o mesmo identificador não duplicam lançamentos', async () => {
    const body = batch();
    const before = (await variables()).length;
    const results = await Promise.all([req(payroll, 'POST', '/v1/payroll-variables/batch', body), req(payroll, 'POST', '/v1/payroll-variables/batch', body)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 201]);
    expect((await variables()).length).toBe(before + 2);
    expect(results[0]!.json().variableIds).toEqual(results[1]!.json().variableIds);
  });

  it('o identificador de um lote já gravado não pode ser reutilizado para outros valores', async () => {
    const body = batch();
    expect((await req(owner, 'POST', '/v1/payroll-variables/batch', body)).statusCode).toBe(201);
    const before = await variables();
    expect((await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, label: 'Outro lote' })).statusCode).toBe(409);
    expect(await variables()).toEqual(before);
  });

  it('um colaborador de outra empresa invalida o lote inteiro; o pedido pode ser corrigido após rollback', async () => {
    const body = { ...batch(), rows: [{ employeeId: a, amount: 1000 }, { employeeId: foreign, amount: 2000 }] };
    const before = await variables();
    const invalid = await req(owner, 'POST', '/v1/payroll-variables/batch', body);
    expect(invalid.statusCode).toBe(400); expect(invalid.body).not.toContain('Nome reservado');
    expect(await variables()).toEqual(before);
    expect((await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, rows: [{ employeeId: a, amount: 1000 }, { employeeId: b, amount: 2000 }] })).statusCode).toBe(201);
  });

  it('não grava variáveis para colaboradores sem contrato elegível no mês', async () => {
    const before = await variables();
    const r = await req(owner, 'POST', '/v1/payroll-variables/batch', { ...batch(), rows: [{ employeeId: a, amount: 1000 }, { employeeId: noContract, amount: 1000 }] });
    expect(r.statusCode).toBe(400); expect(r.body).toContain('Sem contrato');
    expect(await variables()).toEqual(before);
  });

  it('valida duplicados, valores, tamanho e formato antes de gravar o lote', async () => {
    const before = await variables();
    const body = batch();
    for (const rows of [[], [{ employeeId: a, amount: -1 }], [{ employeeId: a, amount: 0.001 }], [{ employeeId: a, amount: 1 }, { employeeId: a, amount: 2 }], Array.from({ length: 1001 }, () => ({ employeeId: a, amount: 1 }))]) {
      expect((await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, rows })).statusCode).toBe(400);
    }
    expect((await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, requestId: 'sem-identificador' })).statusCode).toBe(400);
    expect(await variables()).toEqual(before);
  });

  it('aplica os mesmos tipos e incidências do lançamento individual, incluindo cortes na remuneração', async () => {
    for (const kind of ['bonus', 'other_earning', 'advance', 'other_deduction', 'salary_cut']) {
      const body = { period: '2026-11', kind, label: `Teste ${kind}`, inInss: false, inIrt: false, amount: 1000 };
      const single = await req(owner, 'POST', '/v1/payroll-variables', { ...body, employeeId: a });
      const bulk = await req(owner, 'POST', '/v1/payroll-variables/batch', { ...body, requestId: randomUUID(), rows: [{ employeeId: b, amount: 1000 }] });
      expect(single.statusCode).toBe(201); expect(bulk.statusCode, bulk.body).toBe(201);
      const v = (await variables('2026-11')).find((v: any) => v.id === bulk.json().variableIds[0]);
      const pick = (v: any) => ({ kind: v.kind, amountMinor: v.amountMinor, code: v.code, inInss: v.inInss, inIrt: v.inIrt });
      expect(pick(v)).toEqual(pick(single.json()));
    }
  });

  it('preserva meses fechados e exige perfil de processamento', async () => {
    const frozen = (await req(owner, 'GET', `/v1/payroll-runs/${runId}`)).json();
    expect((await req(owner, 'POST', '/v1/payroll-variables/batch', batch('2026-09'))).statusCode).toBe(409);
    expect((await req(owner, 'GET', `/v1/payroll-runs/${runId}`)).json()).toEqual(frozen);
    for (const actor of [finance, hr]) expect((await req(actor, 'POST', '/v1/payroll-variables/batch', batch())).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/payroll-variables/batch', payload: batch() })).statusCode).toBe(401);
    const cross = await req(other, 'POST', '/v1/payroll-variables/batch', batch());
    expect(cross.statusCode).toBe(400);
    expect((await req(other, 'GET', '/v1/payroll-variables?period=2026-10')).json()).toEqual([]);
  });
});
