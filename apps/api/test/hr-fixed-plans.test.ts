import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, employees, eq, getDb, paymentRequests, platformAdmins, sql, subscriptions, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { applyGatewayPayment, attachGatewayReference } from '../src/services/billing.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('RH: apenas faixas fixas, sem cobrança por colaborador', () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let cookie = '', companyId = '', actorId = '', legacyId = '';
  const request = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  beforeAll(async () => {
    const email = `${stamp}@hr-fixed-plans.test`;
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Faixas RH sintéticas', nif: stamp.slice(-10) }, name: 'Responsável', email, password: 'FaixasFixas2026abc', modules: ['hr'] } });
    expect(r.statusCode).toBe(201); companyId = r.json().company.id; actorId = r.json().user.id;
    cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    await getDb().insert(platformAdmins).values({ email });
    await withTenant(companyId, async () => {
      await getDb().insert(employees).values(Array.from({ length: 100 }, (_, i) => ({ companyId, number: String(i + 1), name: `Pessoa sintética ${i + 1}`, jobTitle: 'Técnico' })));
      // Dados legados nunca podem voltar a aumentar o limite ou o preço da faixa.
      await getDb().update(subscriptions).set({ extraSeats: 50 }).where(eq(subscriptions.companyId, companyId));
      const [legacy] = await getDb().insert(paymentRequests).values({ companyId, number: `PF-LEGACY-${stamp}`, kind: 'extra_seats', seats: 10, grossMinor: 3000000, amountMinor: 3000000, gateway: 'proxypay', gatewayReference: stamp.slice(-9), createdBy: actorId }).returning();
      legacyId = legacy!.id;
      await getDb().insert(paymentRequests).values({ companyId, number: `PF-HISTORY-${stamp}`, kind: 'extra_seats', seats: 2, amountMinor: 600000, status: 'paid', paidAt: new Date(), invoiceRef: 'FT histórica', createdBy: actorId });
    });
  });

  it('recusa novos extras e aplica o limite de 100, mesmo havendo extras na licença antiga', async () => {
    const billing = (await request('GET', '/v1/billing')).json();
    expect(billing).toMatchObject({ activeEmployees: 100, limit: 100 });
    expect(billing).not.toHaveProperty('extraSeatMinor'); expect(billing).not.toHaveProperty('extraSeats');
    expect(billing.prices).toHaveLength(5);
    expect((await request('POST', '/v1/billing/requests', { kind: 'extra_seats', seats: 1 })).statusCode).toBe(400);
    const over = await request('POST', '/v1/employees', { number: '101', name: 'Excedente', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 } });
    expect(over.statusCode).toBe(402); expect(over.json().message).toContain('faixa seguinte');
    expect(over.json().message).not.toContain('Acrescente colaboradores extra');
  });

  it('cobra só a faixa e obriga a mudar de plano quando o efectivo a excede', async () => {
    const atLimit = await request('POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'monthly', amountMinor: 1, seats: 50 });
    expect(atLimit.statusCode).toBe(201); expect(atLimit.json().amountMinor).toBe(9999900);
    await withTenant(companyId, () => getDb().insert(employees).values({ companyId, number: '101', name: 'Admissão anterior sintética', jobTitle: 'Técnico' }));
    expect((await request('POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'monthly' })).json().error).toBe('escalao_pequeno');
    for (const [cycle, amount] of [['monthly', 20000000], ['semiannual', 108000000], ['annual', 192000000]] as const) {
      const r = await request('POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't2', cycle, amountMinor: 1, seats: 50 });
      expect(r.statusCode).toBe(201); expect(r.json().amountMinor).toBe(amount); expect(r.json().seats).toBeNull();
    }
  });

  it('bloqueia ajustes de extras e a confirmação ou regeneração de um pedido antigo', async () => {
    expect((await request('PATCH', `/v1/platform/companies/${companyId}/subscription`, { extraSeats: 10 })).statusCode).toBe(400);
    expect((await request('PUT', '/v1/platform/settings', { extraSeatMinor: 300000, bank: null, supportEmail: null, supportPhone: null })).statusCode).toBe(400);
    expect((await request('GET', '/v1/platform/settings')).json()).not.toHaveProperty('extraSeatMinor');
    const confirm = await request('POST', `/v1/platform/payment-requests/${legacyId}/confirm`, {});
    expect(confirm.statusCode).toBe(400); expect(confirm.json().error).toBe('cobranca_descontinuada');
    expect((await request('POST', `/v1/billing/requests/${legacyId}/reference`, { payerReference: 'TRF' })).statusCode).toBe(404);
    const [row] = await getDb().select().from(paymentRequests).where(eq(paymentRequests.id, legacyId));
    await expect(attachGatewayReference(getDb(), row!)).rejects.toMatchObject({ code: 'cobranca_descontinuada' });
  });

  it('regista para revisão um pagamento Multicaixa antigo, sem activar extras nem duplicar o evento', async () => {
    const p = { id: `retired-${stamp}`, reference: stamp.slice(-9), amountMinor: 3000000, datetime: null, raw: { synthetic: true } };
    expect((await applyGatewayPayment(getDb(), p)).outcome).toBe('retired_request');
    expect((await applyGatewayPayment(getDb(), p)).outcome).toBe('duplicate');
    const [row] = await getDb().select().from(paymentRequests).where(eq(paymentRequests.id, legacyId));
    expect(row!.status).toBe('pending');
    const billing = (await request('GET', '/v1/billing')).json();
    expect(billing.limit).toBe(100);
    expect(billing.requests.find((r: { number: string }) => r.number === `PF-HISTORY-${stamp}`)).toMatchObject({ status: 'paid', amountMinor: 600000, invoiceRef: 'FT histórica' });
  });

  it('a migração cancela só os extras pendentes, conserva pagamentos e deixa auditoria, sem repetir alterações', async () => {
    const statements = readFileSync(new URL('../../../packages/db/migrations/0035_hr_fixed_tiers.sql', import.meta.url), 'utf8').split('--> statement-breakpoint');
    await getDb().transaction(async tx => {
      // Tabelas temporárias sobrepõem apenas nesta ligação os nomes usados pela migração real.
      for (const table of ['payment_requests', 'audit_logs', 'platform_settings']) await tx.execute(sql.raw(`create temporary table ${table} (like public.${table} including defaults) on commit drop`));
      await tx.execute(sql`insert into payment_requests (id,company_id,number,kind,status,amount_minor,created_by) values ('old-pending','synthetic','P1','extra_seats','pending',300000,'test'),('old-paid','synthetic','P2','extra_seats','paid',600000,'test'),('plan-pending','synthetic','P3','subscription','pending',9999900,'test')`);
      await tx.execute(sql`insert into platform_settings(key,value) values ('commercial','{"extraSeatMinor":300000,"supportPhone":"synthetic"}'::jsonb)`);
      for (const statement of statements) await tx.execute(sql.raw(statement));
      const rows = (await tx.execute(sql`select id,status,amount_minor from payment_requests order by id`)).rows;
      expect(rows).toEqual([{ id: 'old-paid', status: 'paid', amount_minor: '600000' }, { id: 'old-pending', status: 'cancelled', amount_minor: '300000' }, { id: 'plan-pending', status: 'pending', amount_minor: '9999900' }]);
      const [audit] = (await tx.execute(sql`select entity_id,before,after from audit_logs`)).rows;
      expect(audit).toMatchObject({ entity_id: 'old-pending', before: { status: 'pending' }, after: { status: 'cancelled' } });
      expect((await tx.execute(sql`select value from platform_settings`)).rows[0]!.value).toEqual({ supportPhone: 'synthetic' });
      for (const statement of statements) await tx.execute(sql.raw(statement));
      expect((await tx.execute(sql`select count(*)::int as n from audit_logs`)).rows[0]!.n).toBe(1);
    });
  });
});
