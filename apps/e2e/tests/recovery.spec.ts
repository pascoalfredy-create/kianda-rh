import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, closePool, registerCompany, sql } from './support.js';

test.skip(!process.env.RECOVERY_OBJECTS, 'Ensaio reservado ao ambiente de recuperação.');
test.afterAll(closePool);

test('base recuperada: login, anexo restaurado e isolamento entre empresas', async ({ playwright }) => {
  const first = await registerCompany({ modules: ['hr'] });
  const second = await registerCompany({ modules: ['hr'] });
  const a = await playwright.request.newContext({ baseURL: API });
  const b = await playwright.request.newContext({ baseURL: API });
  try {
    for (const [api, company] of [[a, first], [b, second]] as const) {
      const login = await api.post('/v1/auth/login', { data: { email: company.email, password: PASSWORD } });
      expect(login.status()).toBe(200);
      expect((await (await api.get('/v1/auth/me')).json()).company.id).toBe(company.id);
    }
    const [employee] = await sql<{ id: string }>(
      "insert into employees(company_id,number,name,job_title) values ($1,'1','Colaborador sintético','Ensaio') returning id", [first.id]);
    const expected = Buffer.from('%PDF-1.7\nEnsaio isolado\n');
    const uploaded = await a.post('/v1/files', {
      params: { entity: 'employee', entityId: employee!.id, name: 'ensaio.pdf' },
      headers: { 'content-type': 'application/pdf' }, data: expected,
    });
    expect(uploaded.status()).toBe(201);
    const { id } = await uploaded.json();
    const document = await a.get('/v1/files/' + id);
    expect(document.status()).toBe(200);
    expect(createHash('sha256').update(await document.body()).digest('hex'))
      .toBe(createHash('sha256').update(expected).digest('hex'));
    expect((await b.get('/v1/files/' + id)).status()).toBe(404);
    const existing = await sql<{ id: string }>(
      'select id from files where company_id <> $1 and company_id <> $2 limit 1', [first.id, second.id]);
    if (existing.length) expect((await a.get('/v1/files/' + existing[0]!.id)).status()).toBe(404);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
