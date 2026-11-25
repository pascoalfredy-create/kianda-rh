import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogs, closeDb, companies, eq, getDb, users } from '@kianda/db';
import { registrationChecklist } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { platformCookie } from './platform-admin.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
const messages: { to: string | string[]; subject: string; text: string }[] = [];
let sequence = 0;
const tail = () => `${Date.now()}${sequence++}`.slice(-6);
/** NIF com seis zeros seguidos (vai para revisão) e NIF normal, únicos por execução. */
const unusualNif = () => `${tail().slice(-4)}000000`;
const normalNif = () => `5${`${Date.now()}${sequence++}`.slice(-9)}`;
const register = (nif: string, email = `dono.${tail()}@cadastro.test`) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      company: { name: 'Lunda Serviços', nif },
      name: 'Ana Mateus',
      email,
      password: 'CadastroSeguro2026',
      acceptTerms: true,
    },
  });
const cookieOf = (r: Awaited<ReturnType<typeof register>>) => ({
  cookie: `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`,
});
const tokenFrom = (subject: string) =>
  new URL(
    messages.findLast(m => m.subject === subject)!.text.match(/https:\/\/kianda\.test\/confirmar-email\?token=\S+/)![0],
  ).searchParams.get('token')!;

afterAll(async () => {
  await app.close();
  if (process.env.DATABASE_URL) await closeDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  messages.length = 0;
  vi.stubEnv('RESEND_API_KEY', 'chave-sintetica');
  vi.stubEnv('MAIL_FROM', 'Kianda <nao-responder@kianda.test>');
  vi.stubEnv('APP_BASE_URL', 'https://kianda.test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      messages.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 'email-sintetico' }), { status: 200 });
    }),
  );
});

describe('lista de pontos do cadastro', () => {
  it('só o NIF e os nomes provisórios bloqueiam; o email é sempre um aviso', () => {
    const list = registrationChecklist({
      companyName: 'Lunda Serviços',
      nif: '5000000012',
      ownerName: 'Ana Mateus',
      ownerEmail: 'teste@lunda.ao',
      inReview: true,
    });
    expect(list.map(i => [i.key, i.status, i.blocking])).toEqual([
      ['nif', 'pending', true],
      ['ownerName', 'ok', true],
      ['ownerEmail', 'invalid', false],
    ]);
    const legacy = registrationChecklist({
      companyName: 'Teste',
      nif: '5417263098',
      ownerName: 'Demo',
      ownerEmail: 'ana@lunda.ao',
      inReview: true,
    });
    expect(legacy.filter(i => i.blocking && i.status !== 'ok').map(i => i.key)).toEqual(['companyName', 'ownerName']);
    // Revisão sem motivo que o cliente possa corrigir: fica um ponto para a equipa.
    expect(
      registrationChecklist({
        companyName: 'Lunda',
        nif: '5417263098',
        ownerName: 'Ana Mateus',
        ownerEmail: 'ana@lunda.ao',
        inReview: true,
      })[0],
    ).toMatchObject({ key: 'review', blocking: true, status: 'pending' });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('correcções do cliente e aprovação', () => {
  it('o cliente vê os motivos, corrige o NIF e fica desbloqueado; a equipa é avisada', async () => {
    await platformCookie(app, `cadastro.aviso.${tail()}@kianda.test`);
    const r = await register(unusualNif());
    expect(r.statusCode, r.body).toBe(201);
    const h = cookieOf(r),
      id = r.json().company.id;
    const welcome = messages.find(m => m.subject === 'Bem-vindo ao Kianda — cadastro por confirmar')!;
    expect(welcome.text).toContain('NIF');
    expect(welcome.text).toContain('bloqueia o acesso');
    const list = await app.inject({ method: 'GET', url: '/v1/registration', headers: h });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json()).toMatchObject({ inReview: true, blocking: 1, canEdit: true });
    expect(list.json().items[0]).toMatchObject({ key: 'nif', status: 'pending', blocking: true });
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: h })).statusCode).toBe(403);

    const unusual = await app.inject({
      method: 'POST',
      url: '/v1/registration/nif',
      headers: h,
      payload: { nif: '1111111234' },
    });
    expect(unusual.statusCode).toBe(400);
    expect(unusual.json().error).toBe('nif_invulgar');
    const other = await register(normalNif());
    expect(other.statusCode, other.body).toBe(201);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/registration/nif',
      headers: h,
      payload: { nif: other.json().company.nif },
    });
    expect(duplicate.statusCode).toBe(409);

    const nif = normalNif();
    const fixed = await app.inject({ method: 'POST', url: '/v1/registration/nif', headers: h, payload: { nif } });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json()).toMatchObject({ resolved: true, inReview: false, blocking: 0 });
    const [company] = await getDb().select().from(companies).where(eq(companies.id, id));
    expect(company).toMatchObject({ nif, registrationReviewReasons: [] });
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: h })).statusCode).toBe(200);
    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audit.map(a => a.action)).toEqual(
      expect.arrayContaining(['registration_nif_corrected', 'registration_resolved_by_client']),
    );
    expect(messages.some(m => m.subject === 'Cadastro corrigido pelo cliente — Lunda Serviços')).toBe(true);
    // Depois de aprovado, o NIF só muda pelo suporte.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/registration/nif',
      headers: h,
      payload: { nif: normalNif() },
    });
    expect(again.statusCode).toBe(409);
  });

  it('a aprovação pela equipa envia o email ao cliente com o que ainda falta', async () => {
    const r = await register(unusualNif());
    const id = r.json().company.id;
    await getDb().update(users).set({ email: 'teste@lunda.ao' }).where(eq(users.id, r.json().user.id));
    const admin = await platformCookie(app, `cadastro.lista.${tail()}@kianda.test`);
    const ficha = await app.inject({
      method: 'GET',
      url: `/v1/platform/companies?id=${id}`,
      headers: { cookie: admin },
    });
    const checklist = ficha.json().companies[0].registrationChecklist;
    expect(checklist.map((i: { key: string }) => i.key)).toEqual(['nif', 'ownerName', 'ownerEmail']);
    expect(checklist[2]).toMatchObject({ status: 'invalid', blocking: false });
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/platform/companies/${id}/registration-review`,
      headers: { cookie: admin },
      payload: { note: 'NIF confirmado pela certidão da AGT.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const mail = messages.find(m => m.subject === 'Cadastro aprovado — Lunda Serviços')!;
    expect(mail.to).toEqual(['teste@lunda.ao']);
    expect(mail.text).toContain('Falta ainda: email do proprietário');
  });

  it('o novo email só substitui o actual depois de confirmado, e o antigo é avisado', async () => {
    const r = await register(normalNif(), `teste.${tail()}@lunda.ao`);
    const h = cookieOf(r),
      userId = r.json().user.id,
      old = r.json().user.email;
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/registration/email',
      headers: h,
      payload: { email: 'ana.mateus@lunda.ao', password: 'errada' },
    });
    expect(wrong.statusCode).toBe(400);
    const testEmail = await app.inject({
      method: 'POST',
      url: '/v1/registration/email',
      headers: h,
      payload: { email: 'demo@lunda.ao', password: 'CadastroSeguro2026' },
    });
    expect(testEmail.statusCode).toBe(400);
    const asked = await app.inject({
      method: 'POST',
      url: '/v1/registration/email',
      headers: h,
      payload: { email: 'Ana.Mateus@lunda.ao', password: 'CadastroSeguro2026' },
    });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json().items.find((i: { key: string }) => i.key === 'ownerEmail')).toMatchObject({
      status: 'pending',
    });
    expect((await getDb().select().from(users).where(eq(users.id, userId)))[0]!.email).toBe(old);
    const token = tokenFrom('Confirme o novo email — Kianda');
    const confirmed = await app.inject({
      method: 'POST',
      url: '/v1/public/email-verification',
      payload: { token },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).not.toHaveProperty('previous');
    expect((await getDb().select().from(users).where(eq(users.id, userId)))[0]!.email).toBe('ana.mateus@lunda.ao');
    expect(messages.find(m => m.subject === 'O email da sua conta Kianda foi alterado')!.to).toEqual([old]);
    const after = await app.inject({ method: 'GET', url: '/v1/registration', headers: h });
    expect(after.json().items.find((i: { key: string }) => i.key === 'ownerEmail')).toMatchObject({ status: 'ok' });
  });
});
