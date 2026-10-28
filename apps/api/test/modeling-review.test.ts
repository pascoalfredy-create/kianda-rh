import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, auditLogs, closeDb, companyModules, eq, getDb, hashPassword, modelingMembers, platformAdmins, provisionModelingReview, users } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('acompanhamento de produção sem activar clientes', () => {
  const stamp = `${Date.now()}review`;
  let counter = 0;
  type Owner = { companyId: string; id: string; email: string };
  let owner: Owner, client: Owner, fixtureHash = '';
  async function register(email = `${stamp}${counter}@review.ao`): Promise<Owner> {
    counter++;
    const result = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Acompanhamento ' + counter, nif: String(Date.now() + 14000 + counter).slice(-10) }, email, name: 'Administrador ' + counter, password: 'AcompanhamentoSeguro2026abc' } });
    expect(result.statusCode).toBe(201);
    const token = result.cookies.find(c => c.name === 'kianda_session')!;
    const me = (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: `kianda_session=${token.value}` } })).json();
    return { companyId: me.company.id, id: me.user.sub, email };
  }
  const grant = async (companyId: string) => (await getDb().select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, 'modeling'))))[0];
  beforeAll(async () => { fixtureHash = await hashPassword('AcompanhamentoSeguro2026abc'); owner = await register(); client = await register(); });
  it('não infere o destinatário quando não há configuração ou há vários administradores', async () => {
    for (const config of ['', 'valor-invalido', `${owner.email},${client.email}`]) expect((await provisionModelingReview(getDb(), config)).status).toBe('skipped');
    expect(await grant(owner.companyId)).toBeUndefined(); expect(await grant(client.companyId)).toBeUndefined();
  });
  it('exige um proprietário activo que já seja administrador da plataforma', async () => {
    expect(await provisionModelingReview(getDb(), owner.email)).toMatchObject({ status: 'skipped', reason: 'account' });
    const email = `${stamp}finance@review.ao`;
    await getDb().insert(users).values({ companyId: client.companyId, email, name: 'Finanças', role: 'finance', passwordHash: fixtureHash });
    await getDb().insert(platformAdmins).values({ email });
    expect(await provisionModelingReview(getDb(), email)).toMatchObject({ status: 'skipped', reason: 'account' });
  });
  it('activa só a empresa do administrador único, com cinco acessos e auditoria sem facturação', async () => {
    await getDb().insert(platformAdmins).values({ email: owner.email });
    expect(await provisionModelingReview(getDb(), owner.email)).toMatchObject({ status: 'created', companyId: owner.companyId, userId: owner.id, projectLimit: 20 });
    expect(await grant(owner.companyId)).toMatchObject({ enabled: true, status: 'active', projectLimit: 20, extraUsers: 0 });
    expect(await grant(client.companyId)).toBeUndefined();
    const members = await getDb().select().from(modelingMembers).where(eq(modelingMembers.companyId, owner.companyId));
    expect(members).toHaveLength(1); expect(members[0]).toMatchObject({ userId: owner.id, enabled: true, permission: 'editor' });
    expect((await provisionModelingReview(getDb(), owner.email)).status).toBe('preserved');
    const audits = await getDb().select().from(auditLogs).where(and(eq(auditLogs.companyId, owner.companyId), eq(auditLogs.action, 'module_subscription')));
    expect(audits).toHaveLength(1); expect(audits[0]!.after).toMatchObject({ purpose: 'product_owner_review', invoiced: false, includedUsers: 5 });
  });
  it('não reactiva uma licença existente nem substitui a sua quota', async () => {
    await getDb().insert(platformAdmins).values({ email: client.email });
    await getDb().insert(companyModules).values({ companyId: client.companyId, module: 'modeling', enabled: false, status: 'suspended', projectLimit: 3 });
    expect((await provisionModelingReview(getDb(), client.email)).status).toBe('preserved');
    expect(await grant(client.companyId)).toMatchObject({ enabled: false, status: 'suspended', projectLimit: 3 });
    expect(await getDb().select().from(modelingMembers).where(eq(modelingMembers.companyId, client.companyId))).toHaveLength(0);
  });
  it('não escolhe uma empresa arbitrária se o mesmo email tem duas contas de proprietário', async () => {
    const email = `${stamp}ambiguous@review.ao`, first = await register(email), second = await register(email);
    await getDb().insert(platformAdmins).values({ email });
    expect(await provisionModelingReview(getDb(), email)).toMatchObject({ status: 'skipped', reason: 'account' });
    expect(await grant(first.companyId)).toBeUndefined(); expect(await grant(second.companyId)).toBeUndefined();
  });
  it('não ultrapassa cinco utilizadores nem reactiva uma participação desactivada', async () => {
    const full = await register(); await getDb().insert(platformAdmins).values({ email: full.email });
    const people = await getDb().insert(users).values(Array.from({ length: 5 }, (_, i) => ({ companyId: full.companyId, name: `Pessoa ${i}`, email: `${stamp}member${i}@review.ao`, passwordHash: fixtureHash }))).returning();
    await getDb().insert(modelingMembers).values(people.map(person => ({ companyId: full.companyId, userId: person.id, addedBy: full.id })));
    expect(await provisionModelingReview(getDb(), full.email)).toMatchObject({ status: 'skipped', reason: 'capacity' }); expect(await grant(full.companyId)).toBeUndefined();
    const disabled = await register(); await getDb().insert(platformAdmins).values({ email: disabled.email });
    await getDb().insert(modelingMembers).values({ companyId: disabled.companyId, userId: disabled.id, addedBy: disabled.id, enabled: false });
    expect(await provisionModelingReview(getDb(), disabled.email)).toMatchObject({ status: 'skipped', reason: 'member_permission' }); expect(await grant(disabled.companyId)).toBeUndefined();
  });
});
