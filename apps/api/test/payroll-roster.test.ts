import { afterAll, describe, expect, it } from 'vitest';
import { allowanceTypes, closeDb, employeeAllowances, getDb, shiftAssignments, shiftTypes, withTenant } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { shiftMinutes } from '../src/services/payroll.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

it('minutos de um turno publicado, também quando atravessa a meia-noite', () => {
  expect(shiftMinutes('08:00', '17:00', 60)).toBe(480);
  expect(shiftMinutes('22:00', '06:00', 30)).toBe(450);
});

describe.skipIf(!process.env.DATABASE_URL)('folha a partir da escala publicada', () => {
  it('o subsídio por dia conta só os turnos publicados; sem escala vale o regime', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Escala publicada', nif }, name: 'Dona', email: `escala.${Date.now()}@kianda.test`, password: 'EscalaPublicada2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`, companyId = r.json().company.id, userId = r.json().user.id;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const e = await call('POST', '/v1/employees', { number: String(n), name: `Turno ${n}`, jobTitle: 'Operador', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 } });
      expect(e.statusCode, e.body).toBe(201); ids.push(e.json().id);
    }
    await withTenant(companyId, async () => {
      const db = getDb();
      const [type] = await db.insert(allowanceTypes).values({ companyId, code: 'SUBTURNO', label: 'Subsídio de turno', calc: 'per_day', valueMinor: 100_000 }).returning();
      await db.insert(employeeAllowances).values(ids.map(employeeId => ({ companyId, employeeId, typeId: type!.id, startDate: '2026-01-01', createdBy: userId })));
      const [shift] = await db.insert(shiftTypes).values({ companyId, code: 'N', name: 'Noite', startTime: '22:00', endTime: '06:00', breakMinutes: 30 }).returning();
      // Colaborador 1: só três turnos publicados em Março; os restantes dias publicados como folga.
      const days = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
      await db.insert(shiftAssignments).values(days.map((workDate, i) => {
        const on = i < 3;
        return { companyId, employeeId: ids[0]!, workDate, kind: on ? 'shift' : 'off', shiftTypeId: on ? shift!.id : null, pubKind: on ? 'shift' : 'off', pubShiftTypeId: on ? shift!.id : null, pubCode: on ? 'N' : null, pubName: on ? 'Noite' : null, pubStartTime: on ? '22:00' : null, pubEndTime: on ? '06:00' : null, pubBreakMinutes: on ? 30 : null, publishedAt: new Date(), publishedBy: userId, updatedBy: userId };
      }));
    });
    expect((await call('POST', '/v1/payroll-runs', { period: '2026-03' })).statusCode).toBe(201);
    const run = (await call('GET', '/v1/payroll-runs/opening?period=2026-03')).json().run;
    const allowance = (employeeId: string) => (run.lines.find((l: any) => l.employeeId === employeeId).breakdown as any[]).find(b => b.code === 'SUBTURNO');
    expect(allowance(ids[0]!).name).toContain('(3 dia(s))');
    expect(allowance(ids[0]!).amountMinor).toBe(300_000);
    expect(allowance(ids[1]!).name).toContain('(22 dia(s))');
  });
});
