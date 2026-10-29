import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, contracts, employees, getDb, measureQueries, payrollLines, eq, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('volume de RH: 1 e 200 colaboradores', () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let cookie = '', companyId = '', firstId = '', firstLineId = '';
  const request = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  const sample = async (method: string, url: string, payload?: unknown) => {
    const result = await measureQueries(() => request(method, url, payload));
    expect(result.value.statusCode).toBe(method === 'POST' ? 201 : 200);
    return result;
  };
  async function seed(count: number, offset: number) {
    await withTenant(companyId, async () => {
      const rows = await getDb().insert(employees).values(Array.from({ length: count }, (_, i) => ({ companyId, number: String(offset + i), name: `Pessoa sintética ${offset + i}`, jobTitle: 'Técnico' }))).returning({ id: employees.id });
      firstId ||= rows[0]!.id;
      await getDb().insert(contracts).values(rows.map(e => ({ employeeId: e.id, type: 'indefinite' as const, startDate: '2025-01-01', baseMinor: 42000000, mealMinor: 3000000, transportMinor: 2500000 })));
    });
  }
  beforeAll(async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'RH desempenho sintético', nif: stamp.slice(-10) }, name: 'Responsável', email: `${stamp}@rh-performance.test`, password: 'Desempenho2026abc', modules: ['hr'], hrPlan: { tierKey: 't2', cycle: 'monthly' } } });
    expect(r.statusCode).toBe(201); companyId = r.json().company.id; cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    await seed(1, 1);
  });
  it('mede leituras e recálculo, mantendo o mesmo recibo para quem já estava no mês', async () => {
    const paths = ['/v1/leave/balances?year=2026', '/v1/attendance/overview?period=2026-10', '/v1/employees', '/v1/auth/me'];
    const small = await Promise.all(paths.map(path => sample('GET', path)));
    const smallPay = await sample('POST', '/v1/payroll-runs', { period: '2026-10' });
    await withTenant(companyId, async () => { firstLineId = (await getDb().select({ id: payrollLines.id }).from(payrollLines).where(eq(payrollLines.employeeId, firstId)))[0]!.id; });
    await seed(199, 2);
    const large = await Promise.all(paths.map(path => sample('GET', path)));
    expect(large[0]!.value.json()).toHaveLength(200); expect(large[1]!.value.json()).toHaveLength(200); expect(large[2]!.value.json()).toHaveLength(200);
    const largePay = await sample('POST', '/v1/payroll-runs', { period: '2026-10' });
    expect(largePay.value.json().lines).toBe(200);
    await withTenant(companyId, async () => { const [line] = await getDb().select().from(payrollLines).where(eq(payrollLines.employeeId, firstId)); expect(line!.id).toBe(firstLineId); expect(line!.netMinor).toBe(39274400); });
    for (let i = 0; i < paths.length; i++) console.log('RH_BENCH', JSON.stringify({ path: paths[i], smallQueries: small[i]!.queries, largeQueries: large[i]!.queries, smallMs: small[i]!.elapsedMs, largeMs: large[i]!.elapsedMs }));
    console.log('RH_BENCH', JSON.stringify({ path: 'POST /v1/payroll-runs', smallQueries: smallPay.queries, largeQueries: largePay.queries, smallMs: smallPay.elapsedMs, largeMs: largePay.elapsedMs }));
  }, 120000);
});
