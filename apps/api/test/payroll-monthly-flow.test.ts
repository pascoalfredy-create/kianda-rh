import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, and, closeDb, eq, getDb, payrollVariables } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';
const app = testClient(buildApp({ rateLimit: false }));
const cookie = (r: InjectResponse) => 'kianda_session=' + r.cookies.find(c => c.name === 'kianda_session')!.value;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = String(Date.now()) + Math.floor(Math.random() * 10000), password = 'FluxoMensal2026seguro';
const snapshot = (v: any) => ({ kind: v.kind, label: v.label, amountMinor: v.amountMinor, code: v.code ?? null, inInss: v.inInss, inIrt: v.inIrt, note: v.note ?? null });
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('processamento habitual e alterações opcionais', () => {
  let owner = '', other = '', payroll = '', finance = '', companyId = '', a = '', b = '', variable: any, runId = '';
  const opening = async (period: string) => (await req(owner, 'GET', '/v1/payroll-runs/opening?period=' + period + '&batch=1')).json();
  const edit = (amount: number, expected = snapshot(variable), actor = payroll) => req(actor, 'PATCH', '/v1/payroll-variables/' + variable.id, { kind: 'bonus', label: 'Prémio pontual', amount, inInss: true, inIrt: true, note: null, expected });
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Fluxo mensal ' + i, nif: String(Number(stamp.slice(-10)) + i).padStart(10, '0') }, name: 'Responsável', email: stamp + '.' + i + '@monthly-flow.test', password, modules: ['hr'] } });
      expect(r.statusCode, r.body).toBe(201); if (i === 0) { owner = cookie(r); companyId = r.json().company.id; } else other = cookie(r);
    }
    for (const role of ['payroll', 'finance']) {
      const email = stamp + '.' + role + '@monthly-flow.test';
      expect((await req(owner, 'POST', '/v1/users', { name: role, role, email, password })).statusCode).toBe(201);
      const session = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
      if (role === 'payroll') payroll = session; else finance = session;
    }
    for (let i = 0; i < 2; i++) {
      const r = await req(owner, 'POST', '/v1/employees', { number: String(i + 1), name: 'Pessoa Mensal ' + i, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 100000, meal: 10000, transport: 5000 } });
      expect(r.statusCode, r.body).toBe(201); if (!i) a = r.json().id; else b = r.json().id;
    }
  });
  it('calcula meses sucessivos sem variáveis e respeita a data de efeito de uma alteração permanente', async () => {
    expect((await req(owner, 'POST', '/v1/employees/' + b + '/compensation', { effectiveDate: '2026-10-01', reason: 'Revisão permanente', base: 120000, meal: 10000, transport: 5000 })).statusCode).toBe(201);
    for (const period of ['2026-09', '2026-10']) expect((await req(payroll, 'POST', '/v1/payroll-runs/batch', { period, employeeIds: [a, b] })).statusCode).toBe(201);
    const sep = await opening('2026-09'), oct = await opening('2026-10'); runId = oct.run.id;
    expect(sep.variables).toEqual([]); expect(oct.variables).toEqual([]);
    expect(sep.payrollPeople.find((p: any) => p.id === b).baseMinor).toBe(10000000);
    expect(oct.payrollPeople.find((p: any) => p.id === b)).toMatchObject({ baseMinor: 12000000, mealMinor: 1000000, transportMinor: 500000 });
    const earlier = sep.run.lines.find((l: any) => l.employeeId === a), later = oct.run.lines.find((l: any) => l.employeeId === a);
    expect(later.grossMinor).toBe(earlier.grossMinor); expect(later.netMinor).toBe(earlier.netMinor);
  });
  it('edita com auditoria e só o recálculo aplica a alteração; o mês seguinte não repete o prémio', async () => {
    const created = await req(owner, 'POST', '/v1/payroll-variables', { employeeId: a, period: '2026-10', kind: 'bonus', label: 'Prémio pontual', amount: 10000 });
    expect(created.statusCode).toBe(201); variable = created.json();
    const before = (await opening('2026-10')).run.lines;
    const changed = await edit(2000); expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ id: variable.id, amountMinor: 200000, createdBy: variable.createdBy });
    expect((await opening('2026-10')).run.lines).toEqual(before);
    expect((await req(payroll, 'POST', '/v1/payroll-runs', { period: '2026-10' })).statusCode).toBe(201);
    const after = (await opening('2026-10')).run.lines;
    expect(after.find((l: any) => l.employeeId === a).grossMinor).toBe(before.find((l: any) => l.employeeId === a).grossMinor + 200000);
    expect(after.find((l: any) => l.employeeId === b).grossMinor).toBe(before.find((l: any) => l.employeeId === b).grossMinor);
    const next = await opening('2026-11'); expect(next.variables).toEqual([]);
    expect(next.payrollPeople.find((p: any) => p.id === a)).toMatchObject({ baseMinor: 10000000, mealMinor: 1000000, transportMinor: 500000 });
    const audit = await getDb().select().from(auditLogs).where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.entityId, variable.id), eq(auditLogs.action, 'update')));
    expect(audit).toHaveLength(1); variable = changed.json();
  });
  it('recusa sobreposição de edições, dados inválidos, outra empresa e perfis sem processamento', async () => {
    const stale = snapshot(variable), replies = await Promise.all([edit(3000, stale), edit(4000, stale)]);
    expect(replies.map(r => r.statusCode).sort()).toEqual([200, 409]); variable = replies.find(r => r.statusCode === 200)!.json();
    expect((await edit(5000, snapshot(variable), other)).statusCode).toBe(404);
    expect((await edit(5000, snapshot(variable), finance)).statusCode).toBe(403);
    expect((await edit(-1)).statusCode).toBe(400);
    expect((await req(payroll, 'PATCH', '/v1/payroll-variables/' + variable.id, { employeeId: b, period: '2026-11', kind: 'bonus', label: 'Outro mês', amount: 5000, expected: snapshot(variable) })).statusCode).toBe(400);
  });
  it('protege prestações geridas na origem e meses fechados', async () => {
    const result = await req(owner, 'POST', '/v1/payroll-variables', { employeeId: b, period: '2026-11', kind: 'advance', label: 'Prestação sintética', amount: 1000 }), managed = result.json();
    await getDb().update(payrollVariables).set({ advanceId: 'adiantamento-sintetico' }).where(eq(payrollVariables.id, managed.id));
    const attempt = await req(owner, 'PATCH', '/v1/payroll-variables/' + managed.id, { kind: 'advance', label: managed.label, amount: 2000, expected: snapshot(managed) });
    expect(attempt.json().error).toBe('gerida_pelo_adiantamento');
    expect((await req(owner, 'POST', '/v1/payroll-runs', { period: '2026-10' })).statusCode).toBe(201);
    expect((await req(owner, 'POST', '/v1/payroll-runs/' + runId + '/close')).statusCode).toBe(200);
    const frozen = (await opening('2026-10')).run;
    expect((await edit(5000)).json().error).toBe('processamento_fechado');
    expect((await req(owner, 'DELETE', '/v1/payroll-variables/' + variable.id)).statusCode).toBe(409);
    expect((await req(owner, 'POST', '/v1/payroll-variables', { employeeId: a, period: '2026-10', kind: 'bonus', label: 'Tarde', amount: 1000 })).statusCode).toBe(409);
    expect((await opening('2026-10')).run).toEqual(frozen);
  });
});
