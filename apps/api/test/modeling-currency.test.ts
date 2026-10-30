import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, companyModules, eq, getDb, modelingMembers } from '@kianda/db';
import { FINANCIAL_REPORT_KEYS, financialTemplate } from '@kianda/core';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('conversão monetária atómica por empresa', () => {
  const stamp = `${Date.now()}fx`, password = 'ConversaoSegura2026abc';
  let owner = '', other = '', viewer = '', companyId = '', id = '', version = '', pdf: Uint8Array;
  const original = financialTemplate('mineracao').assumptions;
  const req = (method: string, url: string, payload?: unknown, session = owner) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const convert = (revision: number, from = 'USD', to = 'Kz', rate = 1000, session = owner) => req('POST', `/v1/modeling/models/${id}/convert-currency`, { revision, from, to, rate, rateDate: '2026-10-27', source: 'Taxa sintética do teste' }, session);
  beforeAll(async () => {
    for (const i of [0, 1]) {
      const result = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Conversão ' + i, nif: String(Date.now() + 54000 + i).slice(-10) }, name: 'Gestor', email: `${stamp}${i}@currency.ao`, password } });
      expect(result.statusCode).toBe(201); const cookie = 'kianda_session=' + result.cookies.find(c => c.name === 'kianda_session')!.value;
      const me = (await req('GET', '/v1/auth/me', undefined, cookie)).json();
      await getDb().insert(companyModules).values({ companyId: me.company.id, module: 'modeling', enabled: true, status: 'active', paidUntil: '2099-12-31', projectLimit: 2 });
      if (!i) { owner = cookie; companyId = me.company.id; } else other = cookie;
    }
    const user = await req('POST', '/v1/users', { name: 'Leitor', email: `${stamp}viewer@currency.ao`, role: 'finance', password }); expect(user.statusCode).toBe(201);
    await getDb().insert(modelingMembers).values({ companyId, userId: user.json().id, permission: 'viewer', addedBy: 'test' });
    const login = await req('POST', '/v1/auth/login', { email: `${stamp}viewer@currency.ao`, password }); viewer = 'kianda_session=' + login.cookies.find(c => c.name === 'kianda_session')!.value;
    const result = await req('POST', '/v1/modeling/models', { name: 'Modelo cambial', sector: 'mineracao', currency: 'USD', assumptions: original }); expect(result.statusCode).toBe(201); id = result.json().id;
  });
  it('impede mudar só o símbolo através da gravação genérica', async () => {
    expect((await req('PUT', `/v1/modeling/models/${id}`, { name: 'Modelo cambial', sector: 'mineracao', currency: 'EUR', assumptions: original, revision: 1 })).json().error).toBe('conversao_obrigatoria');
    expect((await req('GET', `/v1/modeling/models/${id}`)).json()).toMatchObject({ currency: 'USD', revision: 1 });
  });
  it('aprova a versão original e guarda o balancete na moeda da sua fonte', async () => {
    const v = await req('POST', `/v1/modeling/models/${id}/versions`, { revision: 1, label: 'Original USD' }); expect(v.statusCode).toBe(201); version = v.json().id;
    pdf = (await req('GET', `/v1/modeling/models/${id}/reports/sumario?version=${version}`)).bytes;
    expect((await req('PUT', `/v1/modeling/models/${id}/history`, { revision: 1, input: historicalInput })).json().model.revision).toBe(2);
  });
  it('converte montantes, guarda a origem e mantém as quantidades e percentagens', async () => {
    const result = await convert(2); expect(result.statusCode).toBe(200); const m = result.json();
    expect(m).toMatchObject({ currency: 'Kz', revision: 3, assumptions: { pessoal: original.pessoal * 1000, divida: { montante: original.divida.montante * 1000, taxa: original.divida.taxa }, currencyConversion: { from: 'USD', to: 'Kz', rate: 1000, rateDate: '2026-10-27' } } });
    expect(m.assumptions.receitas[0].qtd).toBe(original.receitas[0]!.qtd); expect(m.assumptions.receitas[0].preco).toBe(original.receitas[0]!.preco * 1000);
    expect((await req('GET', `/v1/modeling/models/${id}/calculation`)).json().result.checks.balance).toBe(true);
  });
  it('rejeita revisões antigas e duas conversões concorrentes não são aplicadas duas vezes', async () => {
    expect((await convert(2)).statusCode).toBe(409);
    const attempts = await Promise.all([convert(3, 'Kz', 'EUR', 0.001), convert(3, 'Kz', 'EUR', 0.001)]);
    expect(attempts.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const current = (await req('GET', `/v1/modeling/models/${id}`)).json(); expect(current).toMatchObject({ revision: 4, currency: 'EUR', assumptions: { pessoal: original.pessoal } });
  });
  it('a revisão convertida aplica EUR aos sete mapas exportados e identifica a moeda no download',async()=>{
    for(const key of FINANCIAL_REPORT_KEYS){
      const file=await req('GET',`/v1/modeling/models/${id}/reports/${key}?revision=4`);
      expect(file.statusCode,key).toBe(200);expect(file.headers['content-type'],key).toBe('application/pdf');expect(file.headers['x-source-currency'],key).toBe('EUR');expect(file.headers['x-source-revision'],key).toBe('4');
    }
    expect((await req('GET',`/v1/modeling/models/${id}/reports/sumario?version=${version}`)).headers['x-source-currency']).toBe('USD');
    expect((await req('GET',`/v1/modeling/models/${id}/reports/analise`)).headers['x-source-currency']).toBe('Kz');
  });
  it('PDF aprovado e balancetes conservam o conteúdo e a moeda originais', async () => {
    expect((await req('GET', `/v1/modeling/models/${id}/reports/sumario?version=${version}`)).bytes).toEqual(pdf);
    expect((await req('GET', `/v1/modeling/models/${id}/versions/${version}`)).json().payload.source.currency).toBe('USD');
    expect((await req('GET', `/v1/modeling/models/${id}/history`)).json().historical.analysis.input).toEqual(historicalInput);
    const m = (await req('GET', `/v1/modeling/models/${id}`)).json();
    expect((await req('PUT', `/v1/modeling/models/${id}`, { ...m, assumptions: { ...m.assumptions, currencyConversion: { rate: 999 } } })).json().assumptions.currencyConversion.rate).toBe(0.001);
  });
  it('não concede conversão a leitores/outras empresas e recusa taxa inválida ou sobrefluxo', async () => {
    expect((await convert(5, 'EUR', 'USD', 1, other)).statusCode).toBe(404); expect((await convert(5, 'EUR', 'USD', 1, viewer)).statusCode).toBe(403);
    expect((await convert(5, 'EUR', 'USD', 0)).statusCode).toBe(400); expect((await convert(5, 'EUR', 'USD', 1e12)).statusCode).toBe(422);
    expect((await req('GET', `/v1/modeling/models/${id}`)).json().revision).toBe(5);
  });
  it('permite corrigir a identificação antiga quando os valores ainda estavam na moeda original', async () => {
    const r = await convert(5, 'USD', 'USD', 1); expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ currency: 'USD', revision: 6, assumptions: { pessoal: original.pessoal, currencyConversion: { storedFrom: 'EUR', from: 'USD', to: 'USD', rate: 1 } } });
  });
  it('verifica a referência no servidor e não aceita uma taxa alterada pelo cliente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ base: 'USD', quote: 'AOA', rate: 913, date: '2026-10-27' }))));
    const input = { revision: 6, from: 'USD', to: 'Kz', rate: 1, rateDate: '2026-10-27', source: 'Texto do cliente', reference: true };
    try {
      expect((await req('POST', `/v1/modeling/models/${id}/convert-currency`, input)).json().error).toBe('cambio_alterado');
      const result = await req('POST', `/v1/modeling/models/${id}/convert-currency`, { ...input, rate: 913 }); expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ revision: 7, currency: 'Kz', assumptions: { currencyConversion: { rate: 913, source: 'BNA via Frankfurter (referência)' } } });
    } finally { vi.unstubAllGlobals(); }
  });
  it('arquivo/licença em consulta bloqueiam conversões e downloads, conservando a versão para pré-visualização', async () => {
    expect((await req('POST', `/v1/modeling/models/${id}/archive`, { revision: 7, archived: true })).statusCode).toBe(200); expect((await convert(8)).statusCode).toBe(409);
    await getDb().update(companyModules).set({ status: 'suspended' }).where(eq(companyModules.companyId, companyId)); expect((await convert(8)).statusCode).toBe(402);
    expect((await req('GET', `/v1/modeling/models/${id}/reports/sumario?version=${version}`)).statusCode).toBe(402);
    expect((await req('GET', `/v1/modeling/models/${id}/versions/${version}`)).json().payload.source.currency).toBe('USD');
  });
});
