import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, companies, users, eq, auditLogs } from '@kianda/db';
import { platformCookie } from './platform-admin.js';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }), { confirmEmails: false });
afterAll(async () => {
  await app.close();
  if (process.env.DATABASE_URL) await closeDb();
});
const payload = {
  company: { name: 'Kwanza', nif: '5002555555' },
  name: 'Teste',
  email: 'cadastro.validacao@kianda.test',
  password: 'CadastroSeguro2026',
  acceptTerms: true,
};

describe('validação pública antes da gravação', () => {
  it('rejeita o exemplo reportado e nomes numéricos sem consultar a base de dados', async () => {
    for (const name of ['Teste', ' TEST ', '123456']) {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { ...payload, name } });
      expect(response.statusCode).toBe(400);
      expect(response.json().issues.some((issue: { path: string }) => issue.path === 'name')).toBe(true);
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)('revisão de cadastro', () => {
  it('mantém a revisão após confirmação de email e impede contornar pelo corpo do registo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        ...payload,
        name: 'Pascoal Frederico',
        registrationReviewReasons: [],
        company: {
          ...payload.company,
          registrationReviewReasons: [],
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json().company.id;
    const cookie = `kianda_session=${response.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const [company] = await getDb().select().from(companies).where(eq(companies.id, id));
    expect(company!.registrationReviewReasons).toHaveLength(1);
    await getDb().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, response.json().user.id));
    for (const url of ['/v1/employees', '/v1/modeling/bootstrap', '/v1/valuation/bootstrap']) {
      const blocked = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toBe('cadastro_em_revisao');
    }
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/platform/companies/${id}/registration-review`,
      headers: { cookie },
      payload: { note: 'Aprovar conta própria' },
    });
    expect(denied.statusCode).toBe(403);
    const adminCookie = await platformCookie(app, 'revisao.admin@kianda.test');
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/platform/companies/${id}/registration-review`,
      headers: { cookie: adminCookie },
      payload: { note: 'Dados confirmados com o responsável.' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const decision = await getDb().select().from(auditLogs).where(eq(auditLogs.action, 'approve_registration'));
    expect(decision.some(row => row.entityId === id && row.actorId)).toBe(true);
    const allowed = await app.inject({ method: 'GET', url: '/v1/employees', headers: { cookie } });
    expect(allowed.statusCode, allowed.body).toBe(200);
    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { ...payload, name: 'Pascoal Frederico', email: 'cadastro.duplicado@kianda.test' },
    });
    expect(duplicate.statusCode).toBe(409);
  });
});
