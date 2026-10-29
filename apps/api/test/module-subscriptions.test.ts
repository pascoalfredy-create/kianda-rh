import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, companyModules, getDb, measureQueries, platformAdmins, sql, withTenant } from '@kianda/db';
import { FINANCIAL_SECTORS } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'Subscricoes2026Seguras';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const request = (cookie: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const registration = (suffix: number, extra: object) => ({ company: { name: `Módulos ${suffix}`, nif: String(Number(stamp.slice(-10)) + suffix).padStart(10, '0'), sector: 'mining' }, name: 'Gestor de Teste', email: `${stamp}.${suffix}@modules.test`, password, ...extra });
const pme = { key: 'pme', cycle: 'monthly', primarySector: 'mineracao', sectors: ['mineracao', 'servicos'] };
const corporate = { key: 'corporate', cycle: 'monthly', primarySector: 'mineracao', sectors: ['mineracao', 'servicos', 'comercio', 'agro'] };

describe('selecção de módulos antes da criação da conta', () => {
  it('exige autenticação no catálogo da conta', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/modules' })).statusCode).toBe(401);
  });
  it('recusa uma conta sem módulos ou sectores que excedem o plano', async () => {
    const send = (extra: object) => app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration(0, extra) });
    expect((await send({ modules: [] })).statusCode).toBe(400);
    expect((await send({ modules: ['modeling'], modelingPlan: { ...pme, sectors: ['mineracao', 'servicos', 'agro'] } })).json().error).toBe('sectores_invalidos');
    expect((await send({ modules: ['modeling'], modelingPlan: { ...pme, key: 'unlimited', sectors: FINANCIAL_SECTORS } })).json().error).toBe('ciclo_indisponivel');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('conta comum, preços e direitos independentes', () => {
  let hr = '', modeling = '', both = '', unlimited = '';
  let hrId = '', modelingId = '', bothId = '', modelingProject = '';
  const model = (sector = 'mineracao') => ({ name: 'Projecto sintético', sector, currency: 'Kz', assumptions: { pessoal: 100 } });
  beforeAll(async () => {
    const rHr = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration(1, { modules: ['hr'], hrPlan: { tierKey: 't1', cycle: 'semiannual' } }) });
    expect(rHr.statusCode).toBe(201); hr = cookieOf(rHr); hrId = rHr.json().company.id;
    const rModeling = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration(2, { modules: ['modeling'], modelingPlan: pme }) });
    expect(rModeling.statusCode).toBe(201); modeling = cookieOf(rModeling); modelingId = rModeling.json().company.id;
    const rBoth = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration(3, { modules: ['hr', 'modeling'], modelingPlan: corporate }) });
    expect(rBoth.statusCode).toBe(201); both = cookieOf(rBoth); bothId = rBoth.json().company.id;
    const rUnlimited = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: registration(4, { modules: ['modeling'], modelingPlan: { key: 'unlimited', cycle: 'annual', primarySector: 'mineracao', sectors: FINANCIAL_SECTORS } }) });
    expect(rUnlimited.statusCode).toBe(201); unlimited = cookieOf(rUnlimited);
    await getDb().insert(platformAdmins).values({ email: `${stamp}.1@modules.test` });
  });
  it('mostra os dois módulos, bloqueando o não escolhido, sem depender da licença do RH', async () => {
    expect((await request(hr, 'GET', '/v1/auth/me')).json().modules).toMatchObject({ hr: { canAccess: true, canWrite: true }, modeling: { subscribed: false, canAccess: false } });
    expect((await request(modeling, 'GET', '/v1/modules')).json()).toMatchObject({ hr: { subscribed: false, canRead: false }, modeling: { canAccess: true, projectLimit: 2, userLimit: 5, sectors: ['mineracao', 'servicos'] } });
    expect((await request(both, 'GET', '/v1/modules')).json()).toMatchObject({ hr: { canAccess: true }, modeling: { canAccess: true, projectLimit: 5, sectors: expect.arrayContaining(corporate.sectors) } });
    expect((await request(modeling, 'GET', '/v1/employees')).statusCode).toBe(403);
    expect((await request(modeling, 'GET', '/v1/company/settings')).statusCode).toBe(200);
    expect((await request(modeling, 'GET', '/v1/access')).json().employees).toEqual([]);
    expect((await request(hr, 'GET', '/v1/modeling/templates')).json().error).toBe('modulo_nao_subscrito');
  });
  it('PME abre apenas os dois sectores contratados; alterar o corpo ou a URL não concede outro', async () => {
    expect((await request(modeling, 'GET', '/v1/modeling/templates')).json().map((t: { sector: string }) => t.sector)).toEqual(['mineracao', 'servicos']);
    expect((await request(modeling, 'GET', '/v1/modeling/templates/petroleo')).json().error).toBe('sector_nao_contratado');
    expect((await request(modeling, 'POST', '/v1/modeling/models', model('petroleo'))).statusCode).toBe(403);
    const created = await request(modeling, 'POST', '/v1/modeling/models', model());
    expect(created.statusCode).toBe(201); modelingProject = created.json().id;
    expect((await request(modeling, 'PUT', `/v1/modeling/models/${modelingProject}`, { ...model('agro'), revision: 1 })).json().error).toBe('sector_nao_contratado');
  });
  it('permite vários projectos no mesmo sector, respeitando a quota total de projectos', async () => {
    expect((await request(modeling, 'POST', '/v1/modeling/models', model())).statusCode).toBe(201);
    expect((await request(modeling, 'POST', '/v1/modeling/models', model('servicos'))).json().error).toBe('limite_projectos');
  });
  it('protege projectos arquivados e relatórios de um sector não contratado, incluindo URL codificada', async () => {
    const row = (await getDb().execute(sql`insert into financial_models(company_id,name,sector,currency,assumptions,created_by,archived_at) values (${modelingId},'Arquivo sintético','petroleo','Kz','{}','test',now()) returning id`)).rows[0] as { id: string };
    for (const suffix of ['', '/history', '/reports/sumario?format=pdf']) expect((await request(modeling, 'GET', `/v1/modeling/models/${row.id}${suffix}`)).json().error).toBe('sector_nao_contratado');
    const encoded = `%${row.id.charCodeAt(0).toString(16)}${row.id.slice(1)}`;
    expect((await request(modeling, 'GET', `/v1/modeling/models/${encoded}`)).statusCode).toBe(403);
    expect((await request(modeling, 'GET', '/v1/modeling/models')).json().map((m: { id: string }) => m.id)).not.toContain(row.id);
    expect((await request(both, 'GET', `/v1/modeling/models/${modelingProject}`)).statusCode).toBe(404);
  });
  it('Corporate tem quatro sectores e Grandes Empresas tem todos os oito', async () => {
    expect((await request(both, 'GET', '/v1/modeling/templates')).json()).toHaveLength(4);
    expect((await request(unlimited, 'GET', '/v1/modeling/templates')).json()).toHaveLength(8);
    expect((await request(unlimited, 'GET', '/v1/modules')).json()).toMatchObject({ hr: { subscribed: false }, modeling: { projectLimit: null, userLimit: 5 } });
  });
  it('abre o Integra num pedido, conservando o âmbito de projectos, sectores, quotas e histórico', async () => {
    expect((await request(hr, 'GET', '/v1/modeling/bootstrap')).statusCode).toBe(403);
    const measured = await measureQueries(() => request(modeling, 'GET', '/v1/modeling/bootstrap'));
    expect(measured.value.statusCode).toBe(200); expect(measured.queries).toBeLessThanOrEqual(12);
    const data = measured.value.json();
    expect(data).toMatchObject({ canWrite: true, permission: 'editor', formats: { pdf: true, xlsx: false, csv: false } });
    expect(data.bootstrap.models).toEqual((await request(modeling, 'GET', '/v1/modeling/models')).json());
    expect(data.bootstrap.templates).toEqual((await request(modeling, 'GET', '/v1/modeling/templates')).json());
    expect(data.usage).toEqual((await request(modeling, 'GET', '/v1/modeling/usage')).json());
    const first = data.bootstrap.models.find((m: { archivedAt: string | null }) => !m.archivedAt);
    expect(data.bootstrap.firstHistory).toEqual({ modelId: first.id, revision: first.revision, historical: null });
    expect(data.bootstrap.models.every((m: { companyId: string; sector: string }) => m.companyId === modelingId && pme.sectors.includes(m.sector))).toBe(true);
  });
  it('ilimitado cria mais de dez projectos sem transformar os cinco utilizadores em ilimitados', async () => {
    for (let i = 0; i < 11; i++) expect((await request(unlimited, 'POST', '/v1/modeling/models', model())).statusCode).toBe(201);
    expect((await request(unlimited, 'GET', '/v1/modeling/usage')).json()).toMatchObject({ activeProjects: 11, projectLimit: null, canCreateProject: true, userLimit: 5 });
  });
  it('calcula preços no servidor e mantém os pedidos RH e Modelagem separados', async () => {
    const hrPay = await request(hr, 'POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'semiannual', amountMinor: 1 });
    expect(hrPay.json().amountMinor).toBe(54_000_000);
    const pay = await request(hr, 'POST', '/v1/billing/requests', { kind: 'modeling_subscription', planKey: 'pme', cycle: 'monthly', extraUsers: 2, sectors: pme.sectors, amountMinor: 1 });
    expect(pay.statusCode).toBe(201); expect(pay.json()).toMatchObject({ amountMinor: 37_000_000, projectLimit: 2, extraUsers: 2, status: 'pending', modelingSectors: ['mineracao', 'servicos'] });
    expect((await request(hr, 'GET', '/v1/billing')).json().requests.filter((p: { status: string }) => p.status === 'pending')).toHaveLength(2);
    expect((await request(hr, 'GET', '/v1/modules')).json().modeling.subscribed).toBe(false);
    expect((await request(hr, 'POST', `/v1/platform/payment-requests/${pay.json().id}/confirm`, {})).json().status).toBe('paid');
    expect((await request(hr, 'GET', '/v1/modules')).json()).toMatchObject({ hr: { status: 'trial' }, modeling: { status: 'active', projectLimit: 2, userLimit: 7, sectors: pme.sectors } });
    expect((await request(hr, 'POST', `/v1/platform/payment-requests/${pay.json().id}/confirm`, {})).statusCode).toBe(404);
  });
  it('pagar RH activa apenas RH e conserva a licença de Modelagem', async () => {
    const before = (await request(modeling, 'GET', '/v1/modules')).json().modeling;
    const pay = await request(modeling, 'POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't5', cycle: 'monthly' });
    expect(pay.json().amountMinor).toBe(45_000_000);
    expect((await request(hr, 'POST', `/v1/platform/payment-requests/${pay.json().id}/confirm`, {})).statusCode).toBe(200);
    const after = (await request(modeling, 'GET', '/v1/modules')).json();
    expect(after.hr).toMatchObject({ status: 'active', canAccess: true }); expect(after.modeling).toEqual(before);
  });
  it('recusa mensal ilimitado, sectores repetidos e a remoção do sector principal', async () => {
    const pay = (changes: object) => request(hr, 'POST', '/v1/billing/requests', { kind: 'modeling_subscription', planKey: 'pme', cycle: 'monthly', sectors: pme.sectors, ...changes });
    expect((await pay({ planKey: 'unlimited', sectors: FINANCIAL_SECTORS })).json().error).toBe('ciclo_indisponivel');
    expect((await pay({ sectors: ['mineracao', 'mineracao'] })).statusCode).toBe(400);
    expect((await pay({ sectors: ['servicos', 'agro'] })).statusCode).toBe(400);
  });
  it('não remove um sector com projectos activos ao mudar de plano', async () => {
    expect((await request(both, 'POST', '/v1/modeling/models', model('servicos'))).statusCode).toBe(201);
    const pay = await request(both, 'POST', '/v1/billing/requests', { kind: 'modeling_subscription', planKey: 'pme', cycle: 'monthly', sectors: ['mineracao', 'comercio'] });
    expect(pay.json().error).toBe('sector_em_uso');
    expect((await request(both, 'GET', '/v1/modules')).json().modeling.sectors).toHaveLength(4);
  });
  it('os utilizadores extra pagos são explícitos e a própria empresa não altera os direitos na base de dados', async () => {
    await request(hr, 'GET', '/v1/modeling/session'); // o proprietário ocupa um dos sete lugares
    for (let i = 0; i < 7; i++) {
      const user = await request(hr, 'POST', '/v1/users', { name: `Participante ${i}`, email: `${stamp}.participant.${i}@modules.test`, password, role: 'finance' });
      expect(user.statusCode).toBe(201);
      const enabled = await request(hr, 'PUT', `/v1/modeling/members/${user.json().id}`, { enabled: true, permission: 'editor' });
      expect(enabled.statusCode).toBe(i < 6 ? 200 : 409);
    }
    expect((await request(hr, 'GET', '/v1/modeling/usage')).json().enabledUsers).toBe(7);
    expect((await request(hr, 'POST', '/v1/billing/requests', { kind: 'modeling_subscription', planKey: 'pme', cycle: 'monthly', sectors: pme.sectors, extraUsers: 0 })).json().error).toBe('limite_inferior_uso');
    await expect(withTenant(hrId, () => getDb().update(companyModules).set({ modelingSectors: [...FINANCIAL_SECTORS] }))).rejects.toThrow();
  });
  it('suspender RH não suspende Modelagem nem a gestão comum dos utilizadores', async () => {
    await getDb().execute(sql`update subscriptions set status='suspended' where company_id=${bothId}`);
    expect((await request(both, 'POST', '/v1/modeling/models', model())).statusCode).toBe(201);
    expect((await request(both, 'POST', '/v1/departments', { name: 'Bloqueado' })).statusCode).toBe(402);
    expect((await request(both, 'GET', '/v1/access')).statusCode).toBe(200);
  });
  it('gera números distintos quando empresas contratam módulos em simultâneo', async () => {
    const responses = await Promise.all([request(hr, 'POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'monthly' }), request(modeling, 'POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't5', cycle: 'annual' })]);
    expect(responses.map(r => r.statusCode)).toEqual([201, 201]);
    expect(new Set(responses.map(r => r.json().number)).size).toBe(2);
  });
});
