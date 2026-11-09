import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, attendanceEntries } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

describe.skipIf(!process.env.DATABASE_URL)('fecho da assiduidade', () => {
  it('dias sem registo classificados como falta entram na folha como faltas injustificadas', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Fecho ponto', nif }, name: 'Dona', email: `ponto.${Date.now()}@kianda.test`, password: 'FechoPonto2026seguro' } });
    expect(r.statusCode, r.body).toBe(201);
    const companyId = r.json().company.id;
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    const e = await call('POST', '/v1/employees', { number: '1', name: 'Picador', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000, meal: 22000 } });
    expect(e.statusCode, e.body).toBe(201);
    const id = e.json().id;
    // Setembro de 2026: 22 dias úteis; pica em todos excepto 14 e 15 (seguidos) e 22.
    const days: string[] = [];
    for (let d = 1; d <= 30; d++) { const iso = `2026-09-${String(d).padStart(2, '0')}`; const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6 && !['2026-09-14', '2026-09-15', '2026-09-22'].includes(iso) && iso !== '2026-09-17') days.push(iso); }
    await getDb().insert(attendanceEntries).values(days.map((d) => ({ companyId, employeeId: id, workDate: d, clockIn: new Date(`${d}T07:00:00Z`), clockOut: new Date(`${d}T15:00:00Z`), source: 'web' as const, createdBy: r.json().user.id })));
    const sheet = (await call('GET', `/v1/attendance/sheet?employeeId=${id}&period=2026-09`)).json();
    const missing = sheet.summary.noRecordDays;
    expect((await call('POST', '/v1/attendance/approve', { employeeId: id, period: '2026-09' })).json().error).toBe('dias_sem_registo');
    const ok = await call('POST', '/v1/attendance/approve', { employeeId: id, period: '2026-09', noRecord: 'absent' });
    expect(ok.statusCode, ok.body).toBe(201);
    const abs = (await call('GET', `/v1/absences?employeeId=${id}&from=2026-09-01&to=2026-09-30`)).json().filter((a: { type: string }) => a.type === 'unjustified');
    expect(abs.reduce((s: number, a: { workingDays: number }) => s + a.workingDays, 0)).toBe(missing);
    const run = await call('POST', '/v1/payroll-runs', { period: '2026-09' });
    expect(run.statusCode, run.body).toBe(201);
    const line = (await call('GET', `/v1/payroll-runs/${run.json().run.id}`)).json().lines[0];
    expect(line.absenceDays).toBe(missing);
    expect(line.breakdown.find((b: { code: string }) => b.code === 'FALTAS').name).toContain(`(${missing} dia(s))`);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('atrasos como faltas em horas', () => {
  it('desconta os minutos em falta acima da tolerância diária, ao valor-hora', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Atrasos', nif }, name: 'Dona', email: `atrasos.${Date.now()}@kianda.test`, password: 'AtrasosPonto2026seguro' } });
    const companyId = r.json().company.id;
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
    expect((await call('PATCH', '/v1/company/settings', { latenessToleranceMinutes: 10 })).statusCode).toBe(200);
    const id = (await call('POST', '/v1/employees', { number: '1', name: 'Atrasado', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 } })).json().id;
    const days: string[] = [];
    for (let d = 1; d <= 30; d++) { const iso = `2026-09-${String(d).padStart(2, '0')}`; const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) days.push(iso); }
    // Jornada de 8 h. Dois dias com atraso: 40 min e 5 min (este fica dentro da tolerância).
    const late: Record<string, number> = { '2026-09-02': 40, '2026-09-03': 5 };
    await getDb().insert(attendanceEntries).values(days.map((d) => ({ companyId, employeeId: id, workDate: d, clockIn: new Date(Date.parse(`${d}T07:00:00Z`) + (late[d] ?? 0) * 60_000), clockOut: new Date(`${d}T15:00:00Z`), source: 'web' as const, createdBy: r.json().user.id })));
    expect((await call('POST', '/v1/attendance/approve', { employeeId: id, period: '2026-09' })).statusCode).toBe(201);
    const run = await call('POST', '/v1/payroll-runs', { period: '2026-09' });
    const line = (await call('GET', `/v1/payroll-runs/${run.json().run.id}`)).json().lines[0];
    const atrasos = line.breakdown.find((b: { code: string }) => b.code === 'ATRASOS');
    expect(atrasos.name).toBe('Atrasos e saídas antecipadas (0,5 h)');
    expect(atrasos.amountMinor).toBeLessThan(0);
  });
});
