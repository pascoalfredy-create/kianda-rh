import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, sql, withTenant } from '@kianda/db';
import { parseKioskQr } from '@kianda/core';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Ponto com localização: regra da empresa, locais com raio, quiosque com código rotativo, offline e isolamento. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'PontoLocal2026seguro';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

// Luanda: sede na Marginal (raio 150 m) e obra em Talatona (raio 300 m).
const SEDE = { name: 'Sede — Marginal', latitude: -8.8125, longitude: 13.2302, radiusMeters: 150 };
const OBRA = { name: 'Obra Talatona', latitude: -8.9172, longitude: 13.1856, radiusMeters: 300 };
const NEAR_SEDE = { lat: -8.8131, lng: 13.2305, accuracy: 20 };
const AT_OBRA = { lat: -8.918, lng: 13.186, accuracy: 15 };
const FAR = { lat: -8.83, lng: 13.25, accuracy: 10 };

describe('sem sessão', () => {
  it('locais e excepções exigem sessão; quiosque inexistente responde 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/workplaces' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/public/kiosk/' + 'a'.repeat(48) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/public/kiosk/nao-hex' })).statusCode).toBe(404);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('ponto com localização', () => {
  let owner = '', worker = '', other = '', companyId = '', otherCompany = '', employeeId = '', sedeId = '', obraId = '', kioskPath = '';
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const clock = (payload: object) => req(worker, 'POST', '/v1/attendance/clock', payload);

  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Ponto ${i}`, sector: 'construction', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}.${i}@ponto.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (!i) { owner = cookieOf(r); companyId = r.json().company.id; } else { other = cookieOf(r); otherCompany = r.json().company.id; }
    }
    const e = await req(owner, 'POST', '/v1/employees', { number: '7', name: 'Pedro Cassule', gender: 'M', jobTitle: 'Encarregado de obra', province: 'Luanda', nif: '0000000777', contract: { type: 'indefinite', startDate: '2026-01-05', base: 300000, meal: 30000, transport: 25000 } });
    expect(e.statusCode).toBe(201); employeeId = e.json().id;
    expect((await req(owner, 'POST', '/v1/users', { name: 'Pedro', email: `${stamp}.pedro@ponto.test`, password, role: 'employee', employeeId })).statusCode).toBe(201);
    worker = cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `${stamp}.pedro@ponto.test`, password } }));
  });
  beforeEach(async () => { await getDb().execute(sql`delete from attendance_entries where employee_id = ${employeeId}`); });

  it('por omissão está desligado: a marcação não guarda posição mesmo que o telemóvel a envie', async () => {
    const r = await clock({ action: 'in', location: FAR });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ clockInLocation: null, locationIssue: false });
    expect((await req(worker, 'GET', '/v1/attendance/me')).json().location).toEqual({ mode: 'off', workplace: null, kiosk: false });
  });

  it('só o RH configura; valida raio e coordenadas', async () => {
    expect((await req(worker, 'GET', '/v1/workplaces')).statusCode).toBe(403);
    expect((await req(owner, 'POST', '/v1/workplaces', { ...SEDE, radiusMeters: 10 })).statusCode).toBe(400);
    expect((await req(owner, 'POST', '/v1/workplaces', { ...SEDE, latitude: 120 })).statusCode).toBe(400);
    const s = await req(owner, 'POST', '/v1/workplaces', SEDE); expect(s.statusCode).toBe(201); sedeId = s.json().id;
    const o = await req(owner, 'POST', '/v1/workplaces', OBRA); expect(o.statusCode).toBe(201); obraId = o.json().id;
    expect((await req(owner, 'PUT', '/v1/workplaces/settings', { mode: 'teleporte' })).statusCode).toBe(400);
    const cfg = (await req(owner, 'GET', '/v1/workplaces')).json();
    expect(cfg).toMatchObject({ mode: 'off' }); expect(cfg.workplaces).toHaveLength(2);
    expect(cfg.employees.map((x: { id: string }) => x.id)).toContain(employeeId);
  });

  it('registar: guarda a posição e o local mais próximo, sem alerta', async () => {
    expect((await req(owner, 'PUT', '/v1/workplaces/settings', { mode: 'record' })).statusCode).toBe(200);
    const r = await clock({ action: 'in', location: NEAR_SEDE });
    expect(r.statusCode).toBe(201);
    expect(r.json().clockInLocation).toMatchObject({ status: 'ok', method: 'gps', workplaceName: SEDE.name, distance: 0, lat: NEAR_SEDE.lat, lng: NEAR_SEDE.lng, accuracy: 20, mode: 'record' });
    expect(r.json().locationIssue).toBe(false);
  });

  it('alertar: aceita fora do local e põe na lista de excepções (chefia/RH, não o próprio)', async () => {
    await req(owner, 'PUT', '/v1/workplaces/settings', { mode: 'alert' });
    const r = await clock({ action: 'in', location: FAR });
    expect(r.statusCode).toBe(201);
    expect(r.json().clockInLocation).toMatchObject({ status: 'outside', workplaceName: SEDE.name });
    expect(r.json().locationIssue).toBe(true);
    const period = r.json().workDate.slice(0, 7);
    const issues = (await req(owner, 'GET', `/v1/attendance-locations/issues?period=${period}`)).json();
    expect(issues.find((x: { id: string }) => x.id === r.json().id)).toMatchObject({ employee: { id: employeeId }, clockInLocation: { status: 'outside' } });
    expect((await req(worker, 'GET', `/v1/attendance-locations/issues?period=${period}`)).statusCode).toBe(403);
    const overview = (await req(owner, 'GET', `/v1/attendance/overview?period=${period}`)).json();
    expect(overview.find((x: { employee: { id: string } }) => x.employee.id === employeeId).locationIssues).toBe(1);
    // Sem localização também é excepção (mas aceite).
    await getDb().execute(sql`delete from attendance_entries where employee_id = ${employeeId}`);
    expect((await clock({ action: 'in' })).json()).toMatchObject({ locationIssue: true, clockInLocation: { status: 'unavailable', method: 'none' } });
  });

  it('bloquear: recusa fora do local (403, com auditoria) e aceita dentro', async () => {
    await req(owner, 'PUT', '/v1/workplaces/settings', { mode: 'block' });
    const denied = await clock({ action: 'in', location: FAR });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'fora_do_local', location: { status: 'outside', workplace: SEDE.name } });
    expect(denied.json().message).toMatch(/km do local «Sede — Marginal»/);
    const audit = await getDb().execute(sql`select after from audit_logs where company_id = ${companyId} and action = 'punch_blocked' order by created_at desc limit 1`);
    expect((audit.rows[0] as { after: { status: string } }).after.status).toBe('outside');
    expect((await clock({ action: 'in' })).statusCode).toBe(403); // sem localização
    const ok = await clock({ action: 'in', location: NEAR_SEDE });
    expect(ok.statusCode).toBe(201); expect(ok.json().locationIssue).toBe(false);
  });

  it('local atribuído: quem trabalha na obra não marca na sede', async () => {
    expect((await req(owner, 'PUT', '/v1/workplaces/assignments', { assignments: [{ employeeId, workplaceId: obraId }] })).json()).toEqual({ changed: 1 });
    expect((await req(worker, 'GET', '/v1/attendance/me')).json().location).toMatchObject({ mode: 'block', workplace: OBRA.name });
    expect((await clock({ action: 'in', location: NEAR_SEDE })).statusCode).toBe(403);
    expect((await clock({ action: 'in', location: AT_OBRA })).json().clockInLocation).toMatchObject({ status: 'ok', workplaceName: OBRA.name });
  });

  it('quiosque: código rotativo prova a presença sem GPS; código errado ou de outro local é recusado', async () => {
    const k = await req(owner, 'POST', `/v1/workplaces/${obraId}/kiosk`, { enabled: true });
    kioskPath = k.json().kioskPath; expect(kioskPath).toMatch(/^\/quiosque\/[0-9a-f]{48}$/);
    const screen = (await app.inject({ method: 'GET', url: `/v1/public${kioskPath.replace('/quiosque/', '/kiosk/')}` })).json();
    expect(screen).toMatchObject({ workplace: OBRA.name, company: 'Ponto 0', active: true });
    expect(screen.code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(screen)).not.toMatch(/secret/i);
    expect(parseKioskQr(screen.qr)).toEqual({ workplaceId: obraId, code: screen.code });
    expect((await clock({ action: 'in', kiosk: '000000' === screen.code ? '111111' : '000000' })).statusCode).toBe(400);
    const byCode = await clock({ action: 'in', kiosk: screen.code });
    expect(byCode.statusCode).toBe(201);
    expect(byCode.json().clockInLocation).toMatchObject({ status: 'ok', method: 'kiosk', workplaceName: OBRA.name });
    expect(byCode.json().clockInLocation.lat).toBeUndefined();
    // QR completo na saída (mais de 1 minuto depois).
    await getDb().execute(sql`update attendance_entries set clock_in = clock_in - interval '2 hours' where employee_id = ${employeeId}`);
    expect((await clock({ action: 'out', kiosk: screen.qr })).json().clockOutLocation).toMatchObject({ method: 'kiosk' });
    // Gerar de novo invalida o endereço anterior.
    await req(owner, 'POST', `/v1/workplaces/${obraId}/kiosk`, { enabled: true });
    expect((await app.inject({ method: 'GET', url: `/v1/public${kioskPath.replace('/quiosque/', '/kiosk/')}` })).statusCode).toBe(404);
  });

  it('sem rede: a posição guardada no telemóvel é avaliada com a hora da marcação', async () => {
    const at = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((await clock({ action: 'in', at, clientRef: `ref-${stamp}-1`, location: FAR })).statusCode).toBe(403);
    const ok = await clock({ action: 'in', at, clientRef: `ref-${stamp}-2`, location: AT_OBRA });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ source: 'offline', clockInLocation: { status: 'ok', capturedAt: at.replace(/\.\d+Z$/, (m) => m) } });
  });

  it('isolamento: locais de outra empresa não se atribuem nem se vêem; eliminar um local liberta os colaboradores', async () => {
    const foreign = await req(other, 'POST', '/v1/workplaces', { ...SEDE, name: 'Local alheio' });
    expect(foreign.statusCode).toBe(201);
    expect((await req(owner, 'PUT', '/v1/workplaces/assignments', { assignments: [{ employeeId, workplaceId: foreign.json().id }] })).statusCode).toBe(404);
    expect((await req(owner, 'PATCH', `/v1/workplaces/${foreign.json().id}`, { radiusMeters: 500 })).statusCode).toBe(404);
    await withTenant(otherCompany, async () => expect((await getDb().execute(sql`select id from workplaces where company_id = ${companyId}`)).rows).toEqual([]));
    await expect(getDb().execute(sql`update employees set workplace_id = ${foreign.json().id} where id = ${employeeId}`)).rejects.toThrow();
    expect((await req(owner, 'DELETE', `/v1/workplaces/${obraId}`)).statusCode).toBe(204);
    const row = await getDb().execute(sql`select workplace_id from employees where id = ${employeeId}`);
    expect((row.rows[0] as { workplace_id: string | null }).workplace_id).toBeNull();
    expect((await req(owner, 'GET', '/v1/workplaces')).json().workplaces.map((w: { id: string }) => w.id)).toEqual([sedeId]);
  });
});
