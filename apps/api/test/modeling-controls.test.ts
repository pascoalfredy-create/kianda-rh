import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, sql, withTenant } from '@kianda/db';
import { platformCookie } from './platform-admin.js';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Controlos do Integra: acesso por projecto, origens de pessoal para importação e versões com autor. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'ControlosSeguros2026abc';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

describe.skipIf(!process.env.DATABASE_URL)('Integra: participantes por projecto, importação do RH e versões', () => {
  let owner = '', other = '', editor = '', viewer = '', companyId = '', otherCompany = '';
  let ownerId = '', editorId = '', viewerId = '', modelA = '', modelB = '', otherModel = '', budgetId = '';
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const plan = { key: 'pme', cycle: 'monthly', primarySector: 'servicos', sectors: ['servicos', 'comercio'] };
  const project = (name: string) => ({ name, sector: 'servicos', currency: 'Kz', assumptions: { pessoal: 100, receitas: [] } });

  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Controlos ${i}`, sector: 'services', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Proprietária', email: `${stamp}.${i}@controls.test`, password, modules: ['hr', 'modeling'], modelingPlan: plan } });
      expect(r.statusCode).toBe(201);
      if (!i) { owner = cookieOf(r); companyId = r.json().company.id; } else { other = cookieOf(r); otherCompany = r.json().company.id; }
    }
    ownerId = (await req(owner, 'GET', '/v1/auth/me')).json().user.sub;
    // Quota de projectos suficiente para o teste (consola da plataforma).
    const admin = await platformCookie(app, `${stamp}.0@controls.test`);
    expect((await req(admin, 'PUT', `/v1/platform/companies/${companyId}/modules/modeling`, { enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: 10 })).statusCode).toBe(200);
    for (const [i, permission] of ['editor', 'viewer'].entries()) {
      const email = `${stamp}.member${i}@controls.test`;
      const u = await req(owner, 'POST', '/v1/users', { name: permission === 'editor' ? 'Analista' : 'Leitor', email, password, role: 'finance' });
      expect(u.statusCode).toBe(201);
      if (!i) editorId = u.json().id; else viewerId = u.json().id;
      expect((await req(owner, 'PUT', `/v1/modeling/members/${u.json().id}`, { enabled: true, permission })).statusCode).toBe(200);
      const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
      if (!i) editor = cookieOf(login); else viewer = cookieOf(login);
    }
    for (const [name, set] of [['Projecto A', (id: string) => { modelA = id; }], ['Projecto B', (id: string) => { modelB = id; }]] as const) {
      const r = await req(owner, 'POST', '/v1/modeling/models', project(name));
      expect(r.statusCode).toBe(201); set(r.json().id);
    }
    otherModel = (await req(other, 'POST', '/v1/modeling/models', project('Outra empresa'))).json().id;
  });

  it('por omissão o participante vê todos os projectos com a permissão geral', async () => {
    const list = (await req(editor, 'GET', '/v1/modeling/models')).json();
    expect(list.map((m: { id: string }) => m.id).sort()).toEqual([modelA, modelB].sort());
    expect(list.every((m: { permission: string }) => m.permission === 'editor')).toBe(true);
    const members = (await req(owner, 'GET', '/v1/modeling/members')).json();
    expect(members.find((m: { userId: string }) => m.userId === editorId)).toMatchObject({ scope: 'all', projects: [] });
  });

  it('restringe a projectos atribuídos: lista, leitura, gravação, versões e relatórios', async () => {
    const r = await req(owner, 'PUT', `/v1/modeling/members/${editorId}`, { enabled: true, permission: 'editor', scope: 'selected', projects: [{ modelId: modelA, permission: 'editor' }] });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ scope: 'selected', projects: [{ modelId: modelA, permission: 'editor' }] });
    const list = (await req(editor, 'GET', '/v1/modeling/models')).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([modelA]);
    const boot = (await req(editor, 'GET', '/v1/modeling/bootstrap')).json();
    expect(boot.bootstrap.models.map((m: { id: string }) => m.id)).toEqual([modelA]);
    for (const [method, url, payload] of [
      ['GET', `/v1/modeling/models/${modelB}`], ['GET', `/v1/modeling/models/${modelB}/versions`], ['GET', `/v1/modeling/models/${modelB}/calculation`],
      ['GET', `/v1/modeling/models/${modelB}/reports/sumario?format=pdf`],
      ['PUT', `/v1/modeling/models/${modelB}`, { ...project('Intrusão'), revision: 1 }], ['POST', `/v1/modeling/models/${modelB}/archive`, { archived: true, revision: 1 }],
    ] as const) {
      const res = await req(editor, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const a = (await req(editor, 'GET', `/v1/modeling/models/${modelA}`)).json();
    expect(a.permission).toBe('editor');
    expect((await req(editor, 'PUT', `/v1/modeling/models/${modelA}`, { ...project('Projecto A revisto'), revision: a.revision })).statusCode).toBe(200);
  });

  it('a permissão por projecto nunca excede a geral e a consulta não grava', async () => {
    expect((await req(owner, 'PUT', `/v1/modeling/members/${viewerId}`, { enabled: true, permission: 'viewer', scope: 'selected', projects: [{ modelId: modelB, permission: 'editor' }] })).statusCode).toBe(400);
    expect((await req(owner, 'PUT', `/v1/modeling/members/${editorId}`, { enabled: true, permission: 'editor', scope: 'selected', projects: [{ modelId: modelA, permission: 'editor' }, { modelId: modelB, permission: 'viewer' }] })).statusCode).toBe(200);
    const list = (await req(editor, 'GET', '/v1/modeling/models')).json();
    expect(Object.fromEntries(list.map((m: { id: string; permission: string }) => [m.id, m.permission]))).toEqual({ [modelA]: 'editor', [modelB]: 'viewer' });
    const b = (await req(editor, 'GET', `/v1/modeling/models/${modelB}`)).json();
    expect(b.permission).toBe('viewer');
    expect((await req(editor, 'PUT', `/v1/modeling/models/${modelB}`, { ...project('Sem permissão'), revision: b.revision })).statusCode).toBe(403);
    expect((await req(editor, 'GET', `/v1/modeling/models/${modelB}/versions`)).statusCode).toBe(200);
  });

  it('quem está restrito e cria um projecto fica com ele atribuído', async () => {
    const created = await req(editor, 'POST', '/v1/modeling/models', project('Criado pela analista'));
    expect(created.statusCode).toBe(201); expect(created.json().permission).toBe('editor');
    const list = (await req(editor, 'GET', '/v1/modeling/models')).json();
    expect(list.map((m: { id: string }) => m.id)).toContain(created.json().id);
    const members = (await req(owner, 'GET', '/v1/modeling/members')).json();
    expect(members.find((m: { userId: string }) => m.userId === editorId).projects).toHaveLength(3);
  });

  it('o proprietário vê sempre tudo; projectos de outra empresa não se atribuem', async () => {
    expect((await req(owner, 'PUT', `/v1/modeling/members/${ownerId}`, { enabled: true, permission: 'editor', scope: 'selected', projects: [] })).statusCode).toBe(409);
    expect((await req(owner, 'PUT', `/v1/modeling/members/${viewerId}`, { enabled: true, permission: 'viewer', scope: 'selected', projects: [{ modelId: otherModel, permission: 'viewer' }] })).statusCode).toBe(404);
    expect((await req(owner, 'PUT', `/v1/modeling/members/${viewerId}`, { enabled: true, permission: 'viewer', scope: 'selected', projects: [{ modelId: modelA, permission: 'viewer' }, { modelId: modelA, permission: 'viewer' }] })).statusCode).toBe(400);
    expect((await req(owner, 'GET', '/v1/modeling/models')).json().length).toBeGreaterThanOrEqual(3);
    // RLS: a outra empresa não vê as atribuições desta, nem directamente na base.
    await withTenant(otherCompany, async () => expect((await getDb().execute(sql`select id from modeling_project_access where company_id = ${companyId}`)).rows).toEqual([]));
    await expect(withTenant(otherCompany, () => getDb().execute(sql`insert into modeling_project_access(company_id, model_id, user_id, added_by) values (${otherCompany}, ${modelA}, ${viewerId}, 'x')`))).rejects.toThrow();
  });

  it('voltar a "todos os projectos" limpa as atribuições', async () => {
    expect((await req(owner, 'PUT', `/v1/modeling/members/${editorId}`, { enabled: true, permission: 'editor', scope: 'all', projects: [{ modelId: modelA, permission: 'viewer' }] })).json()).toMatchObject({ scope: 'all', projects: [] });
    expect((await req(editor, 'GET', '/v1/modeling/models')).json().length).toBeGreaterThanOrEqual(3);
    const rows = await getDb().execute(sql`select count(*)::int as n from modeling_project_access where user_id = ${editorId}`);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it('origens de pessoal: só orçamentos aprovados, janelas de 12 meses fechados, só para quem edita', async () => {
    expect((await req(viewer, 'GET', '/v1/modeling/personnel-sources')).statusCode).toBe(403);
    let s = (await req(editor, 'GET', '/v1/modeling/personnel-sources')).json();
    expect(s).toMatchObject({ hr: { active: true }, budgets: [], windows: [], closedPeriods: 0 });
    const [{ id }] = (await getDb().execute(sql`insert into personnel_budgets(company_id,year,created_by) values (${companyId}, 2027, 'test') returning id`)).rows as { id: string }[];
    budgetId = id;
    await getDb().execute(sql`insert into personnel_budget_lines(company_id,budget_id,period,headcount,gross_minor,cost_minor) values (${companyId},${budgetId},'2027-01',3,100000,250000),(${companyId},${budgetId},'2027-02',3,100000,250000)`);
    expect((await req(editor, 'GET', '/v1/modeling/personnel-sources')).json().budgets).toEqual([]);
    await getDb().execute(sql`update personnel_budgets set status='approved', approved_at=now() where id=${budgetId}`);
    for (let m = 1; m <= 13; m++) {
      const period = m <= 12 ? `2025-${String(m).padStart(2, '0')}` : '2026-01';
      await getDb().execute(sql`insert into payroll_runs(company_id, period, status, pack_version) values (${companyId}, ${period}, 'closed', 'AO-2025')`);
    }
    s = (await req(editor, 'GET', '/v1/modeling/personnel-sources')).json();
    expect(s.budgets).toMatchObject([{ id: budgetId, year: 2027, totalMinor: 500000 }]);
    expect(s.windows).toEqual([{ from: '2025-02', to: '2026-01' }, { from: '2025-01', to: '2025-12' }]);
    expect(s).toMatchObject({ closedPeriods: 13, lastClosed: '2026-01' });
    expect((await req(other, 'GET', '/v1/modeling/personnel-sources')).json().budgets).toEqual([]);
  });

  it('a importação fica registada com o nome de quem importou', async () => {
    const before = (await req(editor, 'GET', `/v1/modeling/models/${modelA}`)).json();
    const r = await req(editor, 'POST', `/v1/modeling/models/${modelA}/import-personnel`, { source: 'budget', budgetId, revision: before.revision });
    expect(r.statusCode).toBe(201); expect(r.json().model.assumptions.pessoal).toBe(5000);
    const after = (await req(editor, 'GET', `/v1/modeling/models/${modelA}`)).json();
    expect(after.imports[0]).toMatchObject({ source: 'budget', fromPeriod: '2027-01', toPeriod: '2027-12', importedByName: 'Analista' });
  });

  it('a lista de versões identifica quem aprovou', async () => {
    const model = (await req(owner, 'GET', `/v1/modeling/models/${modelB}`)).json();
    const tpl = (await req(owner, 'GET', '/v1/modeling/templates/servicos')).json();
    const full = await req(owner, 'PUT', `/v1/modeling/models/${modelB}`, { name: 'Projecto B', sector: 'servicos', currency: 'Kz', assumptions: tpl.assumptions, revision: model.revision });
    expect(full.statusCode).toBe(200);
    expect((await req(owner, 'POST', `/v1/modeling/models/${modelB}/versions`, { revision: full.json().revision, label: 'Comité de investimento' })).statusCode).toBe(201);
    const list = (await req(viewer, 'GET', `/v1/modeling/models/${modelB}/versions`)).json();
    expect(list[0]).toMatchObject({ versionNumber: 1, label: 'Comité de investimento', approvedByName: 'Proprietária' });
    expect((await req(viewer, 'GET', `/v1/modeling/models/${modelB}/versions/${list[0].id}`)).json().approvedByName).toBe('Proprietária');
  });
});
