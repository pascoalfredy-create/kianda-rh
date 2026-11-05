import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, candidates, closeDb, eq, getDb, recruitmentMail, recruitmentOffers, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { dispatchRecruitmentMail } from '../src/services/recruitment-mail.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false })), db = () => getDb();
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`, password = 'Recrutamento2026seguro';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('notificações, negociação salarial e ATS', () => {
  let owner = '', other = '', finance = '', companyId = '', otherId = '', job = '', seq = 0;
  const details = async (id: string) => (await req(owner, 'GET', `/v1/candidates/${id}`)).json();
  const person = async (email: string | null = `candidato.${seq++}.${stamp}@automation.test`) => {
    const r = await req(owner, 'POST', `/v1/openings/${job}/candidates`, { name: 'Candidato Sintético', email, expectedSalary: 350000 }); expect(r.statusCode, r.body).toBe(201); return r.json().id as string;
  };
  const stage = (id: string, value: string, reason?: string) => req(owner, 'POST', `/v1/candidates/${id}/stage`, { stage: value, reason });
  const offer = (id: string, overrides = {}) => req(owner, 'POST', `/v1/candidates/${id}/offers`, { kind: 'counteroffer', base: 300000, meal: 30000, transport: 20000, validUntil: '2099-12-31', startDate: '2026-12-01', terms: 'Condições sintéticas para testes.', ...overrides });
  beforeAll(async () => {
    for (const n of [1, 2]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Automação ${n}`, nif: String(Number(stamp.slice(-10)) + n).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${n}@recruitment-automation.test`, password, modules: ['hr'] } });
      expect(r.statusCode, r.body).toBe(201); if (n === 1) { owner = cookie(r); companyId = r.json().company.id; } else { other = cookie(r); otherId = r.json().company.id; }
    }
    const email = `finance.${stamp}@automation.test`;
    expect((await req(owner, 'POST', '/v1/users', { name: 'Financeiro', role: 'finance', email, password })).statusCode).toBe(201);
    finance = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
    const r = await req(owner, 'POST', '/v1/openings', { title: 'Analista com Excel', status: 'open', isPublic: true, atsCriteria: [{ kind: 'skill', label: 'Excel', weight: 60, required: true }, { kind: 'experience', label: 'Experiência na função', minimumYears: 3, weight: 40, required: true }] });
    expect(r.statusCode, r.body).toBe(201); job = r.json().id;
  });

  it('gera uma notificação por transição e não envia comentários nem motivos internos', async () => {
    const id = await person();
    for (const value of ['screening', 'interview', 'assessment', 'offer', 'rejected', 'screening', 'withdrawn']) expect((await stage(id, value, 'Nota interna reservada')).statusCode).toBe(200);
    const c = await details(id); expect(c.notifications).toHaveLength(8); expect(c.events.filter((e: any) => e.kind === 'stage')).toHaveLength(8);
    expect((await req(owner, 'POST', `/v1/candidates/${id}/events`, { kind: 'comment', text: 'Comentário muito reservado' })).statusCode).toBe(201);
    const messages = await db().select().from(recruitmentMail).where(eq(recruitmentMail.candidateId, id));
    expect(JSON.stringify(messages.map(m => m.payload))).not.toMatch(/Nota interna reservada|Comentário muito reservado/);
    expect(new Set(messages.map(m => m.dedupeKey)).size).toBe(8);
    expect((await stage(id, 'withdrawn')).statusCode).toBe(409); expect((await details(id)).notifications).toHaveLength(8);
  });

  it('duas transições concorrentes da mesma origem criam só um evento e um aviso', async () => {
    const id = await person();
    const replies = await Promise.all([1, 2].map(() => req(owner, 'POST', `/v1/candidates/${id}/stage`, { stage: 'interview', expectedStage: 'applied' })));
    expect(replies.map(r => r.statusCode).sort()).toEqual([200, 409]); expect((await details(id)).notifications).toHaveLength(2);
  });

  it('a recepção pública também enfileira a confirmação e o duplicado não repete o aviso', async () => {
    const data = { name: 'Pessoa Pública', email: `portal.${stamp}@automation.test`, phone: '+244923000111', consent: true, cvUrl: 'https://example.com/cv.pdf', profile: { skills: ['Excel'], yearsExperience: 4 } };
    const url = `/v1/public/careers/${companyId}/openings/${job}/apply`;
    expect((await app.inject({ method: 'POST', url, payload: data })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url, payload: data })).statusCode).toBe(409);
    const [x] = await db().select().from(candidates).where(and(eq(candidates.companyId, companyId), eq(candidates.email, data.email)));
    const c = await details(x!.id); expect(c.notifications).toHaveLength(1); expect(c.ats.foundWeight).toBe(100);
  });

  it('pessoas sem email têm estado explícito e o ATS preserva informação desconhecida', async () => {
    const id = await person(null), c = await details(id); expect(c.notifications[0].status).toBe('no_address'); expect(c.ats).toMatchObject({ foundWeight: 0, unknownWeight: 100 });
    const r = await req(owner, 'PATCH', `/v1/candidates/${id}/profile`, { profile: { skills: ['Excel'], yearsExperience: 1 }, cvText: 'Utilizo Excel em análise de dados.', cvTextSource: 'curriculo.pdf' });
    expect(r.statusCode, r.body).toBe(200); expect((await details(id)).ats).toMatchObject({ foundWeight: 60, unknownWeight: 0 });
    expect((await req(owner, 'PATCH', `/v1/candidates/${id}/profile`, { cvText: null })).statusCode).toBe(200); expect((await details(id)).cvText).toBeNull();
  });

  it('rejeita critérios pessoais e pesos incompletos; publicar não elimina critérios guardados', async () => {
    for (const criterion of [{ kind: 'skill', label: 'Idade até 30', weight: 100, required: true }, { kind: 'skill', label: 'Excel', weight: 40, required: true }]) expect((await req(owner, 'PATCH', `/v1/openings/${job}`, { atsCriteria: [criterion] })).statusCode).toBe(400);
    const r = await req(owner, 'PATCH', `/v1/openings/${job}`, { isPublic: false }); expect(r.statusCode, r.body).toBe(200); expect(r.json().atsCriteria).toHaveLength(2);
  });

  it('aceitar pretensão exige confirmação de base bruta e conserva o valor original nas versões', async () => {
    const id = await person(); await stage(id, 'offer');
    expect((await offer(id, { kind: 'accept_expected' })).statusCode).toBe(400);
    const first = await offer(id, { kind: 'accept_expected', expectedBasis: 'gross_base' }); expect(first.statusCode, first.body).toBe(201); expect(first.json()).toMatchObject({ baseMinor: 35000000, expectedSalaryMinor: 35000000, version: 1, status: 'draft' });
    const second = await offer(id); expect(second.statusCode, second.body).toBe(201); expect(second.json()).toMatchObject({ baseMinor: 30000000, version: 2 });
    const c = await details(id); expect(c.expectedSalaryMinor).toBe(35000000); expect(c.offers[1].status).toBe('superseded'); expect(c.canHire).toBe(false);
  });

  it('enviar a mesma proposta duas vezes apenas cria uma mensagem e o candidato pode contrapropor', async () => {
    const id = await person(); await stage(id, 'offer'); const o = (await offer(id)).json();
    for (const n of [1, 2]) expect((await req(owner, 'POST', `/v1/candidates/${id}/offers/${o.id}/send`, { replyTo: 'rh@example.test' })).statusCode).toBe(200);
    const c = await details(id); expect(c.notifications.filter((m: any) => m.kind === 'recruitment_offer')).toHaveLength(1);
    expect((await req(owner, 'POST', `/v1/candidates/${id}/offers/${o.id}/response`, { status: 'countered', counter: 325000, note: 'Email do candidato recebido hoje.' })).statusCode).toBe(200);
    expect((await details(id)).offers[0]).toMatchObject({ status: 'countered', counterMinor: 32500000 });
    expect((await req(owner, 'POST', `/v1/candidates/${id}/offers/${o.id}/response`, { status: 'accepted', note: 'Resposta repetida' })).statusCode).toBe(409);
  });

  it('admissão exige o acordo e leva a remuneração aceite sem alterar a pretensão', async () => {
    const id = await person(); await stage(id, 'offer'); const o = (await offer(id)).json();
    const payload = { number: `adm-${seq++}`, name: 'Admitido Sintético', jobTitle: 'Analista', candidateId: id, contract: { type: 'indefinite', startDate: '2026-12-01', base: 300000, meal: 30000, transport: 20000 } };
    expect((await req(owner, 'POST', '/v1/employees', payload)).json().error).toBe('acordo_pendente');
    expect((await req(owner, 'POST', `/v1/candidates/${id}/offers/${o.id}/response`, { status: 'accepted', note: 'Aceitação por email confirmada pelo RH.' })).statusCode).toBe(200);
    expect((await req(owner, 'POST', '/v1/employees', { ...payload, contract: { ...payload.contract, base: 350000 } })).json().error).toBe('salario_divergente');
    const admitted = await req(owner, 'POST', '/v1/employees', payload); expect(admitted.statusCode, admitted.body).toBe(201);
    const c = await details(id); expect(c).toMatchObject({ stage: 'hired', expectedSalaryMinor: 35000000 }); expect(c.notifications).toHaveLength(3);
  });

  it('permissões, RLS e eliminação abrangem propostas, mensagens e texto do CV', async () => {
    const id = await person(); await stage(id, 'offer'); await offer(id);
    expect((await req(finance, 'POST', `/v1/candidates/${id}/offers`, { kind: 'counteroffer', base: 300000, validUntil: '2099-01-01' })).statusCode).toBe(403);
    expect((await req(other, 'GET', `/v1/candidates/${id}`)).statusCode).toBe(404);
    await withTenant(otherId, async () => { expect(await db().select().from(recruitmentOffers).where(eq(recruitmentOffers.candidateId, id))).toEqual([]); expect(await db().select().from(recruitmentMail).where(eq(recruitmentMail.candidateId, id))).toEqual([]); });
    expect((await req(owner, 'DELETE', `/v1/privacy/candidates/${id}`)).statusCode).toBe(200);
    expect(await db().select().from(recruitmentOffers).where(eq(recruitmentOffers.candidateId, id))).toEqual([]); expect(await db().select().from(recruitmentMail).where(eq(recruitmentMail.candidateId, id))).toEqual([]);
  });

  it('a caixa de saída repete com a mesma chave e dois dispatchers não enviam o mesmo item', async () => {
    await db().update(recruitmentMail).set({ nextAttemptAt: new Date('2099-01-01') }).where(eq(recruitmentMail.companyId, companyId));
    const id = await person();
    vi.stubEnv('RESEND_API_KEY', 'teste-sem-chave-real'); vi.stubEnv('MAIL_FROM', 'noreply@example.test');
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('indisponível', { status: 503 })).mockResolvedValue(new Response(JSON.stringify({ id: 'resend-sintetico' }), { status: 200 }));
    expect((await dispatchRecruitmentMail(db(), 10, new Date(), companyId)).failed).toBe(1);
    const first = (await details(id)).notifications[0]; expect(first.status).toBe('pending');
    const future = new Date(Date.now() + 10 * 60000);
    const replies = await Promise.all([dispatchRecruitmentMail(db(), 10, future, companyId), dispatchRecruitmentMail(db(), 10, future, companyId)]);
    expect(replies.reduce((n, r) => n + r.sent, 0)).toBe(1); expect(provider).toHaveBeenCalledTimes(2);
    const keys = provider.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)['Idempotency-Key']); expect(keys[0]).toBe(keys[1]);
    expect((await details(id)).notifications[0].status).toBe('sent');
  });

  it('uma entrega incerta com mais de 23 horas requer verificação, sem reenvio automático', async () => {
    const id = await person();
    await db().update(recruitmentMail).set({ status: 'sending', firstAttemptAt: new Date(Date.now() - 24 * 3600000), nextAttemptAt: new Date(Date.now() - 60000) }).where(eq(recruitmentMail.candidateId, id));
    vi.stubEnv('RESEND_API_KEY', 'teste-sem-chave-real'); vi.stubEnv('MAIL_FROM', 'noreply@example.test');
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'synthetic' })));
    await dispatchRecruitmentMail(db(), 10, new Date(), companyId); expect(provider).not.toHaveBeenCalled(); expect((await details(id)).notifications[0].status).toBe('delivery_unknown');
  });
});
