import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, companyModules, eq, getDb, modelingMembers, sql, withTenant } from '@kianda/db';
import { financialTemplate } from '@kianda/core';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('Integra: balancetes por projecto e relatório histórico', () => {
  const stamp = `${Date.now()}history`, password = 'HistoricoSeguro2026abc';
  let owner = '', other = '', viewer = '', company = '', otherCompany = '', otherModelId = '', modelId = '', versionId = '', emptyVersion = '', snapshot: Uint8Array;
  const req = (method: string, url: string, payload?: unknown, session = owner) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const history = (revision: number, input: unknown = historicalInput, session = owner) => req('PUT', `/v1/modeling/models/${modelId}/history`, { revision, input }, session);
  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Histórico ' + i, nif: String(Date.now() + 36000 + i).slice(-10) }, name: 'Gestor', email: `${stamp}${i}@history.ao`, password } });
      expect(r.statusCode).toBe(201); const cookie = 'kianda_session=' + r.cookies.find(c => c.name === 'kianda_session')!.value;
      const me = (await req('GET', '/v1/auth/me', undefined, cookie)).json();
      await getDb().insert(companyModules).values({ companyId: me.company.id, module: 'modeling', enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: 2 });
      if (i === 0) { owner = cookie; company = me.company.id; } else { other = cookie; otherCompany = me.company.id; }
    }
    const user = await req('POST', '/v1/users', { name: 'Leitor', email: `${stamp}viewer@history.ao`, role: 'finance', password });
    expect(user.statusCode).toBe(201);
    await getDb().insert(modelingMembers).values({ companyId: company, userId: user.json().id, permission: 'viewer', addedBy: 'test' });
    const login = await req('POST', '/v1/auth/login', { email: `${stamp}viewer@history.ao`, password });
    viewer = 'kianda_session=' + login.cookies.find(c => c.name === 'kianda_session')!.value;
    const m = await req('POST', '/v1/modeling/models', { name: 'Estudo histórico', sector: 'servicos', currency: 'Kz', assumptions: financialTemplate('servicos').assumptions });
    expect(m.statusCode).toBe(201); modelId = m.json().id;
    const otherModel = await req('POST', '/v1/modeling/models', { name: 'Projecto de outra empresa', sector: 'servicos', currency: 'Kz', assumptions: {} }, other);
    expect(otherModel.statusCode).toBe(201); otherModelId = otherModel.json().id;
    const version = await req('POST', `/v1/modeling/models/${modelId}/versions`, { revision: 1, label: 'Sem histórico' });
    expect(version.statusCode).toBe(201); emptyVersion = version.json().id;
  });
  it('sem balancetes não inventa dados e recusa o oitavo relatório', async () => {
    expect((await req('GET', `/v1/modeling/models/${modelId}/history`)).json()).toEqual({ revision: 1, historical: null });
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/analise`)).json().error).toBe('historico_em_falta');
  });
  it('guarda os dois exercícios, identifica a origem e não altera pressupostos', async () => {
    const r = await history(1); expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ model: { revision: 2, assumptions: { pessoal: financialTemplate('servicos').assumptions.pessoal } }, historical: { analysis: { cN: { B: { cp: 1108, check: 0 } } } } });
    expect(r.json().historical.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await history(2)).json().model.revision).toBe(2); // mesmo conteúdo não cria revisão fictícia
    const catalogue = (await req('GET', `/v1/modeling/models/${modelId}/reports`)).json();
    expect(catalogue.reports.filter((v: { available: boolean }) => v.available)).toHaveLength(8);
  });
  it('isola empresas, impede referências cruzadas na base e bloqueia o leitor', async () => {
    expect((await req('GET', `/v1/modeling/models/${modelId}/history`, undefined, other)).statusCode).toBe(404);
    expect((await history(2, historicalInput, other)).statusCode).toBe(404);
    expect((await history(2, historicalInput, viewer)).statusCode).toBe(403);
    expect((await req('POST', `/v1/modeling/models/${modelId}/history/to-model`, { revision: 2 }, viewer)).statusCode).toBe(403);
    expect((await withTenant(otherCompany, () => getDb().execute(sql`select id from financial_historical_inputs where model_id=${modelId}`))).rows).toEqual([]);
    // Este projecto não tem histórico: a recusa testa a pertença à empresa, não um conflito UNIQUE.
    await expect(withTenant(company, () => getDb().execute(sql`insert into financial_historical_inputs(company_id,model_id,input,input_hash,updated_by) values (${company},${otherModelId},'{}'::jsonb,'hash','test')`))).rejects.toThrow();
  });
  it('CSV inválido, comparativo inválido e revisão antiga não substituem os balancetes', async () => {
    expect((await history(2, { ...historicalInput, N: 'Conta;Designação;Saldo\n43;Banco;inválido' })).statusCode).toBe(422);
    expect((await history(2, { ...historicalInput, N1: 'inválido' })).statusCode).toBe(422);
    expect((await history(1, { ...historicalInput, empresa: 'Desactualizado' })).statusCode).toBe(409);
    const current = (await req('GET', `/v1/modeling/models/${modelId}/history`)).json();
    expect(current.revision).toBe(2); expect(current.historical.analysis.input).toEqual(historicalInput);
  });
  it('congela o relatório histórico e nega Excel a clientes por URL directa', async () => {
    const version = await req('POST', `/v1/modeling/models/${modelId}/versions`, { revision: 2, label: 'Com histórico' });
    expect(version.statusCode).toBe(201); versionId = version.json().id;
    const path = `/v1/modeling/models/${modelId}/reports/analise?version=${versionId}`;
    const pdf = await req('GET', path, undefined, viewer);
    expect(pdf.statusCode).toBe(200); snapshot = pdf.bytes;
    expect(pdf.headers['content-type']).toBe('application/pdf'); expect(pdf.headers['x-source-history-hash']).toMatch(/^[a-f0-9]{64}$/);
    expect(pdf.headers['x-source-scenario']).toBe('historical'); expect((await req('GET', path + '&format=xlsx')).statusCode).toBe(403);
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/analise?version=${emptyVersion}`)).statusCode).toBe(422);
    const oldCatalogue = (await req('GET', `/v1/modeling/models/${modelId}/reports?version=${emptyVersion}`)).json();
    expect(oldCatalogue.reports.find((r: { key: string }) => r.key === 'analise').available).toBe(false);
  });
  it('alterar a origem deixa o PDF aprovado igual e a versão nova aponta para outra origem', async () => {
    const changed = { ...historicalInput, empresa: 'Empresa histórica revista' };
    const responses = await Promise.all([history(2, changed), history(2, { ...changed, empresa: 'Conflito' })]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const frozen = await req('GET', `/v1/modeling/models/${modelId}/reports/analise?version=${versionId}`);
    expect(frozen.bytes).toEqual(snapshot); expect(frozen.headers['x-source-revision']).toBe('2');
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/analise?revision=3`)).bytes).not.toEqual(snapshot);
  });
  it('cria um projecto de avaliação como cópia e respeita a quota de projectos', async () => {
    const r = await req('POST', `/v1/modeling/models/${modelId}/history/to-model`, { revision: 3 });
    expect(r.statusCode).toBe(201); const derived = r.json().model;
    expect(derived).toMatchObject({ revision: 1, assumptions: { inicio: 'existente', pessoal: 120, historicalBasis: { year: '2025' } } });
    expect((await req('GET', `/v1/modeling/models/${derived.id}/calculation`)).json().result.bookEq).toBe(1108);
    expect((await req('GET', `/v1/modeling/models/${derived.id}/history`)).json().historical.inputHash).toBe(r.json().historical.inputHash);
    expect((await req('POST', `/v1/modeling/models/${modelId}/history/to-model`, { revision: 3 })).json().error).toBe('limite_projectos');
    expect((await req('GET', '/v1/modeling/usage')).json().activeProjects).toBe(2);
  });
  it('o relatório histórico funciona com pressupostos de projecção incompletos', async () => {
    expect((await req('PUT', `/v1/modeling/models/${modelId}`, { revision: 3, name: 'Rascunho incompleto', sector: 'servicos', currency: 'Kz', assumptions: { pessoal: 1 } })).statusCode).toBe(200);
    const r = await req('GET', `/v1/modeling/models/${modelId}/reports/analise?revision=4`);
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('application/pdf');
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/sumario`)).statusCode).toBe(422);
  });
  it('arquivo e licença suspensa conservam consulta e bloqueiam novas importações', async () => {
    expect((await req('POST', `/v1/modeling/models/${modelId}/archive`, { revision: 4, archived: true })).statusCode).toBe(200);
    expect((await history(5)).json().error).toBe('projecto_arquivado');
    expect((await req('POST', `/v1/modeling/models/${modelId}/history/to-model`, { revision: 5 })).json().error).toBe('projecto_arquivado');
    await getDb().update(companyModules).set({ status: 'suspended' }).where(eq(companyModules.companyId, company));
    expect((await history(5)).statusCode).toBe(402);
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/analise?version=${versionId}`, undefined, viewer)).bytes).toEqual(snapshot);
  });
});
