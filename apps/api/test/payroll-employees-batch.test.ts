import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, compensationChanges, contracts, eq, getDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`, password = 'SalariosEmLote2026abc';
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('processamento salarial por selecção do mês', () => {
  let owner = '', other = '', payroll = '', finance = '', a = '', b = '', c = '', foreign = '', future = '', noContract = '';
  const batch = (period: string, employeeIds: string[]) => req(owner, 'POST', '/v1/payroll-runs/batch', { period, employeeIds });
  const sheet = async (period: string) => (await req(owner, 'GET', `/v1/payroll-runs/opening?period=${period}&batch=1`)).json();
  beforeAll(async () => {
    for (const n of [1, 2]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Salários em lote ${n}`, nif: String(Number(stamp.slice(-10)) + n).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${n}@payroll-selection.test`, password, modules: ['hr'] } });
      expect(r.statusCode, r.body).toBe(201); if (n === 1) owner = cookie(r); else other = cookie(r);
    }
    const person = async (actor: string, number: string, name: string, startDate = '2026-01-01') => {
      const r = await req(actor, 'POST', '/v1/employees', { number, name, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate, base: 100000 } });
      expect(r.statusCode, r.body).toBe(201); return r.json().id as string;
    };
    a = await person(owner, '1', 'Amélia Salário'); b = await person(owner, '2', 'Bento Salário'); c = await person(owner, '3', 'Carlos Salário');
    foreign = await person(other, '1', 'Nome reservado de outra empresa'); future = await person(owner, '4', 'Contrato futuro', '2026-12-01');
    noContract = await person(owner, '5', 'Sem contrato elegível');
    await getDb().delete(compensationChanges).where(eq(compensationChanges.employeeId, noContract));
    await getDb().delete(contracts).where(eq(contracts.employeeId, noContract));
    for (const role of ['payroll', 'finance']) {
      const email = `${stamp}.${role}@payroll-selection.test`;
      expect((await req(owner, 'POST', '/v1/users', { name: role, email, password, role })).statusCode).toBe(201);
      const session = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
      if (role === 'payroll') payroll = session; else finance = session;
    }
  });

  it('a preparação mostra salários dos elegíveis e o primeiro lote calcula apenas os seleccionados', async () => {
    const roster = await sheet('2026-10');
    expect(roster.payrollPeople.map((p: any) => p.id)).toEqual([a, b, c]);
    expect(roster.payrollPeople[0]).toMatchObject({ baseMinor: 10000000, salaryCurrency: 'AOA' });
    const first = await batch('2026-10', [a, b]);
    expect(first.statusCode, first.body).toBe(201); expect(first.json()).toMatchObject({ lines: 2, totalLines: 2 });
    const before = (await sheet('2026-10')).run;
    expect(before.lines).toHaveLength(2); expect(before.lines.map((l: any) => l.employeeId).sort()).toEqual([a, b].sort());
    for (const line of before.lines) expect(line).toMatchObject({ grossMinor: 10000000, inssEmployeeMinor: 300000, inssEmployerMinor: 800000, netMinor: 9700000 });
    expect((await req(owner, 'POST', `/v1/payroll-runs/${before.id}/close`)).json().error).toBe('processamento_incompleto');
    expect((await batch('2026-10', [c])).json()).toMatchObject({ lines: 1, totalLines: 3 });
    const complete = (await sheet('2026-10')).run;
    for (const old of before.lines) expect(complete.lines.find((l: any) => l.employeeId === old.employeeId)).toEqual(old);
    expect((await req(owner, 'POST', `/v1/payroll-runs/${before.id}/close`)).statusCode).toBe(200);
    expect((await batch('2026-10', [a])).json().error).toBe('processamento_fechado');
  });

  it('dois primeiros lotes concorrentes juntam-se numa só folha sem duplicar recibos', async () => {
    const replies = await Promise.all([batch('2026-09', [a]), batch('2026-09', [b])]);
    expect(replies.map(r => r.statusCode)).toEqual([201, 201]);
    expect((await req(owner, 'GET', '/v1/payroll-runs?period=2026-09')).json()).toHaveLength(1);
    const before = (await sheet('2026-09')).run;
    expect(before.lines).toHaveLength(2);
    expect((await batch('2026-09', [a])).statusCode).toBe(201);
    const repeated = (await sheet('2026-09')).run;
    expect(repeated.lines).toEqual(before.lines);
  });

  it('recalcular um seleccionado preserva os outros; Recalcular geral actualiza a equipa inteira', async () => {
    expect((await batch('2026-08', [a, b])).statusCode).toBe(201);
    const before = (await sheet('2026-08')).run;
    await getDb().update(compensationChanges).set({ baseMinor: 20000000 }).where(eq(compensationChanges.employeeId, a));
    expect((await batch('2026-08', [a])).statusCode).toBe(201);
    const updated = (await sheet('2026-08')).run;
    const oldA = before.lines.find((l: any) => l.employeeId === a), newA = updated.lines.find((l: any) => l.employeeId === a);
    expect(newA.id).toBe(oldA.id); expect(newA.grossMinor).toBe(20000000); expect(newA.calculationHash).not.toBe(oldA.calculationHash);
    expect(updated.lines.find((l: any) => l.employeeId === b)).toEqual(before.lines.find((l: any) => l.employeeId === b));
    expect((await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-08' })).json()).toMatchObject({ lines: 3, totalLines: 3 });
    expect((await sheet('2026-08')).run.lines.find((l: any) => l.employeeId === a).id).toBe(oldA.id);
  });

  it('pessoas fora da empresa ou do mês invalidam todo o lote', async () => {
    for (const ids of [[a, foreign], [a, future], [a, noContract], [a, 'inexistente']]) {
      const r = await batch('2026-07', ids); expect(r.statusCode, r.body).toBe(400); expect(r.body).not.toContain('Nome reservado');
      expect((await sheet('2026-07')).run).toBeNull();
    }
    for (const ids of [[], [a, a], Array.from({ length: 1001 }, (_, i) => `pessoa-${i}`)]) expect((await batch('2026-07', ids)).statusCode).toBe(400);
  });

  it('um salário inválido desfaz o lote inteiro', async () => {
    expect((await req(owner, 'POST', '/v1/payroll-variables', { employeeId: b, period: '2026-06', kind: 'other_deduction', label: 'Desconto sintético excessivo', amount: 1000000 })).statusCode).toBe(201);
    expect((await batch('2026-06', [a, b])).statusCode).toBe(422);
    expect((await sheet('2026-06')).run).toBeNull();
  });

  it('só proprietário e processamento salarial podem calcular lotes', async () => {
    expect((await req(finance, 'POST', '/v1/payroll-runs/batch', { period: '2026-05', employeeIds: [a] })).statusCode).toBe(403);
    expect((await req(payroll, 'POST', '/v1/payroll-runs/batch', { period: '2026-05', employeeIds: [a] })).statusCode).toBe(201);
    const data = (await req(other, 'GET', '/v1/payroll-runs/opening?period=2026-05&batch=1')).json();
    expect(data.run).toBeNull(); expect(data.payrollPeople.map((p: any) => p.id)).toEqual([foreign]);
  });

  it('não mistura câmbios entre lotes e aceita recalcular a folha inteira com novo câmbio', async () => {
    const u = await req(owner, 'POST', '/v1/employees', { number: '6', name: 'Dólar Sintético', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 900000, currency: 'USD', baseUsd: 1000 } });
    expect(u.statusCode, u.body).toBe(201);
    const usd = u.json().id;
    const first = await req(owner, 'POST', '/v1/payroll-runs/batch', { period: '2026-04', employeeIds: [usd], fx: { rate: 900, date: '2026-04-28' } });
    expect(first.statusCode, first.body).toBe(201);
    const before = (await sheet('2026-04')).run.lines;
    const moved = await req(owner, 'POST', '/v1/payroll-runs/batch', { period: '2026-04', employeeIds: [a], fx: { rate: 920, date: '2026-04-29' } });
    expect(moved.statusCode, moved.body).toBe(409); expect(moved.json().error).toBe('lote_requer_recalculo_total');
    expect((await sheet('2026-04')).run.lines).toEqual(before);
    expect((await batch('2026-04', [a])).statusCode).toBe(201);
    const full = await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-04', fx: { rate: 920, date: '2026-04-29' } });
    expect(full.statusCode, full.body).toBe(201);
    expect((await sheet('2026-04')).run.lines.find((l: any) => l.employeeId === usd).grossMinor).toBe(92000000);
  });
});
