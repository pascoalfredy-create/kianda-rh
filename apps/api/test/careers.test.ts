import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, auditLogs, candidateEvents, candidates, closeDb, eq, files, getDb, jobOpenings, sql, subscriptions } from '@kianda/db';
import { luandaDate } from '@kianda/core';
import { fixtureWord } from '../../../packages/core/test/fixtures/document-import.js';
import { buildApp } from '../src/app.js';
import { setObjectStore } from '../src/services/storage.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
const cookie = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`, password = 'CarreirasSeguras2026abc';
let seq = 0;
async function register() {
  const n = seq++, r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Carreiras E2E ${n}`, nif: String(Number(stamp.slice(-10)) + n).padStart(10, '0') }, name: 'Responsável', email: `dona.${stamp}.${n}@careers.test`, password, modules: ['hr'] } });
  expect(r.statusCode, r.body).toBe(201); return { id: r.json().company.id as string, cookie: cookie(r) };
}
const applicant = (overrides = {}) => ({ name: 'Amélia Candidata', email: `pessoa.${seq++}.${stamp}@careers.test`, phone: '+244923000111', consent: true, cvUrl: 'https://example.com/cv.pdf', ...overrides });
const publicPath = (companyId: string, id: string) => `/v1/public/careers/${companyId}/openings/${id}`;
async function multipart(companyId: string, id: string, payload: object, bytes: Uint8Array, name = 'curriculo.pdf') {
  const form = new FormData(); form.set('data', JSON.stringify(payload)); form.set('cv', new Blob([Uint8Array.from(bytes)]), name);
  const request = new Request('http://local', { method: 'POST', body: form });
  return app.inject({ method: 'POST', url: `${publicPath(companyId, id)}/apply`, headers: { 'content-type': request.headers.get('content-type')! }, payload: new Uint8Array(await request.arrayBuffer()) });
}

afterEach(() => setObjectStore(null));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('publicação e portal de candidatura', () => {
  let owner: Awaited<ReturnType<typeof register>>, other: Awaited<ReturnType<typeof register>>, manager = '', finance = '', chiefId = '';
  const opening = async (overrides = {}, actor?: string) => {
    const r = await req(actor ?? owner.cookie, 'POST', '/v1/openings', { title: 'Analista financeiro', status: 'open', isPublic: true, description: 'Fecho mensal e análise de gestão.', requirements: 'Experiência em finanças.', salaryMin: 200000, salaryMax: 400000, positions: 2, hiringManagerId: chiefId, ...overrides });
    expect(r.statusCode, r.body).toBe(201); return r.json();
  };
  const apply = (companyId: string, id: string, data = applicant(), ip?: string) => app.inject({ method: 'POST', url: `${publicPath(companyId, id)}/apply`, payload: data, ...(ip ? { headers: { 'x-forwarded-for': ip } } : {}) });
  beforeAll(async () => {
    owner = await register(); other = await register();
    const e = await req(owner.cookie, 'POST', '/v1/employees', { number: '1', name: 'Chefia de recrutamento', jobTitle: 'Gestora', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 } });
    expect(e.statusCode, e.body).toBe(201); chiefId = e.json().id;
    for (const role of ['manager', 'finance']) {
      const email = `${role}.${stamp}@careers.test`;
      expect((await req(owner.cookie, 'POST', '/v1/users', { name: role, email, password, role, ...(role === 'manager' ? { employeeId: chiefId } : {}) })).statusCode).toBe(201);
      const session = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
      if (role === 'manager') manager = session; else finance = session;
    }
  });

  it('publica por PATCH sem perder os campos da vaga e entrega um link directo sem salários internos', async () => {
    const o = await opening({ status: 'draft', isPublic: false });
    expect(o.acceptingApplications).toBe(false);
    expect((await app.inject({ method: 'GET', url: publicPath(owner.id, o.id) })).statusCode).toBe(404);
    const published = await req(owner.cookie, 'PATCH', `/v1/openings/${o.id}`, { status: 'open', isPublic: true });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({ title: o.title, positions: 2, salaryMinMinor: 20000000, salaryMaxMinor: 40000000, hiringManagerId: chiefId, acceptingApplications: true, publicPath: `/carreiras/${owner.id}/vagas/${o.id}` });
    const publicOpening = (await app.inject({ method: 'GET', url: publicPath(owner.id, o.id) })).json();
    expect(publicOpening.opening).toMatchObject({ title: o.title, positions: 2, requirements: 'Experiência em finanças.' });
    for (const field of ['salaryMinMinor', 'salaryMaxMinor', 'hiringManagerId', 'createdBy', 'candidates']) expect(publicOpening.opening[field]).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: publicPath(other.id, o.id) })).statusCode).toBe(404);
    expect((await req(manager, 'PATCH', `/v1/openings/${o.id}`, { isPublic: false })).statusCode).toBe(403);
  });

  it('rascunho, vaga privada, suspensão, fecho e prazo vencido impedem consulta e submissão; último dia é válido', async () => {
    for (const state of [{ status: 'draft' }, { isPublic: false }, { status: 'on_hold' }, { status: 'closed' }, { closesOn: '2000-01-01' }]) {
      const o = await opening({ ...state, ...(state.closesOn ? { closesOn: null } : {}) });
      if (state.closesOn) await getDb().update(jobOpenings).set({ closesOn: state.closesOn }).where(eq(jobOpenings.id, o.id));
      expect((await app.inject({ method: 'GET', url: publicPath(owner.id, o.id) })).statusCode).toBe(404);
      expect((await apply(owner.id, o.id)).statusCode).toBe(404);
      const listing = (await app.inject({ method: 'GET', url: `/v1/public/careers/${owner.id}` })).json();
      expect(listing.openings.map((r: any) => r.id)).not.toContain(o.id);
    }
    const lastDay = await opening({ closesOn: luandaDate(new Date()) });
    expect((await apply(owner.id, lastDay.id)).statusCode).toBe(201);
  });

  it('recebe PDF e perfil profissional numa só candidatura, com histórico, consentimento e acesso privado ao CV', async () => {
    const o = await opening(), payload = applicant({ email: `AMELIA.${stamp}@careers.test`, cvUrl: null, profile: { currentRole: 'Contabilista', yearsExperience: 4, highestEducation: 'Licenciatura', fieldOfStudy: 'Gestão', linkedinUrl: 'https://example.com/amelia' }, expectedSalary: 350000, availableFrom: '2026-12-01' });
    const submitted = await multipart(owner.id, o.id, payload, new TextEncoder().encode('%PDF-1.4\nCV sintético'));
    expect(submitted.statusCode, submitted.body).toBe(201); expect(submitted.json()).toMatchObject({ ok: true, reference: expect.stringMatching(/^K-[0-9A-F]{8}$/) });
    expect(submitted.json().candidateId).toBeUndefined();
    const detail = (await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json(), c = detail.candidates[0];
    expect(c).toMatchObject({ email: payload.email.toLowerCase(), stage: 'applied', source: 'site', profile: payload.profile, expectedSalaryMinor: 35000000, availableFrom: '2026-12-01' }); expect(c.consentAt).toBeTruthy();
    const history = (await req(manager, 'GET', `/v1/candidates/${c.id}`)).json().events;
    expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ kind: 'stage', toStage: 'applied' });
    const docs = (await req(owner.cookie, 'GET', `/v1/files?entity=candidate&entityId=${c.id}`)).json().files;
    expect(docs).toHaveLength(1); expect(docs[0]).toMatchObject({ name: 'curriculo.pdf', mime: 'application/pdf' });
    expect((await req(manager, 'GET', `/v1/files/${docs[0].id}`)).statusCode).toBe(200);
    expect((await req(finance, 'GET', `/v1/files/${docs[0].id}`)).statusCode).toBe(404);
    expect((await req(other.cookie, 'GET', `/v1/files/${docs[0].id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/v1/files/${docs[0].id}` })).statusCode).toBe(401);
  });

  it('aceita Word DOCX e permite remover um anexo sem apagar a candidatura', async () => {
    const o = await opening(), r = await multipart(owner.id, o.id, applicant({ cvUrl: null }), fixtureWord([['Currículo de teste']]), 'curriculo.docx');
    expect(r.statusCode, r.body).toBe(201);
    const c = (await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates[0];
    const docs = (await req(owner.cookie, 'GET', `/v1/files?entity=candidate&entityId=${c.id}`)).json().files;
    expect(docs[0].mime).toContain('wordprocessingml');
    expect((await req(owner.cookie, 'DELETE', `/v1/files/${docs[0].id}`)).statusCode).toBe(200);
    expect((await req(owner.cookie, 'GET', `/v1/candidates/${c.id}`)).statusCode).toBe(200);
  });

  it('ficheiro inválido, excesso de tamanho, falta de CV, falta de consentimento e URL insegura não gravam candidatos', async () => {
    const o = await opening();
    expect((await multipart(owner.id, o.id, applicant(), new TextEncoder().encode('ficheiro disfarçado'), 'cv.pdf')).statusCode).toBe(415);
    const large = new Uint8Array(5 * 1024 * 1024 + 1); large.set(new TextEncoder().encode('%PDF'));
    expect((await multipart(owner.id, o.id, applicant(), large)).statusCode).toBe(413);
    expect((await apply(owner.id, o.id, applicant({ cvUrl: null }))).statusCode).toBe(400);
    for (const change of [{ consent: false }, { cvUrl: 'javascript:alert(1)' }, { profile: { linkedinUrl: 'data:text/html,teste' } }, { website: 'spam' }]) expect((await apply(owner.id, o.id, applicant(change))).statusCode).toBe(400);
    expect((await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates).toHaveLength(0);
  });

  it('pedidos concorrentes com o mesmo email não duplicam nem substituem a candidatura ou o CV', async () => {
    const o = await opening(), payload = applicant(), cv = new TextEncoder().encode('%PDF-1.4\nCV original');
    const replies = await Promise.all([multipart(owner.id, o.id, payload, cv), multipart(owner.id, o.id, payload, cv)]);
    expect(replies.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect((await apply(owner.id, o.id, { ...payload, name: 'Nome substituído', profile: { currentRole: 'Substituição indevida' } })).statusCode).toBe(409);
    const rows = (await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ name: payload.name, profile: {} });
    expect(await getDb().select().from(candidateEvents).where(eq(candidateEvents.candidateId, rows[0].id))).toHaveLength(1);
    expect(await getDb().select().from(files).where(eq(files.entityId, rows[0].id))).toHaveLength(1);
  });

  it('falha de armazenamento desfaz candidato, histórico e auditoria e limpa a cópia R2', async () => {
    const o = await opening(), removed: string[] = [];
    setObjectStore({ async put() { throw new Error('R2 sintético indisponível'); }, async get() { return null; }, async delete(keys) { removed.push(...keys); } });
    const r = await multipart(owner.id, o.id, applicant({ cvUrl: null }), new TextEncoder().encode('%PDF-1.4\nTeste rollback'));
    expect(r.statusCode).toBe(500); expect(removed).toHaveLength(1);
    expect((await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates).toHaveLength(0);
    expect(await getDb().select().from(auditLogs).where(and(eq(auditLogs.companyId, owner.id), eq(auditLogs.action, 'public_apply'), sql`after->>'openingId' = ${o.id}`))).toHaveLength(0);
  });

  it('etapa desactualizada e vaga fechada não avançam nem admitem; a admissão liga a ficha sem duplicar', async () => {
    const o = await opening(); expect((await apply(owner.id, o.id)).statusCode).toBe(201);
    const c = (await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates[0];
    expect((await req(manager, 'POST', `/v1/candidates/${c.id}/stage`, { stage: 'screening', expectedStage: 'applied' })).statusCode).toBe(200);
    expect((await req(manager, 'POST', `/v1/candidates/${c.id}/stage`, { stage: 'interview', expectedStage: 'applied' })).statusCode).toBe(409);
    expect((await req(manager, 'POST', `/v1/candidates/${c.id}/stage`, { stage: 'offer', expectedStage: 'screening' })).statusCode).toBe(200);
    expect((await req(owner.cookie, 'PATCH', `/v1/openings/${o.id}`, { status: 'closed' })).statusCode).toBe(200);
    expect((await req(manager, 'POST', `/v1/candidates/${c.id}/stage`, { stage: 'interview', expectedStage: 'offer' })).statusCode).toBe(409);
    const employee = { number: '2', name: 'Pessoa admitida', jobTitle: o.title, candidateId: c.id, contract: { type: 'indefinite', startDate: '2026-12-01', base: 300000 } };
    expect((await req(owner.cookie, 'POST', '/v1/employees', employee)).statusCode).toBe(409);
    expect((await req(owner.cookie, 'PATCH', `/v1/openings/${o.id}`, { status: 'open', isPublic: true })).statusCode).toBe(200);
    const hired = await req(owner.cookie, 'POST', '/v1/employees', employee); expect(hired.statusCode, hired.body).toBe(201);
    expect((await req(owner.cookie, 'GET', `/v1/candidates/${c.id}`)).json()).toMatchObject({ stage: 'hired', employeeId: hired.json().id });
    expect((await req(owner.cookie, 'POST', '/v1/employees', { ...employee, number: '3' })).statusCode).toBe(409);
  });

  it('eliminar dados de um candidato remove também os seus anexos', async () => {
    const o = await opening(); expect((await multipart(owner.id, o.id, applicant(), new TextEncoder().encode('%PDF-1.4\nCV a eliminar'))).statusCode).toBe(201);
    const c = (await req(owner.cookie, 'GET', `/v1/openings/${o.id}`)).json().candidates[0];
    expect((await req(owner.cookie, 'DELETE', `/v1/privacy/candidates/${c.id}`)).statusCode).toBe(200);
    expect(await getDb().select().from(files).where(eq(files.entityId, c.id))).toHaveLength(0);
    expect(await getDb().select().from(candidates).where(eq(candidates.id, c.id))).toHaveLength(0);
  });

  it('módulo RH sem escrita retira vagas públicas e impede candidaturas', async () => {
    const o = await opening();
    try {
      await getDb().update(subscriptions).set({ status: 'expired', trialEndsAt: '2000-01-01', paidUntil: null }).where(eq(subscriptions.companyId, owner.id));
      expect((await app.inject({ method: 'GET', url: publicPath(owner.id, o.id) })).statusCode).toBe(404);
      expect((await apply(owner.id, o.id)).statusCode).toBe(404);
    } finally { await getDb().update(subscriptions).set({ status: 'active', paidUntil: '2099-12-31' }).where(eq(subscriptions.companyId, owner.id)); }
  });

  it('valida chefia de outra empresa, prazo de publicação e limites salariais na edição parcial', async () => {
    const invalid = await req(other.cookie, 'POST', '/v1/openings', { title: 'Vaga inválida', hiringManagerId: chiefId }); expect(invalid.statusCode).toBe(400);
    expect((await req(owner.cookie, 'POST', '/v1/openings', { title: 'Prazo vencido', status: 'open', isPublic: true, closesOn: '2000-01-01' })).statusCode).toBe(400);
    const o = await opening(); expect((await req(owner.cookie, 'PATCH', `/v1/openings/${o.id}`, { salaryMin: 500000 })).statusCode).toBe(400);
  });

  it('reserva o último lugar da quota pública em concorrência, sem gravar uma segunda candidatura', async () => {
    const co = await register(), r = await req(co.cookie, 'POST', '/v1/openings', { title: 'Quota pública', status: 'open', isPublic: true }); expect(r.statusCode).toBe(201);
    await getDb().insert(auditLogs).values(Array.from({ length: 199 }, () => ({ companyId: co.id, actorId: 'fixture', action: 'public_apply', entity: 'candidate', entityId: randomUUID(), after: { ipHash: 'outro' } })));
    const replies = await Promise.all([apply(co.id, r.json().id), apply(co.id, r.json().id)]);
    expect(replies.map(x => x.statusCode).sort()).toEqual([201, 429]);
    expect((await req(co.cookie, 'GET', `/v1/openings/${r.json().id}`)).json().candidates).toHaveLength(1);
  });

  it('a quota por IP não impede outro candidato de uma origem diferente', async () => {
    const co = await register(), r = await req(co.cookie, 'POST', '/v1/openings', { title: 'Quota por origem', status: 'open', isPublic: true }); expect(r.statusCode).toBe(201);
    const ipHash = createHash('sha256').update(`${co.id}|local`).digest('hex');
    await getDb().insert(auditLogs).values(Array.from({ length: 30 }, () => ({ companyId: co.id, actorId: 'fixture', action: 'public_apply', entity: 'candidate', entityId: randomUUID(), after: { ipHash } })));
    expect((await apply(co.id, r.json().id)).statusCode).toBe(429);
    expect((await apply(co.id, r.json().id, applicant(), '203.0.113.7')).statusCode).toBe(201);
  });
});
