import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { absences, attendanceEntries, attendanceMonths, closeDb, companyModules, compensationChanges, contracts, employeeDocuments, employees, eq, expenseClaims, getDb, measureQueries, payrollLines, payrollPayments, payrollRuns, payrollVariables, subscriptions, withTenant, workSchedules } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
const request = (cookie: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

describe.skipIf(!process.env.DATABASE_URL)('leituras RH em conjunto: resultados, perfis e isolamento', () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, password = 'DadosEmConjunto2026abc';
  let owner = '', other = '', companyId = '', actorId = '';
  let ids: string[] = [], pendingId = '';
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    for (const suffix of [1, 2]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: `Empresa sintética ${suffix}`, nif: String(Number(stamp.slice(-10)) + suffix).padStart(10, '0') }, name: 'Responsável', email: `${stamp}.${suffix}@hr-bulk.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (suffix === 1) { owner = cookieOf(r); companyId = r.json().company.id; actorId = r.json().user.id; }
      else {
        other = cookieOf(r);
        await withTenant(r.json().company.id, async () => {
          const [e] = await getDb().insert(employees).values({ companyId: r.json().company.id, number: '1', name: 'Outra empresa', jobTitle: 'Técnico' }).returning();
          await getDb().insert(absences).values({ companyId: e!.companyId, employeeId: e!.id, type: 'training', startDate: '2026-09-10', endDate: '2026-09-10', workingDays: 1 });
          await getDb().insert(expenseClaims).values({ companyId: e!.companyId, employeeId: e!.id, number: '1', title: 'Despesa externa', createdBy: r.json().user.id, status: 'submitted' });
        });
      }
    }
    await withTenant(companyId, async () => {
      const db = getDb();
      const people = await db.insert(employees).values(['Chefia', 'Equipa', 'RH', 'Sem contrato'].map((name, i) => ({ companyId, number: String(i + 1), name, jobTitle: 'Técnico' }))).returning();
      ids = people.map(e => e.id);
      await db.update(employees).set({ managerId: ids[0] }).where(eq(employees.id, ids[1]!));
      await db.insert(contracts).values(ids.slice(0, 3).map(employeeId => ({ employeeId, type: 'indefinite' as const, startDate: '2025-01-01', baseMinor: 42000000 })));
      await db.insert(contracts).values({ employeeId: ids[1]!, type: 'fixed_term', startDate: '2026-06-01', endDate: '2026-12-31', baseMinor: 43000000 });
      const [schedule] = await db.insert(workSchedules).values({ companyId, name: 'Turno sintético', kind: 'cycle', pattern: [480, 480, 0, 0], anchorDate: '2026-09-01' }).returning();
      await db.update(employees).set({ scheduleId: schedule!.id }).where(eq(employees.id, ids[1]!));
      const pending = await db.insert(absences).values(ids.map(employeeId => ({ companyId, employeeId, type: 'training' as const, startDate: '2026-09-10', endDate: '2026-09-10', workingDays: 1 }))).returning();
      pendingId = pending[1]!.id;
      await db.insert(absences).values([
        { companyId, employeeId: ids[1]!, type: 'vacation', startDate: '2026-09-11', endDate: '2026-09-11', workingDays: 1, status: 'approved' },
        { companyId, employeeId: ids[1]!, type: 'vacation', startDate: '2026-12-31', endDate: '2027-01-04', workingDays: 2, status: 'pending' },
        { companyId, employeeId: ids[1]!, type: 'vacation', startDate: '2026-09-14', endDate: '2026-09-14', workingDays: 1, status: 'rejected' },
      ]);
      await db.insert(attendanceEntries).values({ companyId, employeeId: ids[1]!, workDate: '2026-09-01', clockIn: new Date('2026-09-01T07:00:00Z'), clockOut: new Date('2026-09-01T15:00:00Z'), createdBy: actorId });
      await db.insert(attendanceMonths).values({ companyId, employeeId: ids[1]!, period: '2026-09', workedMinutes: 480, expectedMinutes: 7200, overtimeMinutes: 0, approvedOvertimeMinutes: 0, approvedBy: actorId });
      await db.insert(expenseClaims).values(ids.map((employeeId, i) => ({ companyId, employeeId, number: String(i + 1), title: 'Despesa sintética', createdBy: actorId, status: 'submitted' as const })));
      await db.insert(expenseClaims).values({ companyId, employeeId: ids[1]!, number: '5', title: 'Já paga', createdBy: actorId, status: 'paid' });
    });
    for (const [label, role, employeeId] of [['manager', 'manager', ids[0]], ['hr', 'hr_admin', ids[2]], ['employee', 'employee', ids[1]], ['unlinked', 'manager', undefined]] as const) {
      const email = `${stamp}.${label}@hr-bulk.test`;
      expect((await request(owner, 'POST', '/v1/users', { name: label, email, password, role, employeeId })).statusCode).toBe(201);
      const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
      expect(login.statusCode).toBe(200); sessions.set(label, cookieOf(login));
    }
  });

  it('conta só os pedidos que cada perfil pode decidir, sem incluir outra empresa', async () => {
    for (const [cookie, expected] of [[owner, 5], [sessions.get('hr')!, 4], [sessions.get('manager')!, 2], [sessions.get('unlinked')!, 0], [sessions.get('employee')!, 0], [other, 1]] as const) {
      const counts = await request(cookie, 'GET', '/v1/notifications/counts');
      expect(counts.statusCode).toBe(200);
      // Uma das ausências pendentes da equipa atravessa Dezembro/Janeiro.
      expect(counts.json().absences).toBe(expected);
      const expenses = expected > 1 ? expected - 1 : expected;
      expect(counts.json().expenses).toBe(expenses);
      const account = await request(cookie, 'GET', '/v1/auth/me');
      expect(account.statusCode).toBe(200);
      expect(account.json().notifications).toEqual(counts.json());
      if (cookie !== sessions.get('employee')) {
        const list = await request(cookie, 'GET', '/v1/absences?awaitingMe=1');
        expect(counts.json().absences).toBe(list.json().length);
        expect(counts.json().expenses).toBe((await request(cookie, 'GET', '/v1/expenses?scope=approve')).json().length);
      }
    }
  });

  it('carrega sessão, módulos e contadores com uma única leitura, sem expor o logotipo', async () => {
    const measured = await measureQueries(() => request(owner, 'GET', '/v1/auth/me'));
    expect(measured.value.statusCode).toBe(200);
    expect(measured.queries).toBeLessThanOrEqual(5); // Uma leitura e a transacção RLS.
    expect(measured.value.json().company).toMatchObject({ id: companyId, hasLogo: false });
    expect(measured.value.json().company).not.toHaveProperty('logoDataUrl');
    expect((await request(other, 'GET', '/v1/auth/me')).json().company.id).not.toBe(companyId);
  });

  it('reflecte imediatamente uma decisão, sem reutilizar os dados de outro pedido', async () => {
    expect((await request(sessions.get('manager')!, 'POST', `/v1/absences/${pendingId}/reject`, { note: 'Rever calendário' })).statusCode).toBe(200);
    expect((await request(sessions.get('manager')!, 'GET', '/v1/notifications/counts')).json().absences).toBe(1);
    expect((await request(other, 'GET', '/v1/notifications/counts')).json()).toEqual({ absences: 1, expenses: 1 });
  });

  it('mantém saldos, férias entre anos e o âmbito da chefia e do colaborador', async () => {
    const all = (await request(owner, 'GET', '/v1/leave/balances?year=2026')).json();
    expect(all).toHaveLength(4);
    expect(all.find((b: { employee: { id: string } }) => b.employee.id === ids[1])).toMatchObject({ entitlement: 22, taken: 1, pending: 1, available: 20 });
    expect(all.find((b: { employee: { id: string } }) => b.employee.id === ids[3])).toMatchObject({ entitlement: 0 });
    const team = (await request(sessions.get('manager')!, 'GET', '/v1/leave/balances?year=2026')).json();
    expect(team.map((b: { employee: { id: string } }) => b.employee.id).sort()).toEqual(ids.slice(0, 2).sort());
    expect((await request(sessions.get('employee')!, 'GET', '/v1/leave/balances?year=2026')).json()).toEqual([all.find((b: { employee: { id: string } }) => b.employee.id === ids[1])]);
  });

  it('a visão da equipa coincide com a folha individual, com turno, férias e aprovação', async () => {
    const overview = (await request(owner, 'GET', '/v1/attendance/overview?period=2026-09')).json();
    expect(overview).toHaveLength(4);
    const sheet = (await request(owner, 'GET', `/v1/attendance/sheet?period=2026-09&employeeId=${ids[1]}`)).json();
    const { days: _days, ...totals } = sheet.summary;
    expect(overview.find((e: { employee: { id: string } }) => e.employee.id === ids[1])).toMatchObject({ ...totals, approval: sheet.approval, canApprove: false });
    expect(totals.workedMinutes).toBe(480);
    expect(sheet.schedule.name).toBe('Turno sintético');
    expect(sheet.approval.approvedByName).toBe('Responsável');
    const scoped = (await request(sessions.get('employee')!, 'GET', '/v1/attendance/overview?period=2026-09')).json();
    expect(scoped).toHaveLength(1); expect(scoped[0].employee.id).toBe(ids[1]);
    expect((await request(other, 'GET', `/v1/attendance/sheet?period=2026-09&employeeId=${ids[1]}`)).statusCode).toBe(404);
  });

  it('selecciona o contrato mais recente uma única vez e conserva fichas sem contrato', async () => {
    const r = await request(owner, 'GET', '/v1/employees');
    expect(r.statusCode).toBe(200);
    const rows = r.json(); expect(rows).toHaveLength(4);
    expect(rows.find((e: { id: string }) => e.id === ids[1]).contract).toMatchObject({ startDate: '2026-06-01', baseMinor: 43000000 });
    expect(rows.find((e: { id: string }) => e.id === ids[3])).toMatchObject({ contract: null, alerts: ['Sem contrato registado'] });
  });

  it('abre a assiduidade com os mesmos dados e permissões, numa única chamada', async () => {
    for (const cookie of [owner, sessions.get('manager')!, sessions.get('hr')!, other]) {
      const opening = await request(cookie, 'GET', '/v1/attendance/opening?period=2026-09');
      expect(opening.statusCode).toBe(200);
      expect(opening.json()).toEqual({ tab: 'equipa', sheet: null, rows: (await request(cookie, 'GET', '/v1/attendance/overview?period=2026-09')).json() });
    }
    const employee = sessions.get('employee')!;
    expect((await request(employee, 'GET', '/v1/attendance/opening?period=2026-09')).json()).toEqual({
      tab: 'meu', rows: null, sheet: (await request(employee, 'GET', '/v1/attendance/sheet?period=2026-09')).json(),
    });
    // Forçar o separador da equipa não dá ao colaborador os dados dos colegas.
    expect((await request(employee, 'GET', '/v1/attendance/opening?period=2026-09&tab=equipa')).json()).toEqual({ tab: 'equipa', rows: null, sheet: null });
    expect((await request(sessions.get('unlinked')!, 'GET', '/v1/attendance/opening?period=2026-09&tab=meu')).json()).toEqual({ tab: 'meu', rows: null, sheet: null });
  });

  it('os metadados vêm da sessão assinada, mesmo com cabeçalhos de perfil falsificados', async () => {
    const cookie = sessions.get('employee')!;
    const me = (await request(cookie, 'GET', '/v1/auth/me')).json();
    const headers = { cookie, 'X-Kianda-Role': 'owner', 'X-Kianda-User': actorId, 'X-Kianda-Employee': ids[0]! };
    const opening = await app.inject({ method: 'GET', url: '/v1/attendance/opening?period=2026-09', headers });
    expect(opening.statusCode).toBe(200);
    expect(opening.headers['x-kianda-role']).toBe('employee');
    expect(opening.headers['x-kianda-user']).toBe(me.user.sub);
    expect(opening.headers['x-kianda-employee']).toBe(ids[1]);
    expect(opening.json().sheet.employee.id).toBe(ids[1]);
    const payroll = await app.inject({ method: 'GET', url: '/v1/payroll-runs/opening?period=2026-09', headers });
    expect(payroll.statusCode).toBe(403);
    expect(payroll.headers['x-kianda-role']).toBe('employee');
    expect((await app.inject({ method: 'GET', url: '/v1/attendance/opening?period=2026-09', headers: { 'X-Kianda-Role': 'owner' } })).statusCode).toBe(401);
  });

  it('a leitura conjunta conserva a remuneração em vigor e os alertas de documentos', async () => {
    await withTenant(companyId, async () => {
      await getDb().insert(compensationChanges).values([
        { companyId, employeeId: ids[0]!, effectiveDate: '2025-01-01', baseMinor: 42000000, reason: 'Inicial', createdBy: actorId },
        { companyId, employeeId: ids[0]!, effectiveDate: '2026-01-01', baseMinor: 44000000, reason: 'Aumento', createdBy: actorId },
        { companyId, employeeId: ids[0]!, effectiveDate: '2099-01-01', baseMinor: 99000000, reason: 'Futuro', createdBy: actorId },
      ]);
      await getDb().insert(employeeDocuments).values({ companyId, employeeId: ids[0]!, type: 'passport', number: 'SINTETICO', expiryDate: '2020-01-01' });
    });
    const r = await measureQueries(() => request(owner, 'GET', '/v1/employees'));
    expect(r.value.statusCode).toBe(200);
    expect(r.queries).toBeLessThanOrEqual(6); // Licença, uma leitura dos dados e transacção RLS.
    const employee = r.value.json().find((e: { id: string }) => e.id === ids[0]);
    expect(employee.contract.baseMinor).toBe(44000000);
    expect(employee.alerts.some((a: string) => a.includes('Passaporte') && a.includes('caducou'))).toBe(true);
    expect((await request(other, 'GET', '/v1/employees')).json().some((e: { id: string }) => ids.includes(e.id))).toBe(false);
  });

  it('mantém as restrições de licença, incluindo nas rotas com middleware repetido', async () => {
    await withTenant(companyId, () => getDb().update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.companyId, companyId)));
    try {
      expect((await request(owner, 'GET', '/v1/employees')).statusCode).toBe(200);
      expect((await request(owner, 'POST', '/v1/employees', {})).statusCode).toBe(402);
    } finally { await withTenant(companyId, () => getDb().update(subscriptions).set({ status: 'trial' }).where(eq(subscriptions.companyId, companyId))); }
    // O perfil RLS da empresa não pode alterar as licenças; só a preparação administrativa do teste o faz.
    await expect(withTenant(companyId, () => getDb().update(companyModules).set({ enabled: false }).where(eq(companyModules.companyId, companyId)))).rejects.toThrow();
    await getDb().update(companyModules).set({ enabled: false }).where(eq(companyModules.companyId, companyId));
    try {
      expect((await request(owner, 'GET', '/v1/employees')).statusCode).toBe(403);
      expect((await request(owner, 'GET', '/v1/notifications/counts')).statusCode).toBe(403);
      expect((await request(owner, 'GET', '/v1/auth/me')).json().notifications).toEqual({ absences: 0, expenses: 0 });
    } finally { await getDb().update(companyModules).set({ enabled: true }).where(eq(companyModules.companyId, companyId)); }
  });

  it('agrega vários meses sem mais consultas, com totais grandes, meses vazios e pagamento', async () => {
    await withTenant(companyId, async () => {
      const db = getDb();
      const [run] = await db.insert(payrollRuns).values({ companyId, period: '2026-01', status: 'closed', packVersion: 'AO-2026' }).returning();
      await db.insert(payrollLines).values(ids.slice(0, 2).map(employeeId => ({ runId: run!.id, employeeId, netMinor: 3000000000, irtMinor: 200, inssEmployeeMinor: 100, inssEmployerMinor: 400 })));
      await db.insert(payrollPayments).values({ companyId, runId: run!.id, kind: 'salaries', paidOn: '2026-01-31', amountMinor: 6000000000, reference: 'TRF sintética', createdBy: actorId });
    });
    const small = await measureQueries(() => request(owner, 'GET', '/v1/obligations'));
    expect(small.value.statusCode).toBe(200);
    expect(small.value.json()[0].obligations).toMatchObject([{ amountMinor: 6000000000, status: 'paid', reference: 'TRF sintética', reconciled: false }, { amountMinor: 1000 }, { amountMinor: 400 }]);
    await withTenant(companyId, () => getDb().insert(payrollRuns).values(['02', '03', '04', '05', '06', '08', '09', '10', '11'].map(month => ({ companyId, period: `2026-${month}`, status: 'closed' as const, packVersion: 'AO-2026' }))));
    const large = await measureQueries(() => request(owner, 'GET', '/v1/obligations'));
    expect(large.value.statusCode).toBe(200); expect(large.value.json()).toHaveLength(10);
    expect(large.queries).toBe(small.queries);
    expect(large.value.json()[0].obligations.every((o: { amountMinor: number }) => o.amountMinor === 0)).toBe(true);
    expect((await request(other, 'GET', '/v1/obligations')).json()).toEqual([]);
  });

  it('um erro no último colaborador desfaz o recálculo inteiro', async () => {
    expect((await request(owner, 'POST', '/v1/payroll-runs', { period: '2026-07' })).statusCode).toBe(201);
    const before = await withTenant(companyId, () => getDb().select().from(payrollLines));
    await withTenant(companyId, () => getDb().insert(payrollVariables).values([
      { companyId, employeeId: ids[0]!, period: '2026-07', kind: 'bonus', label: 'Alteração inicial', amountMinor: 1000000, createdBy: actorId },
      { companyId, employeeId: ids[2]!, period: '2026-07', kind: 'advance', label: 'Erro final', amountMinor: 500000000, createdBy: actorId },
    ]));
    expect((await request(owner, 'POST', '/v1/payroll-runs', { period: '2026-07' })).statusCode).toBe(422);
    const after = await withTenant(companyId, () => getDb().select().from(payrollLines));
    expect(after).toEqual(before);
  });

  it('abre a folha e as variáveis sem alterar os valores nem o isolamento entre empresas', async () => {
    const opening = await measureQueries(() => request(owner, 'GET', '/v1/payroll-runs/opening?period=2026-07'));
    expect(opening.value.statusCode).toBe(200);
    const data = opening.value.json();
    expect(data.run.lines).toHaveLength(3);
    expect(data.variables).toHaveLength(2);
    expect(data.run).toEqual((await request(owner, 'GET', `/v1/payroll-runs/${data.run.id}`)).json());
    expect(data.variables).toEqual((await request(owner, 'GET', '/v1/payroll-variables?period=2026-07')).json());
    expect(opening.queries).toBeLessThanOrEqual(9);
    expect((await request(other, 'GET', '/v1/payroll-runs/opening?period=2026-07')).json()).toEqual({ run: null, variables: [] });
    expect((await request(sessions.get('manager')!, 'GET', '/v1/payroll-runs/opening?period=2026-07')).statusCode).toBe(403);
    expect((await request(owner, 'GET', '/v1/payroll-runs/opening?period=errado')).statusCode).toBe(400);
  });
});
