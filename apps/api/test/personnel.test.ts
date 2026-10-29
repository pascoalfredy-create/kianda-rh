import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, sql, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'PessoalSeguro2026abc';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
describe('novos mapas de pessoal exigem sessão', () => {
  for (const path of ['/v1/reports/overview', '/v1/reports/analytics', '/v1/personnel-cash']) it(path, async () => expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401));
});
describe.skipIf(!process.env.DATABASE_URL)('mapas do protótipo com dados, isolamento e licenças reais', () => {
  let owner = '', other = '', finance = '', payroll = '', employee = '', modeling = '', companyId = '', runId = '';
  const base = { period: '2026-10', openingMinor: 100000000, receipts: { '2026-10': 20000000 }, revision: 0 };
  beforeAll(async () => {
    for (const [suffix, modules] of [[1, ['hr']], [2, ['hr']], [3, ['modeling']]] as const) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: `Pessoal ${suffix}`, sector: 'mining', nif: String(Number(stamp.slice(-10)) + suffix).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${suffix}@personnel.test`, password, modules, ...(suffix === 3 ? { modelingPlan: { key: 'pme', cycle: 'monthly', primarySector: 'mineracao', sectors: ['mineracao', 'servicos'] } } : {}) } });
      expect(r.statusCode).toBe(201);
      if (suffix === 1) { owner = cookie(r); companyId = r.json().company.id; } else if (suffix === 2) other = cookie(r); else modeling = cookie(r);
    }
    const e = await req(owner, 'POST', '/v1/employees', { number: '1', name: 'Pessoa sintética', gender: 'F', jobTitle: 'Técnica', province: 'Luanda', nif: '0000000000', contract: { type: 'indefinite', startDate: '2026-10-01', base: 420000, meal: 30000, transport: 25000 } });
    expect(e.statusCode).toBe(201);
    for (const role of ['finance', 'payroll', 'employee']) {
      expect((await req(owner, 'POST', '/v1/users', { name: role, email: `${stamp}.${role}@personnel.test`, password, role, ...(role === 'employee' ? { employeeId: e.json().id } : {}) })).statusCode).toBe(201);
      const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `${stamp}.${role}@personnel.test`, password } });
      if (role === 'finance') finance = cookie(r); else if (role === 'payroll') payroll = cookie(r); else employee = cookie(r);
    }
    const draft = await req(payroll, 'POST', '/v1/payroll-runs', { period: '2026-10' });
    expect(draft.statusCode).toBe(201); runId = draft.json().run.id;
    expect((await req(finance, 'POST', `/v1/payroll-runs/${runId}/close`)).statusCode).toBe(200);
  });
  it('resume o quadro e oferece os indicadores antes de depender do relatório de processamentos', async () => {
    const r = await req(owner, 'GET', '/v1/reports/overview');
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ active: 1, demographics: { women: 1, men: 0, medianBaseMinor: 42000000 } });
    expect((await req(other, 'GET', '/v1/reports/overview')).json().active).toBe(0);
  });
  it('o GET da Tesouraria não cria processamentos e os impostos vencem no mês seguinte', async () => {
    const before = Number((await getDb().execute(sql`select count(*) as n from payroll_runs where company_id = ${companyId}`)).rows[0]!.n);
    const r = await req(finance, 'GET', '/v1/personnel-cash?period=2026-10');
    expect(r.statusCode).toBe(200);
    expect(r.json().months[0]).toMatchObject({ period: '2026-10', salariesMinor: 39274400, inssMinor: 0, irtMinor: 0 });
    expect(r.json().months[1].inssMinor).toBeGreaterThan(0); expect(r.json().months[1].irtMinor).toBeGreaterThan(0);
    expect(r.json().warnings.join(' ')).toContain('2027');
    expect(Number((await getDb().execute(sql`select count(*) as n from payroll_runs where company_id = ${companyId}`)).rows[0]!.n)).toBe(before);
  });
  it('retira pagamentos confirmados sem alterar o processamento fechado', async () => {
    expect((await req(finance, 'POST', `/v1/payroll-runs/${runId}/payments`, { kind: 'salaries', paidOn: '2026-10-29' })).statusCode).toBe(201);
    expect((await req(finance, 'GET', '/v1/personnel-cash?period=2026-10')).json().months[0].salariesMinor).toBe(0);
  });
  it('grava pressupostos separados por empresa e o RLS também impede leituras cruzadas', async () => {
    const save = await req(finance, 'PUT', '/v1/personnel-cash', base);
    expect(save.statusCode).toBe(200); expect(save.json().revision).toBe(1);
    expect((await req(owner, 'GET', '/v1/personnel-cash?period=2026-10')).json().plan).toMatchObject({ openingMinor: base.openingMinor, revision: 1 });
    expect((await req(other, 'GET', '/v1/personnel-cash?period=2026-10')).json().plan).toMatchObject({ openingMinor: 0, revision: 0 });
    const otherId = (await req(other, 'GET', '/v1/auth/me')).json().company.id;
    await withTenant(otherId, async () => expect((await getDb().execute(sql`select id from personnel_cash_plans where company_id = ${companyId}`)).rows).toEqual([]));
  });
  it('recusa sobreposição de gravações e dados fora dos seis meses', async () => {
    const results = await Promise.all([req(finance, 'PUT', '/v1/personnel-cash', { ...base, revision: 1, openingMinor: 1 }), req(finance, 'PUT', '/v1/personnel-cash', { ...base, revision: 1, openingMinor: 2 })]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await req(finance, 'PUT', '/v1/personnel-cash', { ...base, receipts: { '2027-04': 5 } })).statusCode).toBe(400);
    expect((await req(finance, 'PUT', '/v1/personnel-cash', { ...base, receipts: { '2026-10': -5 } })).statusCode).toBe(400);
  });
  it('mantém as permissões: folha consulta, Finanças edita, colaborador e módulo só Integra sem acesso', async () => {
    expect((await req(payroll, 'GET', '/v1/personnel-cash')).statusCode).toBe(200);
    expect((await req(payroll, 'PUT', '/v1/personnel-cash', base)).statusCode).toBe(403);
    for (const path of ['/v1/reports/overview', '/v1/reports/analytics', '/v1/personnel-cash']) {
      expect((await req(employee, 'GET', path)).statusCode).toBe(403);
      expect((await req(modeling, 'GET', path)).statusCode).toBe(403);
    }
  });
  it('a matriz analítica reconcilia com o custo do processamento fechado', async () => {
    const r = await req(finance, 'GET', '/v1/reports/analytics?from=2026-10&to=2026-10');
    expect(r.statusCode).toBe(200); expect(r.json().months).toEqual(['2026-10']);
    expect(r.json().totalMinor).toBe(50860000);
    expect(r.json().centres.reduce((s: number, c: { totalMinor: number }) => s + c.totalMinor, 0)).toBe(r.json().totalMinor);
  });
  it('arredonda a mediana monetária ao cêntimo para não quebrar a apresentação com dois salários', async () => {
    expect((await req(owner, 'POST', '/v1/employees', { number: '2', name: 'Outra pessoa sintética', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-10-01', base: 420000.01 } })).statusCode).toBe(201);
    const overview = await req(owner, 'GET', '/v1/reports/overview');
    expect(overview.statusCode).toBe(200); expect(overview.json().demographics.medianBaseMinor).toBe(42000001);
  });

});
