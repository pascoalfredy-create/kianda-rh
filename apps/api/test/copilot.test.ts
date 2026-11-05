import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { blankValuationData, financialTemplate } from '@kianda/core';
import { and, auditLogs, closeDb, companyModules, eq, getDb, modelingMembers, modelingProjectAccess, sql } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';
import { expertGuides, expertInstructions, retrieveExpertGuides } from '../src/services/copilot-knowledge.js';
import { modelingCopilotContext, valuationCopilotContext } from '../src/services/copilot-context.js';
import { requestExpertAnswer } from '../src/services/copilot-ai.js';

const app = testClient(buildApp({ rateLimit: false }));
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const password = 'Copilotos2026seguro', stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const enabled = () => { vi.stubEnv('OPENAI_API_KEY', 'chave-sintetica-sem-custo'); vi.stubEnv('KIANDA_AI_MODEL', 'modelo-simulado'); vi.stubEnv('KIANDA_COPILOT_AI_ENABLED', 'true'); };
const response = (text = 'Reveja o caixa disponível e o serviço da dívida.') => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }] }), { status: 200 });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe('conhecimento e contextos dos copilotos', () => {
  it('cada especialista tem temas, fontes e instruções próprias', () => {
    expect(retrieveExpertGuides('hr', 'Os 8% do INSS descontam no trabalhador?')[0]!.id).toBe('hr-inss');
    expect(retrieveExpertGuides('modeling', 'Como interpretar o DSCR da dívida?')[0]!.id).toBe('integra-credit');
    expect(retrieveExpertGuides('valuation', 'Importar um balancete do ERP em PDF')[0]!.id).toBe('valora-import');
    expect(retrieveExpertGuides('hr', 'astronomia')).toEqual([]);
    for (const module of ['hr', 'modeling', 'valuation'] as const) { expect(expertGuides(module).length).toBeGreaterThan(4); expect(expertInstructions(module)).toContain('Não executes alterações'); }
  });
  it('o contexto do Integra usa o motor e exclui texto, nomes e documentos dos pressupostos', () => {
    const a = { ...financialTemplate('servicos').assumptions, nome: 'Nome confidencial', notas: 'NIF 5000000000 / informação reservada' };
    const context = modelingCopilotContext(a, 'Kz', 7);
    expect(context).toMatchObject({ revision: 7, unit: 'Kz' }); expect(context.figures.balancoFecha).toBe(true); expect(JSON.stringify(context)).not.toMatch(/Nome confidencial|5000000000|informação reservada/);
  });
  it('o Valora identifica unidades, o exercício e a reconciliação sem enviar o perfil da entidade', () => {
    const d = blankValuationData({ entity: 'Entidade Reservada', nif: '5000000000', lastClosedYear: 2025 });
    d.dr.v61[2] = 100; d.dr.c71[2] = 20; d.dr.c72[2] = 10; d.dr.c75[2] = 10; d.bal.caixa[2] = 45;
    const c = valuationCopilotContext(d, 2); expect(c).toMatchObject({ unit: 'Milhões de Kz (Mkz)', revision: 2, figures: { anoHistorico: 2025, receitas: 100, ebitda: 60, resultadoLiquidoCalculado: 45, diferencaBalanco: 0 } });
    expect(JSON.stringify(c)).not.toMatch(/Entidade Reservada|5000000000/);
  });
  it('sem activação explícita não contacta o fornecedor, mesmo com chave e modelo', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'chave-sintetica'); vi.stubEnv('KIANDA_AI_MODEL', 'modelo-simulado'); vi.stubEnv('KIANDA_COPILOT_AI_ENABLED', 'false');
    const f = vi.spyOn(globalThis, 'fetch'); await expect(requestExpertAnswer('hr', 'Explique o INSS', [])).rejects.toMatchObject({ code: 'copiloto_por_activar' }); expect(f).not.toHaveBeenCalled();
  });
  it('a integração usa Responses sem guardar respostas e trata recusas e respostas incompletas', async () => {
    enabled(); const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'incomplete', output: [] }))).mockResolvedValueOnce(new Response('segredo-do-fornecedor', { status: 401 }));
    const r = await requestExpertAnswer('hr', 'Explique os 8% do INSS', []); expect(r).toMatchObject({ mode: 'ai', usedContext: false });
    const body = JSON.parse(String(f.mock.calls[0]![1]!.body)); expect(body).toMatchObject({ store: false, model: 'modelo-simulado', max_output_tokens: 2000 }); expect(f.mock.calls[0]![0]).toBe('https://api.openai.com/v1/responses'); expect(body.instructions).toContain('legislação laboral angolana');
    await expect(requestExpertAnswer('hr', 'Explique o INSS', [])).rejects.toMatchObject({ code: 'copiloto_resposta_incompleta' });
    await expect(requestExpertAnswer('hr', 'Explique o INSS', [])).rejects.not.toThrow('segredo-do-fornecedor');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('acessos e consulta dos copilotos', () => {
  let owner = '', other = '', hrOnly = '', viewer = '', viewerId = '', companyId = '', modelA = '', modelB = '', analysis = '';
  const ask = (module = 'hr', overrides = {}, actor?: string) => req(actor ?? owner, 'POST', `/v1/copilots/${module}/ask`, { question: 'Como interpretar estes resultados?', consent: true, ...overrides });
  beforeAll(async () => {
    for (const i of [0, 1, 2]) {
      const modules = i === 2 ? ['hr'] : i === 1 ? ['modeling', 'valuation'] : ['hr', 'modeling', 'valuation'];
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Copilotos ${i}`, sector: 'services', nif: String(Number(stamp.slice(-10)) + i).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${i}@copilot.test`, password, modules, ...(i < 2 ? { modelingPlan: { key: 'pme', cycle: 'monthly', primarySector: 'servicos', sectors: ['servicos', 'comercio'] } } : {}) } });
      expect(r.statusCode, r.body).toBe(201); if (i === 0) { owner = cookie(r); companyId = r.json().company.id; } else if (i === 1) other = cookie(r); else hrOnly = cookie(r);
    }
    const project = async (name: string) => { const t = financialTemplate('servicos'); const r = await req(owner, 'POST', '/v1/modeling/models', { name, sector: 'servicos', currency: t.currency, assumptions: t.assumptions }); expect(r.statusCode, r.body).toBe(201); return r.json().id as string; };
    modelA = await project('Projecto confidencial A'); modelB = await project('Projecto confidencial B');
    const d = blankValuationData({ entity: 'Análise muito reservada', nif: '5000000000', lastClosedYear: 2025 });
    const v = await req(owner, 'POST', '/v1/valuation/analyses', { name: 'Análise reservada', data: d }); expect(v.statusCode, v.body).toBe(201); analysis = v.json().id;
    const email = `viewer.${stamp}@copilot.test`; const u = await req(owner, 'POST', '/v1/users', { name: 'Leitor', email, password, role: 'finance' }); expect(u.statusCode).toBe(201); viewerId = u.json().id;
    viewer = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
    expect((await req(owner, 'PUT', `/v1/modeling/members/${viewerId}`, { enabled: true, permission: 'viewer', scope: 'selected' })).statusCode).toBe(200);
    await getDb().insert(modelingProjectAccess).values({ companyId, modelId: modelA, userId: viewerId, permission: 'viewer', addedBy: viewerId });
  });

  it('mostra os três especialistas e mantém a conversa indisponível sem configuração', async () => {
    for (const module of ['hr', 'modeling', 'valuation']) { const r = await req(owner, 'GET', `/v1/copilots/${module}/setup`); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ module, aiReady: false, canAsk: true }); }
    expect((await ask()).json().error).toBe('copiloto_por_activar');
    expect((await req(hrOnly, 'GET', '/v1/copilots/modeling/setup')).statusCode).toBe(403);
    expect((await req(hrOnly, 'GET', '/v1/copilots/valuation/setup')).statusCode).toBe(403);
    expect((await req(other, 'GET', '/v1/copilots/modeling/setup')).statusCode).toBe(200);
    expect((await req(other, 'GET', '/v1/copilots/hr/setup')).statusCode).toBe(403);
  });

  it('um leitor recebe só os projectos atribuídos e uma empresa não recebe dados da outra', async () => {
    const setup = await req(viewer, 'GET', '/v1/copilots/modeling/setup'); expect(setup.statusCode, setup.body).toBe(200); expect(setup.json().entities.map((e: any) => e.id)).toEqual([modelA]);
    expect((await req(viewer, 'GET', `/v1/copilots/modeling/context/${modelA}`)).statusCode).toBe(200);
    expect((await req(viewer, 'GET', `/v1/copilots/modeling/context/${modelB}`)).statusCode).toBe(404);
    for (const [module, id] of [['modeling', modelA], ['valuation', analysis]]) { const r = await req(other, 'GET', `/v1/copilots/${module}/context/${id}`); expect(r.statusCode, r.body).toBe(404); expect(r.body).not.toContain('confidencial'); }
  });

  it('só envia contexto autorizado da revisão actual e chama a IA depois de confirmar a transacção', async () => {
    enabled();
    const platformDb = getDb();
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const commits = await platformDb.select().from(auditLogs).where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.action, 'copilot_request')));
      expect(commits).toHaveLength(1); // Se o HTTP ainda estivesse dentro do RLS, esta reserva não estaria confirmada noutra ligação.
      const sent = String(init!.body); expect(sent).not.toMatch(/Projecto confidencial|5000000000|Análise muito reservada/); return response();
    });
    const invalid = await ask('modeling', { context: { entityId: modelA, revision: 999, consent: true } }); expect(invalid.statusCode, invalid.body).toBe(409); expect(provider).not.toHaveBeenCalled();
    const unconsented = await ask('modeling', { context: { entityId: modelA, revision: 1, consent: false } }); expect(unconsented.statusCode).toBe(400);
    const r = await ask('modeling', { context: { entityId: modelA, revision: 1, consent: true } }, viewer); expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ mode: 'ai', usedContext: true });
    expect(provider).toHaveBeenCalledTimes(1); const payload = JSON.parse(String(provider.mock.calls[0]![1]!.body)); expect(payload.instructions).toContain('authorizedNumericContext');
  });

  it('sem consentimento, com histórico extenso ou módulo retirado não existe chamada externa', async () => {
    enabled(); const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect((await ask('hr', { consent: false })).statusCode).toBe(400);
    expect((await ask('hr', { history: Array.from({ length: 7 }, () => ({ role: 'user', content: 'teste' })) })).statusCode).toBe(400);
    expect((await ask('hr', { context: { entityId: modelA, revision: 1, consent: true } })).statusCode).toBe(400);
    await getDb().update(modelingMembers).set({ enabled: false }).where(and(eq(modelingMembers.companyId, companyId), eq(modelingMembers.userId, viewerId)));
    expect((await ask('modeling', {}, viewer)).statusCode).toBe(403); expect(provider).not.toHaveBeenCalled();
  });

  it('duas perguntas concorrentes não ultrapassam a quota diária nem guardam o texto da conversa', async () => {
    enabled(); vi.stubEnv('KIANDA_COPILOT_DAILY_LIMIT', '1');
    await getDb().delete(auditLogs).where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.action, 'copilot_request')));
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const replies = await Promise.all([ask('hr', { question: 'Pergunta privada para teste' }), ask('hr', { question: 'Pergunta privada para teste' })]);
    expect(replies.map(r => r.statusCode).sort()).toEqual([200, 429]); expect(provider).toHaveBeenCalledTimes(1);
    const rows = await getDb().select().from(auditLogs).where(and(eq(auditLogs.companyId, companyId), eq(auditLogs.action, 'copilot_request'))); expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('Pergunta privada');
  });
});
