import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankValuationData } from '@kianda/core';
import { closeDb, getDb, platformAdmins, sql } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Kianda Valora: licença própria, membros, análises isoladas por empresa, concorrência e ligação ao RH. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'ValoraSeguro2026abc';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const analysis = (entity: string) => blankValuationData({ entity, lastClosedYear: 2025, historyYears: 3 });

describe.skipIf(!process.env.DATABASE_URL)('Valora: módulo de análise financeira e avaliação', () => {
  let owner = '', hrOnly = '', other = '', editor = '', viewer = '', companyId = '', hrOnlyCompany = '', editorId = '', viewerId = '';
  let own = '', target = '';
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });

  beforeAll(async () => {
    const register = async (i: number, modules: string[]) => {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: `Valora ${i}`, sector: 'commerce', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Proprietário', email: `${stamp}.${i}@valora.test`, password, acceptTerms: true, modules } });
      expect(r.statusCode).toBe(201);
      return { cookie: cookieOf(r), id: r.json().company.id as string };
    };
    ({ cookie: owner, id: companyId } = await register(0, ['hr', 'valuation']));
    ({ cookie: hrOnly, id: hrOnlyCompany } = await register(1, ['hr']));
    ({ cookie: other } = await register(2, ['valuation']));
    for (const [i, permission] of ['editor', 'viewer'].entries()) {
      const email = `${stamp}.member${i}@valora.test`;
      const u = await req(owner, 'POST', '/v1/users', { name: permission === 'editor' ? 'Analista' : 'Leitor', email, password, role: 'finance' });
      expect(u.statusCode).toBe(201);
      if (!i) editorId = u.json().id; else viewerId = u.json().id;
      const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
      if (!i) editor = cookieOf(login); else viewer = cookieOf(login);
    }
  });

  it('o registo abre o período experimental com três análises e cinco utilizadores', async () => {
    const modules = (await req(owner, 'GET', '/v1/modules')).json();
    expect(modules.valuation).toMatchObject({ subscribed: true, status: 'trial', canAccess: true, analysisLimit: 3, userLimit: 5 });
    expect(modules.valuation.trialEndsAt).toBeTruthy();
    const boot = (await req(owner, 'GET', '/v1/valuation/bootstrap')).json();
    expect(boot).toMatchObject({ permission: 'editor', canWrite: true, analyses: [], current: null, hr: { available: true }, formats: { pdf: false, docx: false, xlsx: false } });
    expect(boot.usage).toMatchObject({ analysisLimit: 3, activeAnalyses: 0, enabledUsers: 1, canCreateAnalysis: true });
  });

  it('sem subscrição o módulo está fechado; os outros utilizadores precisam de acesso', async () => {
    expect((await req(hrOnly, 'GET', '/v1/valuation/bootstrap')).json()).toMatchObject({ error: 'modulo_nao_subscrito' });
    expect((await req(hrOnly, 'GET', '/v1/modules')).json().valuation).toMatchObject({ subscribed: false, canAccess: false });
    const denied = await req(editor, 'GET', '/v1/valuation/bootstrap');
    expect(denied.statusCode).toBe(403); expect(denied.json().error).toBe('sem_permissao');
    for (const [id, permission] of [[editorId, 'editor'], [viewerId, 'viewer']]) expect((await req(owner, 'PUT', `/v1/valuation/members/${id}`, { enabled: true, permission })).statusCode).toBe(200);
    expect((await req(editor, 'PUT', `/v1/valuation/members/${viewerId}`, { enabled: false })).statusCode).toBe(403);
    expect((await req(owner, 'PUT', `/v1/valuation/members/${(await req(owner, 'GET', '/v1/auth/me')).json().user.sub}`, { enabled: false })).json().error).toBe('proprio_acesso');
    expect((await req(owner, 'GET', '/v1/valuation/members')).json()).toHaveLength(3);
  });

  it('cria análises validadas e isoladas por empresa', async () => {
    const bad = await req(editor, 'POST', '/v1/valuation/analyses', { name: 'Inválida', data: { ...analysis('X'), years: [2025, 2023] } });
    expect(bad.statusCode).toBe(400);
    const a = await req(editor, 'POST', '/v1/valuation/analyses', { name: 'A própria empresa', data: analysis('Valora 0, Lda'), ownCompany: true });
    expect(a.statusCode).toBe(201); own = a.json().id;
    const b = await req(editor, 'POST', '/v1/valuation/analyses', { name: 'Alvo de aquisição', data: analysis('Alvo, S.A.'), source: 'example' });
    expect(b.statusCode).toBe(201); target = b.json().id;
    expect((await req(viewer, 'POST', '/v1/valuation/analyses', { name: 'Leitor', data: analysis('L') })).statusCode).toBe(403);
    expect((await req(viewer, 'GET', `/v1/valuation/analyses/${own}`)).json().data.meta.ent).toBe('Valora 0, Lda');
    expect((await req(other, 'GET', `/v1/valuation/analyses/${own}`)).statusCode).toBe(404);
    expect((await req(other, 'GET', '/v1/valuation/analyses')).json()).toEqual([]);
    const audit = (await getDb().execute(sql`select action from audit_logs where entity = 'valuation_analysis' and entity_id = ${own}`)).rows;
    expect(audit).toEqual([{ action: 'create' }]);
  });

  it('respeita o limite de análises activas; arquivar liberta um lugar', async () => {
    expect((await req(editor, 'POST', '/v1/valuation/analyses', { name: 'Terceira', data: analysis('C') })).statusCode).toBe(201);
    const full = await req(editor, 'POST', '/v1/valuation/analyses', { name: 'Quarta', data: analysis('D') });
    expect(full.statusCode).toBe(409); expect(full.json().error).toBe('limite_analises');
    expect((await req(editor, 'POST', `/v1/valuation/analyses/${target}/archive`)).json().archivedAt).toBeTruthy();
    expect((await req(editor, 'PUT', `/v1/valuation/analyses/${target}`, { revision: 1, name: 'X' })).json().error).toBe('analise_arquivada');
    expect((await req(editor, 'POST', '/v1/valuation/analyses', { name: 'Quarta', data: analysis('D') })).statusCode).toBe(201);
    expect((await req(editor, 'POST', `/v1/valuation/analyses/${target}/restore`)).json().error).toBe('limite_analises');
  });

  it('grava com controlo de revisão e nunca aceita dados que o motor não abre', async () => {
    const current = (await req(editor, 'GET', `/v1/valuation/analyses/${own}`)).json();
    const data = { ...current.data, tax: 30 };
    const saved = await req(editor, 'PUT', `/v1/valuation/analyses/${own}`, { revision: current.revision, data });
    expect(saved.statusCode).toBe(200); expect(saved.json().revision).toBe(current.revision + 1);
    const stale = await req(owner, 'PUT', `/v1/valuation/analyses/${own}`, { revision: current.revision, data });
    expect(stale.statusCode).toBe(409); expect(stale.json()).toMatchObject({ error: 'revisao_invalida', revision: current.revision + 1 });
    const broken = await req(editor, 'PUT', `/v1/valuation/analyses/${own}`, { revision: current.revision + 1, data: { ...data, real: { ...data.real, c72: [1, 2] } } });
    expect(broken.statusCode).toBe(400);
    const huge = await req(editor, 'PUT', `/v1/valuation/analyses/${own}`, { revision: current.revision + 1, data: { ...data, rnotes: { pack: 'x'.repeat(1_100_000) } } });
    expect([400, 413]).toContain(huge.statusCode);
    expect((await req(editor, 'GET', `/v1/valuation/analyses/${own}`)).json().data.tax).toBe(30);
  });

  it('traz os custos com o pessoal (72) dos processamentos fechados só para a própria empresa', async () => {
    const db = getDb();
    const [emp] = (await db.execute(sql`insert into employees(company_id, number, name, job_title) values (${companyId}, ${'V' + stamp.slice(-6)}, 'Ana', 'Contabilista') returning id`)).rows as { id: string }[];
    for (const [period, gross, employer] of [['2026-01', 300_000_000, 24_000_000], ['2026-02', 310_000_000, 24_800_000]] as const) {
      const [run] = (await db.execute(sql`insert into payroll_runs(company_id, period, status, pack_version) values (${companyId}, ${period}, 'closed', 'AO-2025') returning id`)).rows as { id: string }[];
      await db.execute(sql`insert into payroll_lines(run_id, employee_id, gross_minor, inss_employer_minor) values (${run!.id}, ${emp!.id}, ${gross}, ${employer})`);
    }
    await db.execute(sql`insert into payroll_runs(company_id, period, status, pack_version) values (${companyId}, '2026-03', 'draft', 'AO-2025')`);
    const third = (await req(editor, 'GET', '/v1/valuation/analyses')).json().find((x: { name: string }) => x.name === 'Terceira');
    expect((await req(editor, 'POST', `/v1/valuation/analyses/${third.id}/import-personnel`, { revision: third.revision })).json().error).toBe('analise_externa');
    const before = (await req(editor, 'GET', `/v1/valuation/analyses/${own}`)).json();
    const r = await req(editor, 'POST', `/v1/valuation/analyses/${own}/import-personnel`, { revision: before.revision });
    expect(r.statusCode).toBe(200);
    // 3 000 000 Kz + 240 000 Kz = 3,24 Mkz em Janeiro; o rascunho de Março não conta.
    expect(r.json()).toMatchObject({ year: 2026, months: [{ month: 0, mkz: 3.24, headcount: 1 }, { month: 1, mkz: 3.348, headcount: 1 }] });
    expect(r.json().analysis.data.real.c72.slice(0, 3)).toEqual([3.24, 3.348, null]);
    expect(r.json().analysis.revision).toBe(before.revision + 1);
    const audit = (await db.execute(sql`select action, after from audit_logs where entity = 'valuation_analysis' and entity_id = ${own} and action = 'import_personnel'`)).rows as { after: { months: unknown[] } }[];
    expect(audit[0]!.after.months).toHaveLength(2);
    expect(JSON.stringify(audit[0])).not.toContain('Ana');
  });

  it('a plataforma define limites e não aceita limites abaixo do uso', async () => {
    await getDb().insert(platformAdmins).values({ email: `${stamp}.0@valora.test` });
    const low = await req(owner, 'PUT', `/v1/platform/companies/${companyId}/modules/valuation`, { enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: 1 });
    expect(low.statusCode).toBe(409);
    const ok = await req(owner, 'PUT', `/v1/platform/companies/${companyId}/modules/valuation`, { enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: null, extraUsers: 2 });
    expect(ok.statusCode).toBe(200);
    expect((await req(owner, 'GET', '/v1/modules')).json().valuation).toMatchObject({ status: 'active', analysisLimit: null, userLimit: 7 });
    expect((await req(owner, 'GET', '/v1/valuation/session')).json().formats).toEqual({ pdf: true, docx: true, xlsx: true });
    expect((await req(owner, 'PUT', `/v1/platform/companies/${hrOnlyCompany}/modules/valuation`, { enabled: true, status: 'trial' })).json().error).toBe('periodo_obrigatorio');
  });

  it('licença em consulta: lê mas não grava', async () => {
    await getDb().execute(sql`update company_modules set status = 'suspended' where company_id = ${companyId} and module = 'valuation'`);
    expect((await req(editor, 'GET', `/v1/valuation/analyses/${own}`)).statusCode).toBe(200);
    const blocked = await req(editor, 'PUT', `/v1/valuation/analyses/${own}`, { revision: 99, name: 'Bloqueado' });
    expect(blocked.statusCode).toBe(402);
    expect((await req(editor, 'GET', '/v1/valuation/session')).json()).toMatchObject({ canWrite: false });
  });
  it('a licença mostra o uso do Valora; a empresa não concede a licença a si própria', async () => {
    expect((await req(owner, 'GET', '/v1/billing')).json().valuationUsage).toMatchObject({ enabledUsers: 3, canAddUser: true });
    expect((await req(hrOnly, 'GET', '/v1/billing')).json().valuationUsage).toMatchObject({ activeAnalyses: 0 });
    expect((await req(hrOnly, 'PUT', `/v1/platform/companies/${hrOnlyCompany}/modules/valuation`, { enabled: true, status: 'trial', trialEndsAt: '2099-01-01' })).statusCode).toBe(403);
  });
});
