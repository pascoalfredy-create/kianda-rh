import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, closeDb, eq, getDb, pushOutbox, subscriptions, users } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Planeamento de turnos: tipos, escala, permissões, publicação, «os meus turnos», ponto, bloqueios e isolamento. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'Turnos2026seguro!';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

describe('sem sessão', () => {
  it('a escala exige sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/shifts/roster?from=2026-10-01&to=2026-10-07' })).statusCode).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('planeamento de turnos', () => {
  let owner = '', other = '', chief = '', worker = '', finance = '', chiefId = '', workerId = '', lateId = '', otherEmp = '';
  const types: Record<string, string> = {};
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const employee = (number: string, name: string, startDate: string) => ({ number, name, gender: 'F', jobTitle: 'Operadora', province: 'Luanda', nif: `10000${number.padStart(5, '0')}`, contract: { type: 'indefinite', startDate, base: 300000, meal: 30000, transport: 25000 } });
  const login = async (email: string) => cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
  const roster = async (session: string, from: string, to: string) => (await req(session, 'GET', `/v1/shifts/roster?from=${from}&to=${to}`)).json();
  const put = (session: string, changes: { employeeId: string; date: string; value: string | null }[]) => req(session, 'PUT', '/v1/shifts/roster', { changes });

  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Turnos ${i}`, sector: 'security', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}.${i}@turnos.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (!i) owner = cookieOf(r); else other = cookieOf(r);
    }
    const c = await req(owner, 'POST', '/v1/employees', employee('21', 'Chefe Ngola', '2025-01-06')); expect(c.statusCode).toBe(201); chiefId = c.json().id;
    const w = await req(owner, 'POST', '/v1/employees', employee('22', 'Teresa Cassoma', '2025-02-03')); expect(w.statusCode).toBe(201); workerId = w.json().id;
    const l = await req(owner, 'POST', '/v1/employees', employee('23', 'Admitida Tarde', '2026-12-01')); expect(l.statusCode).toBe(201); lateId = l.json().id;
    for (const id of [workerId, lateId]) expect((await req(owner, 'PATCH', `/v1/employees/${id}`, { managerId: chiefId })).statusCode).toBe(200);
    const o = await req(other, 'POST', '/v1/employees', employee('21', 'Outra Empresa', '2025-01-06')); expect(o.statusCode).toBe(201); otherEmp = o.json().id;
    for (const [email, role, employeeId] of [[`${stamp}.chefe@turnos.test`, 'manager', chiefId], [`${stamp}.teresa@turnos.test`, 'employee', workerId], [`${stamp}.fin@turnos.test`, 'finance', undefined]] as const) {
      expect((await req(owner, 'POST', '/v1/users', { name: role, email, password, role, ...(employeeId ? { employeeId } : {}) })).statusCode).toBe(201);
    }
    chief = await login(`${stamp}.chefe@turnos.test`); worker = await login(`${stamp}.teresa@turnos.test`); finance = await login(`${stamp}.fin@turnos.test`);
  });

  it('tipos de turno: só o RH ou o proprietário criam; códigos únicos e validados', async () => {
    for (const [code, name, startTime, endTime, minStaff] of [['M', 'Manhã', '06:00', '14:00', null], ['T', 'Tarde', '14:00', '22:00', null], ['N', 'Noite', '22:00', '06:00', 1]] as const) {
      const r = await req(owner, 'POST', '/v1/shifts/types', { code, name, startTime, endTime, breakMinutes: 30, color: code === 'N' ? 'violet' : 'blue', minStaff });
      expect(r.statusCode).toBe(201); types[code] = r.json().id;
      expect(r.json().workMinutes).toBe(450);
    }
    expect((await req(owner, 'POST', '/v1/shifts/types', { code: 'm', name: 'Outra', startTime: '07:00', endTime: '15:00' })).json().error).toBe('duplicado');
    expect((await req(owner, 'POST', '/v1/shifts/types', { code: 'F', name: 'Folga', startTime: '07:00', endTime: '15:00' })).json().error).toBe('turno_invalido');
    expect((await req(owner, 'POST', '/v1/shifts/types', { code: 'X', name: 'Zero', startTime: '07:00', endTime: '07:00' })).statusCode).toBe(400);
    expect((await req(chief, 'POST', '/v1/shifts/types', { code: 'X', name: 'Chefia', startTime: '07:00', endTime: '15:00' })).statusCode).toBe(403);
    expect((await req(worker, 'GET', '/v1/shifts/types')).statusCode).toBe(403);
    const list = (await req(chief, 'GET', '/v1/shifts/types')).json();
    expect(list.types.map((t: { code: string }) => t.code)).toEqual(['M', 'T', 'N']);
    expect(list).toMatchObject({ minRestMinutes: 600, canManage: false });
  });

  it('a chefia planeia a equipa (nunca a si própria); avisos de descanso; antes do contrato não', async () => {
    // Semana de 05/10 a 11/10/2026: tarde e manhã seguidas (8 h de descanso), sábado de noite, domingo de folga.
    const plan = [['2026-10-05', 'T'], ['2026-10-06', 'M'], ['2026-10-07', 'M'], ['2026-10-08', 'off'], ['2026-10-09', 'M'], ['2026-10-10', 'N'], ['2026-10-11', 'off']] as const;
    const r = await put(chief, plan.map(([date, v]) => ({ employeeId: workerId, date, value: v === 'off' ? 'off' : types[v]! })));
    expect(r.statusCode).toBe(200); expect(r.json().saved).toBe(7);
    expect((await put(chief, [{ employeeId: workerId, date: '2026-10-05', value: types.T! }])).json().saved).toBe(0);
    expect((await put(chief, [{ employeeId: chiefId, date: '2026-10-05', value: types.M! }])).statusCode).toBe(403);
    expect((await put(finance, [{ employeeId: workerId, date: '2026-10-05', value: types.M! }])).statusCode).toBe(403);
    expect((await put(owner, [{ employeeId: lateId, date: '2026-11-20', value: types.M! }])).json().error).toBe('fora_contrato');
    expect((await put(owner, [{ employeeId: workerId, date: '2026-11-20', value: 'tipo-inexistente' }])).statusCode).toBe(404);
    const view = await roster(chief, '2026-10-05', '2026-10-11');
    expect(view.employees.map((e: { name: string }) => e.name).sort()).toEqual(['Admitida Tarde', 'Chefe Ngola', 'Teresa Cassoma']);
    expect(view.employees.find((e: { id: string }) => e.id === chiefId).canEdit).toBe(false);
    expect(view.pendingCount).toBe(7);
    expect(view.issues.find((x: { code: string }) => x.code === 'rest_short')).toMatchObject({ employeeId: workerId, date: '2026-10-06', severity: 'warning' });
    // Cobertura: só sábado tem a noite coberta.
    expect(view.issues.filter((x: { code: string }) => x.code === 'coverage')).toHaveLength(6);
    // Com 8 h de intervalo mínimo deixa de haver aviso de descanso.
    expect((await req(chief, 'PATCH', '/v1/shifts/settings', { minRestMinutes: 480 })).statusCode).toBe(403);
    expect((await req(owner, 'PATCH', '/v1/shifts/settings', { minRestMinutes: 480 })).statusCode).toBe(200);
    expect((await roster(chief, '2026-10-05', '2026-10-11')).issues.some((x: { code: string }) => x.code === 'rest_short')).toBe(false);
    expect((await req(owner, 'PATCH', '/v1/shifts/settings', { minRestMinutes: 600 })).statusCode).toBe(200);
    expect((await req(worker, 'GET', '/v1/shifts/roster?from=2026-10-05&to=2026-10-11')).statusCode).toBe(403);
    expect((await req(owner, 'GET', '/v1/shifts/roster?from=2026-10-01&to=2026-12-31')).statusCode).toBe(400);
  });

  it('só o publicado chega ao colaborador e ao ponto; publicar avisa o telemóvel', async () => {
    expect((await req(worker, 'GET', '/v1/shifts/mine?from=2026-10-05&to=2026-10-11')).json().days).toEqual([]);
    const p = await req(chief, 'POST', '/v1/shifts/publish', { from: '2026-10-05', to: '2026-10-11' });
    expect(p.statusCode).toBe(200); expect(p.json()).toEqual({ published: 7, employees: 1 });
    expect((await req(chief, 'POST', '/v1/shifts/publish', { from: '2026-10-05', to: '2026-10-11' })).json().published).toBe(0);
    const mine = (await req(worker, 'GET', '/v1/shifts/mine?from=2026-10-05&to=2026-10-11')).json();
    expect(mine.days.map((d: { kind: string; code?: string }) => d.code ?? d.kind)).toEqual(['T', 'M', 'M', 'off', 'M', 'N', 'off']);
    expect(mine.days[5]).toMatchObject({ startTime: '22:00', endTime: '06:00', workMinutes: 450 });
    const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.employeeId, workerId));
    expect((await getDb().select().from(pushOutbox).where(and(eq(pushOutbox.userId, u!.id)))).map(x => (x.payload as { url: string }).url)).toContain('/turnos');
    // Ponto: sábado com turno é dia de trabalho (sem registo); quinta de folga é descanso.
    const sheet = (await req(chief, 'GET', `/v1/attendance/sheet?period=2026-10&employeeId=${workerId}`)).json();
    const day = (d: string) => sheet.summary.days.find((x: { date: string }) => x.date === d);
    expect(day('2026-10-10')).toMatchObject({ kind: 'workday', expectedMinutes: 450, flags: ['no_record'] });
    expect(day('2026-10-08')).toMatchObject({ kind: 'rest', expectedMinutes: 0 });
    expect(day('2026-10-12')).toMatchObject({ kind: 'workday', expectedMinutes: 480 });
    expect(sheet.shifts['2026-10-10']).toBe('N 22:00–06:00');
  });

  it('alterar o publicado fica pendente; limpar um dia publicado retira-o ao publicar', async () => {
    expect((await put(chief, [{ employeeId: workerId, date: '2026-10-09', value: null }])).json().saved).toBe(1);
    let v = await roster(chief, '2026-10-05', '2026-10-11');
    const cell = v.cells.find((c: { date: string }) => c.date === '2026-10-09');
    expect(cell).toMatchObject({ kind: 'none', pending: true, published: { kind: 'shift', code: 'M' } });
    expect((await req(worker, 'GET', '/v1/shifts/mine?from=2026-10-09&to=2026-10-09')).json().days).toHaveLength(1);
    // Mudar as horas do tipo deixa pendentes os dias publicados com esse turno.
    expect((await req(owner, 'PATCH', `/v1/shifts/types/${types.N}`, { code: 'N', name: 'Noite', startTime: '22:00', endTime: '07:00', breakMinutes: 30, color: 'violet', minStaff: 1 })).statusCode).toBe(200);
    v = await roster(chief, '2026-10-05', '2026-10-11');
    expect(v.pendingCount).toBe(2);
    expect((await req(chief, 'POST', '/v1/shifts/publish', { from: '2026-10-05', to: '2026-10-11' })).json().published).toBe(2);
    const mine = (await req(worker, 'GET', '/v1/shifts/mine?from=2026-10-05&to=2026-10-11')).json();
    expect(mine.days.map((d: { date: string }) => d.date)).not.toContain('2026-10-09');
    expect(mine.days.find((d: { date: string }) => d.date === '2026-10-10')).toMatchObject({ endTime: '07:00', workMinutes: 510 });
  });

  it('copiar a semana, exportar e bloquear o mês aprovado', async () => {
    const copy = await req(chief, 'POST', '/v1/shifts/copy', { from: '2026-10-05', to: '2026-10-11', target: '2026-10-12' });
    expect(copy.statusCode).toBe(200); expect(copy.json().saved).toBe(6);
    expect((await req(chief, 'POST', '/v1/shifts/copy', { from: '2026-10-05', to: '2026-10-11', target: '2026-10-08' })).statusCode).toBe(400);
    const v = await roster(chief, '2026-10-12', '2026-10-18');
    expect(v.cells.filter((c: { employeeId: string }) => c.employeeId === workerId).map((c: { date: string; kind: string }) => `${c.date.slice(8)}${c.kind[0]}`)).toEqual(['12s', '13s', '14s', '15o', '17s', '18o']);
    // Em período experimental a escala vê-se mas não se exporta (como os restantes documentos).
    expect((await req(finance, 'GET', '/v1/shifts/export?from=2026-10-12&to=2026-10-18')).statusCode).toBe(402);
    const companyId = (await req(owner, 'GET', '/v1/auth/me')).json().company.id as string;
    await getDb().update(subscriptions).set({ status: 'active', paidUntil: '2099-12-31' }).where(eq(subscriptions.companyId, companyId));
    const x = await req(finance, 'GET', '/v1/shifts/export?from=2026-10-12&to=2026-10-18');
    expect(x.statusCode).toBe(200); expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((await req(chief, 'POST', '/v1/attendance/approve', { employeeId: workerId, period: '2026-10', noRecord: 'present', note: 'Turnos confirmados pela chefia' })).statusCode).toBe(201);
    expect((await put(chief, [{ employeeId: workerId, date: '2026-10-20', value: types.M! }])).json().error).toBe('bloqueado');
    const locked = await roster(chief, '2026-10-12', '2026-10-18');
    expect(locked.employees.find((e: { id: string }) => e.id === workerId).lockedDays).toHaveLength(7);
    expect(locked.pendingCount).toBe(0);
    expect((await req(chief, 'POST', '/v1/shifts/publish', { from: '2026-10-12', to: '2026-10-18' })).json().published).toBe(0);
  });

  it('cada empresa só vê os seus turnos e a sua escala', async () => {
    const theirs = await roster(other, '2026-10-05', '2026-10-11');
    expect(theirs.types).toEqual([]); expect(theirs.cells).toEqual([]);
    expect(theirs.employees.map((e: { id: string }) => e.id)).toEqual([otherEmp]);
    expect((await put(other, [{ employeeId: workerId, date: '2026-10-21', value: 'off' }])).statusCode).toBe(404);
    expect((await put(other, [{ employeeId: otherEmp, date: '2026-10-21', value: types.M! }])).statusCode).toBe(404);
    expect((await req(other, 'PATCH', `/v1/shifts/types/${types.M}`, { code: 'M', name: 'Roubo', startTime: '06:00', endTime: '14:00' })).statusCode).toBe(404);
  });
});
