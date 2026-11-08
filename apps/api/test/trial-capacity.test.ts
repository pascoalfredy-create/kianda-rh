import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, getDb, subscriptions } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { ensureEmployeeCapacity } from '../src/services/licence.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('faixa de colaboradores na avaliação gratuita', () => {
  it('em avaliação a faixa sobe com a equipa; com licença paga o limite mantém-se', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Equipa grande', nif }, name: 'Dona', email: `equipa.${Date.now()}@kianda.test`, password: 'EquipaGrande2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const companyId = r.json().company.id, db = getDb();
    expect(await ensureEmployeeCapacity(db, companyId, 150)).toEqual({ ok: true, tierChanged: '101 a 250 colaboradores' });
    expect((await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)))[0]!.tierKey).toBe('t2');
    await db.update(subscriptions).set({ status: 'active', paidUntil: '2099-01-01' }).where(eq(subscriptions.companyId, companyId));
    expect(await ensureEmployeeCapacity(db, companyId, 400)).toEqual({ ok: false, limit: 250, activeEmployees: 0 });
  });
});
