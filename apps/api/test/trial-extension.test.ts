import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { CYCLES, luandaDate, periodEnd, trialEndDate, type BillingCycle } from '@kianda/core';
import { and, closeDb, companyModules, eq, getDb, paymentRequests, sql, subscriptions } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { confirmPaymentRequest } from '../src/services/billing.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
let sequence = 0;
const after = (day: string, n = 1) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
const migration = readFileSync(new URL('../../../packages/db/migrations/0049_trial_payment_alignment.sql', import.meta.url), 'utf8').trim().replace(/;$/, '');
// A mesma instrução da publicação, limitada à empresa sintética para não alterar outros testes paralelos.
const align = (companyId: string) => getDb().execute(sql`${sql.raw(migration)} AND p.company_id = ${companyId}`);

async function owner() {
  const unique = `${Date.now()}${sequence++}${Math.floor(Math.random() * 10000)}`;
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Extensão da experiência', nif: unique.slice(-10), sector: 'services' }, name: 'Responsável', email: `${unique}@extensao.test`, password: 'ExtensaoSegura2026', acceptTerms: true, modules: ['hr', 'modeling', 'valuation'] } });
  expect(r.statusCode).toBe(201);
  return { companyId: r.json().company.id as string, userId: r.json().user.id as string, headers: { cookie: `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}` } };
}

describe.skipIf(!process.env.DATABASE_URL)('pedidos pendentes anteriores à extensão da experiência', () => {
  it('conserva os trinta dias e o ciclo pago completo nos três módulos, sem mudar montantes', async () => {
    const o = await owner(), today = luandaDate(new Date()), oldEnd = after(today, 6), extended = trialEndDate(today);
    await getDb().update(subscriptions).set({ trialEndsAt: oldEnd }).where(eq(subscriptions.companyId, o.companyId));
    await getDb().update(companyModules).set({ trialEndsAt: oldEnd }).where(eq(companyModules.companyId, o.companyId));
    const payloads = [
      { kind: 'subscription', tierKey: 't1', cycle: 'monthly' },
      { kind: 'modeling_subscription', planKey: 'pme', cycle: 'semiannual', sectors: ['servicos', 'comercio'] },
      { kind: 'valuation_subscription', planKey: 'essencial', cycle: 'annual' },
    ];
    const original = [];
    for (const payload of payloads) {
      const r = await app.inject({ method: 'POST', url: '/v1/billing/requests', headers: o.headers, payload });
      expect(r.statusCode, r.body).toBe(201); expect(r.json().periodStart).toBe(after(oldEnd)); original.push(r.json());
    }
    await getDb().update(subscriptions).set({ trialEndsAt: extended }).where(eq(subscriptions.companyId, o.companyId));
    await getDb().update(companyModules).set({ trialEndsAt: extended }).where(eq(companyModules.companyId, o.companyId));
    await align(o.companyId);
    const rows = await getDb().select().from(paymentRequests).where(eq(paymentRequests.companyId, o.companyId));
    for (const r of rows) {
      const before = original.find(x => x.id === r.id)!;
      expect(r.periodStart).toBe(after(extended));
      expect(r.periodEnd).toBe(periodEnd(after(extended), CYCLES[r.cycle as BillingCycle].months));
      expect(r.amountMinor).toBe(before.amountMinor); expect(r.number).toBe(before.number); expect(r.status).toBe('pending');
      const paid = await confirmPaymentRequest(getDb(), r.id, { actorId: o.userId, via: 'manual' });
      expect(paid.periodEnd).toBe(r.periodEnd);
    }
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: o.headers });
    for (const module of ['hr', 'modeling', 'valuation']) expect(me.json().modules[module].status).toBe('active');
  });

  it('preserva pedidos pagos e datas futuras já concedidas; repetir o alinhamento é idempotente', async () => {
    const o = await owner();
    const r = await app.inject({ method: 'POST', url: '/v1/billing/requests', headers: o.headers, payload: { kind: 'subscription', tierKey: 't1', cycle: 'monthly' } });
    expect(r.statusCode).toBe(201);
    const future = after(trialEndDate(luandaDate(new Date())), 10), end = periodEnd(future, 1);
    await getDb().update(paymentRequests).set({ periodStart: future, periodEnd: end }).where(eq(paymentRequests.id, r.json().id));
    await align(o.companyId); await align(o.companyId);
    expect((await getDb().select().from(paymentRequests).where(eq(paymentRequests.id, r.json().id)))[0]).toMatchObject({ periodStart: future, periodEnd: end, status: 'pending' });
    await getDb().update(paymentRequests).set({ status: 'paid', paidAt: new Date(), confirmedBy: o.userId, confirmedVia: 'manual', periodStart: '2026-01-01', periodEnd: '2026-01-31' }).where(and(eq(paymentRequests.id, r.json().id), eq(paymentRequests.companyId, o.companyId)));
    await align(o.companyId);
    expect((await getDb().select().from(paymentRequests).where(eq(paymentRequests.id, r.json().id)))[0]).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-01-31', status: 'paid' });
  });
});
