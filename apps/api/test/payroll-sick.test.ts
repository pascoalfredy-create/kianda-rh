import { afterAll, describe, expect, it } from 'vitest';
import { absences, closeDb, getDb, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { addMonths, sickChains } from '../src/services/payroll.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

it('limite de 6 meses: datas e períodos seguidos de doença', () => {
  expect(addMonths('2026-01-15', 6)).toBe('2026-07-15');
  expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  expect(sickChains([{ startDate: '2026-03-01', endDate: '2026-03-31' }, { startDate: '2026-01-10', endDate: '2026-02-28' }, { startDate: '2026-05-01', endDate: '2026-05-02' }]))
    .toEqual([{ from: '2026-01-10', to: '2026-03-31' }, { from: '2026-05-01', to: '2026-05-02' }]);
});

describe.skipIf(!process.env.DATABASE_URL)('doença paga pela empresa até 6 meses (LGT, art. 226.º)', () => {
  it('depois dos 6 meses o salário deixa de ser pago e a folha avisa', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Doença longa', nif }, name: 'Dona', email: `doenca.${Date.now()}@kianda.test`, password: 'DoencaLonga2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`, companyId = r.json().company.id;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const e = await call('POST', '/v1/employees', { number: String(n), name: `Doente ${n}`, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2025-01-01', base: 300000 } });
      expect(e.statusCode, e.body).toBe(201); ids.push(e.json().id);
    }
    await withTenant(companyId, async () => {
      // Colaborador 1: doente desde 10/01; colaborador 2: só um mês de doença (sempre pago).
      await getDb().insert(absences).values([
        { companyId, employeeId: ids[0]!, type: 'sick', startDate: '2026-01-10', endDate: '2026-04-30', workingDays: 77, status: 'approved' },
        { companyId, employeeId: ids[0]!, type: 'sick', startDate: '2026-05-01', endDate: '2026-08-31', workingDays: 87, status: 'approved' },
        { companyId, employeeId: ids[1]!, type: 'sick', startDate: '2026-08-01', endDate: '2026-08-31', workingDays: 21, status: 'approved' },
      ]);
    });
    expect((await call('POST', '/v1/payroll-runs', { period: '2026-08' })).statusCode).toBe(201);
    const run = (await call('GET', '/v1/payroll-runs/opening?period=2026-08')).json().run;
    const line = (id: string) => run.lines.find((l: any) => l.employeeId === id);
    expect(line(ids[0]!).grossMinor).toBeLessThan(line(ids[1]!).grossMinor);
    expect((line(ids[0]!).breakdown as any[]).some(b => /doença além de 6 meses/i.test(b.name))).toBe(true);
    expect(run.warnings.map((w: any) => w.message).join(' ')).toContain('Doente 1: doença desde 10/01/2026');
    expect(run.warnings.map((w: any) => w.message).join(' ')).not.toContain('Doente 2: doença');
  });
});
