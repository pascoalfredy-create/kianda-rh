import { closeDb, getDb, platformAdmins, platformSettings } from '@kianda/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });

const cookieOf = (r: InjectResponse) => {
  const c = r.cookies.find((x) => x.name === 'kianda_session');
  if (!c) throw new Error('sem cookie de sessão');
  return `kianda_session=${c.value}`;
};

describe('rotas públicas', () => {
  it('saúde e pacotes publicados', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toMatchObject({ status: 'ok', packs: ['AO-2026'] });
  });
  it('simulador salarial: 420 000 Kz → 392 744 Kz líquidos', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/payroll/simulate', payload: { period: '2026-10', base: 420000, meal: 30000, transport: 25000 } });
    expect(r.json().netMinor).toBe(39_274_400);
  });
  it('ano sem pacote devolve 422 com explicação', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/payroll/simulate', payload: { period: '2027-01', base: 200000 } });
    expect(r.statusCode).toBe(422);
  });
  it('rotas da empresa exigem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/employees' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: { 'x-company-id': 'qualquer' } })).statusCode).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('autenticação, perfis e fluxo de negócio', () => {
  const stamp = String(Date.now());
  const nifA = stamp.slice(-10);
  const nifB = String(Number(nifA) + 1).padStart(10, '0').slice(-10);
  const pw = 'Segura2026abc';
  let owner = '';
  let payrollUser = '';
  let financeUser = '';
  let employeeUser = '';
  let ownerB = '';
  let empId = '';

  const as = (cookie: string) => ({ cookie });
  const login = async (email: string) => cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: pw, companyNif: nifA } }));

  beforeAll(async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Empresa A', nif: nifA }, name: 'Dona A', email: `dona+${stamp}@a.ao`, password: pw } });
    expect(r.statusCode).toBe(201);
    owner = cookieOf(r);
    const rb = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Empresa B', nif: nifB }, name: 'Dono B', email: `dono+${stamp}@b.ao`, password: pw } });
    ownerB = cookieOf(rb);
  });

  it('recusa palavra-passe fraca no registo', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'X', nif: '9999999999' }, name: 'X', email: 'x@x.ao', password: 'curta' } });
    expect(r.statusCode).toBe(400);
  });

  it('login errado devolve 401 sem revelar se a conta existe', async () => {
    const a = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `dona+${stamp}@a.ao`, password: 'Errada12345' } });
    const b = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'naoexiste@a.ao', password: 'Errada12345' } });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json().message).toBe(b.json().message);
  });

  it('proprietário cria colaborador e utilizadores com perfis', async () => {
    const e = await app.inject({ method: 'POST', url: '/v1/employees', headers: as(owner), payload: {
      number: '10', name: 'Joana Teste', jobTitle: 'Técnica', biNumber: '004512398LA041', iban: 'AO06 0040 0000 5521 8890 1015 5',
      contract: { type: 'indefinite', startDate: '2026-01-05', base: 420000, meal: 30000, transport: 25000 },
    } });
    expect(e.statusCode).toBe(201);
    empId = e.json().id;
    for (const [role, extra] of [['payroll', {}], ['finance', {}], ['employee', { employeeId: empId }]] as const) {
      const r = await app.inject({ method: 'POST', url: '/v1/users', headers: as(owner), payload: { name: role, email: `${role}+${stamp}@a.ao`, password: pw, role, ...extra } });
      expect(r.statusCode).toBe(201);
    }
    payrollUser = await login(`payroll+${stamp}@a.ao`);
    financeUser = await login(`finance+${stamp}@a.ao`);
    employeeUser = await login(`employee+${stamp}@a.ao`);
    const me = (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: as(employeeUser) })).json();
    expect(me.user).toMatchObject({ role: 'employee', employeeId: empId });
  });

  it('colaborador não cria fichas nem vê a lista, mas consulta a sua ficha', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/employees', headers: as(employeeUser), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: as(employeeUser) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/v1/employees/${empId}`, headers: as(employeeUser) })).statusCode).toBe(200);
  });

  it('isolamento entre empresas: a empresa B não vê dados da empresa A', async () => {
    expect((await app.inject({ method: 'GET', url: `/v1/employees/${empId}`, headers: as(ownerB) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/employees', headers: as(ownerB) })).json()).toEqual([]);
  });

  it('valida BI e IBAN ao criar colaborador', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/employees', headers: as(owner), payload: { number: '1', name: 'Ana', jobTitle: 'Técnica', biNumber: '123', iban: 'AO06 0000', contract: { type: 'indefinite', startDate: '2026-01-05', base: 300000 } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['biNumber', 'iban']));
    expect(r.json().issues.find((i: { path: string }) => i.path === 'iban').message).toMatch(/devem ser 21/);
  });

  it('colaborador regista as próprias férias com dias úteis e feriados', async () => {
    const a = await app.inject({ method: 'POST', url: '/v1/absences', headers: as(employeeUser), payload: { employeeId: empId, type: 'vacation', startDate: '2026-10-26', endDate: '2026-11-06' } });
    expect(a.json().workingDays).toBe(9);
    const dup = await app.inject({ method: 'POST', url: '/v1/absences', headers: as(owner), payload: { employeeId: empId, type: 'justified', startDate: '2026-11-02', endDate: '2026-11-03' } });
    expect(dup.statusCode).toBe(409);
  });

  it('processamento com segregação de funções: quem prepara não fecha', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: as(employeeUser), payload: { period: '2026-10' } })).statusCode).toBe(403);
    const draft = await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: as(payrollUser), payload: { period: '2026-10' } });
    expect(draft.statusCode).toBe(201);
    const runId = draft.json().run.id;
    expect((await app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/close`, headers: as(payrollUser) })).statusCode).toBe(403);
    const close = await app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/close`, headers: as(financeUser) });
    expect(close.statusCode).toBe(200);
    expect(close.json().journalReference).toBe('PS-202610');
    const journal = (await app.inject({ method: 'GET', url: '/v1/journal', headers: as(financeUser) })).json();
    const lines = journal[0].lines as { debitMinor: number; creditMinor: number }[];
    expect(lines.reduce((s, l) => s + l.debitMinor, 0)).toBe(lines.reduce((s, l) => s + l.creditMinor, 0));
    expect((await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: as(payrollUser), payload: { period: '2026-10' } })).statusCode).toBe(409);
  });

  describe('ficha do colaborador (entrega 2)', () => {
    let chiefId = '';
    let deptId = '';
    const patch = (cookie: string, id: string, payload: object) => app.inject({ method: 'PATCH', url: `/v1/employees/${id}`, headers: as(cookie), payload });

    it('departamentos, chefia e protecção contra ciclos', async () => {
      const d = await app.inject({ method: 'POST', url: '/v1/departments', headers: as(owner), payload: { name: 'Operações', costCenter: 'cc-ops' } });
      expect(d.json().costCenter).toBe('CC-OPS');
      deptId = d.json().id;
      const c = await app.inject({ method: 'POST', url: '/v1/employees', headers: as(owner), payload: {
        number: '11', name: 'Chefe Teste', jobTitle: 'Directora', departmentId: deptId,
        contract: { type: 'indefinite', startDate: '2025-01-06', base: 1200000 },
      } });
      expect(c.statusCode).toBe(201);
      chiefId = c.json().id;
      const r = await patch(owner, empId, { managerId: chiefId, departmentId: deptId, phone: '923 000 111', nationality: 'Angolana' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ managerId: chiefId, departmentId: deptId, phone: '923 000 111' });
      const cycle = await patch(owner, chiefId, { managerId: empId });
      expect(cycle.statusCode).toBe(400);
      expect(cycle.json().error).toBe('ciclo_hierarquia');
      expect((await patch(owner, empId, { managerId: empId })).json().error).toBe('ciclo_hierarquia');
    });

    it('só RH edita, e nunca fichas de outra empresa', async () => {
      expect((await patch(employeeUser, empId, { phone: '1' })).statusCode).toBe(403);
      expect((await patch(payrollUser, empId, { phone: '1' })).statusCode).toBe(403);
      expect((await patch(ownerB, empId, { phone: '1' })).statusCode).toBe(404);
      const fakeDept = await patch(ownerB, empId, { departmentId: deptId });
      expect(fakeDept.statusCode).toBe(404);
      const otherCo = await app.inject({ method: 'POST', url: '/v1/employees', headers: as(ownerB), payload: { number: '1', name: 'Fulano B', jobTitle: 'Técnico', managerId: chiefId, contract: { type: 'indefinite', startDate: '2026-01-05', base: 200000 } } });
      expect(otherCo.json().error).toBe('chefia_invalida');
      expect((await patch(owner, empId, { iban: 'AO06 1234' })).statusCode).toBe(400);
    });

    it('alteração salarial: salário mínimo, meses fechados e duplicados', async () => {
      const post = (payload: object) => app.inject({ method: 'POST', url: `/v1/employees/${empId}/compensation`, headers: as(owner), payload });
      expect((await post({ effectiveDate: '2026-11-01', base: 90000, reason: 'teste' })).json().error).toBe('abaixo_salario_minimo');
      const closed = await post({ effectiveDate: '2026-10-15', base: 460000, meal: 30000, transport: 25000, reason: 'Actualização' });
      expect(closed.statusCode).toBe(409);
      expect(closed.json().error).toBe('periodo_fechado');
      const ok = await post({ effectiveDate: '2026-11-01', base: 460000, meal: 30000, transport: 25000, reason: 'Actualização anual' });
      expect(ok.statusCode).toBe(201);
      expect((await post({ effectiveDate: '2026-11-01', base: 470000, reason: 'Repetida' })).statusCode).toBe(409);
    });

    it('o processamento usa a remuneração em vigor no fim do mês', async () => {
      const draft = await app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: as(payrollUser), payload: { period: '2026-11' } });
      const run = (await app.inject({ method: 'GET', url: `/v1/payroll-runs/${draft.json().run.id}`, headers: as(payrollUser) })).json();
      const line = run.lines.find((l: { employeeId: string }) => l.employeeId === empId);
      const base = line.breakdown.find((b: { code: string }) => b.code === 'BASE');
      expect(base.amountMinor).toBe(46_000_000);
    });

    it('novo contrato encerra o anterior na véspera', async () => {
      const post = (payload: object) => app.inject({ method: 'POST', url: `/v1/employees/${empId}/contracts`, headers: as(owner), payload });
      expect((await post({ type: 'indefinite', startDate: '2025-12-01', base: 500000 })).statusCode).toBe(400);
      expect((await post({ type: 'fixed_term', startDate: '2026-12-01', endDate: '2027-11-30', base: 500000 })).statusCode).toBe(400);
      const ok = await post({ type: 'indefinite', startDate: '2026-12-01', base: 500000, meal: 30000, transport: 25000 });
      expect(ok.statusCode).toBe(201);
      const ficha = (await app.inject({ method: 'GET', url: `/v1/employees/${empId}`, headers: as(owner) })).json();
      expect(ficha.contracts).toHaveLength(2);
      expect(ficha.contracts[1]).toMatchObject({ terminatedAt: '2026-11-30', terminationReason: 'Substituído por novo contrato' });
      expect(ficha.compensation.upcoming.map((c: { effectiveDate: string }) => c.effectiveDate)).toEqual(['2026-11-01', '2026-12-01']);
      expect(ficha.manager).toMatchObject({ id: chiefId, name: 'Chefe Teste' });
    });

    it('documentos com validade geram alertas e ficam no histórico', async () => {
      const post = (payload: object) => app.inject({ method: 'POST', url: `/v1/employees/${empId}/documents`, headers: as(owner), payload });
      expect((await post({ type: 'bi', number: '12345' })).statusCode).toBe(400);
      const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const d = await post({ type: 'driving_licence', number: 'lu-0099812', issueDate: '2021-03-01', expiryDate: soon, issuer: 'DNVT' });
      expect(d.statusCode).toBe(201);
      expect(d.json().number).toBe('LU-0099812');
      let ficha = (await app.inject({ method: 'GET', url: `/v1/employees/${empId}`, headers: as(owner) })).json();
      expect(ficha.alerts.some((a: string) => a.startsWith('Carta de Condução: caduca em'))).toBe(true);
      expect((await app.inject({ method: 'DELETE', url: `/v1/employees/${empId}/documents/${d.json().id}`, headers: as(employeeUser) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/v1/employees/${empId}/documents/${d.json().id}`, headers: as(owner) })).statusCode).toBe(204);
      ficha = (await app.inject({ method: 'GET', url: `/v1/employees/${empId}`, headers: as(owner) })).json();
      expect(ficha.documents).toHaveLength(0);
      const hist = (await app.inject({ method: 'GET', url: `/v1/employees/${empId}/history`, headers: as(owner) })).json();
      const kinds = hist.map((h: { action: string; entity: string }) => `${h.action}:${h.entity}`);
      expect(kinds).toEqual(expect.arrayContaining(['delete:employee_document', 'create:employee_document', 'create:contract', 'create:compensation', 'update:employee', 'create:employee']));
      expect(hist[0].actorName).toBe('Dona A');
    });

    it('organograma em árvore', async () => {
      const tree = (await app.inject({ method: 'GET', url: '/v1/org-chart', headers: as(financeUser) })).json();
      const chief = tree.find((n: { id: string }) => n.id === chiefId);
      expect(chief.reports.map((r: { id: string }) => r.id)).toEqual([empId]);
      expect((await app.inject({ method: 'GET', url: '/v1/org-chart', headers: as(employeeUser) })).statusCode).toBe(403);
    });
  });

  describe('ausências e férias (entrega 3)', () => {
    let managerUser = '';
    let chiefId = '';
    let vacationId = '';
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });

    beforeAll(async () => {
      chiefId = (await get(owner, `/v1/employees/${empId}`)).json().managerId;
      const r = await post(owner, '/v1/users', { name: 'Chefe', email: `chefe+${stamp}@a.ao`, password: pw, role: 'manager', employeeId: chiefId });
      expect(r.statusCode).toBe(201);
      managerUser = await login(`chefe+${stamp}@a.ao`);
    });

    it('feriados de qualquer ano, mesmo sem pacote fiscal', async () => {
      const h = (await app.inject({ method: 'GET', url: '/v1/holidays/2027' })).json();
      expect(h.find((x: { name: string }) => x.name === 'Sexta-feira Santa').date).toBe('2027-03-26');
    });

    it('a chefia vê e aprova o pedido da equipa; ninguém aprova o próprio', async () => {
      const mine = (await get(employeeUser, '/v1/absences')).json();
      vacationId = mine.find((a: { type: string }) => a.type === 'vacation').id;
      expect((await post(employeeUser, `/v1/absences/${vacationId}/approve`)).statusCode).toBe(403);
      const awaiting = (await get(managerUser, '/v1/absences?awaitingMe=1')).json();
      expect(awaiting.map((a: { id: string }) => a.id)).toContain(vacationId);
      const ok = await post(managerUser, `/v1/absences/${vacationId}/approve`);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('approved');
      expect((await post(managerUser, `/v1/absences/${vacationId}/approve`)).json().error).toBe('estado_invalido');
    });

    it('saldo de férias: 22 dias, 9 gozados, 13 disponíveis; pedido acima do saldo é recusado', async () => {
      const [b] = (await get(employeeUser, `/v1/leave/balances?year=2026&employeeId=${empId}`)).json();
      expect(b).toMatchObject({ entitlement: 22, taken: 9, pending: 0, available: 13, eligibleFrom: '2026-07-05' });
      const r = await post(employeeUser, '/v1/absences', { employeeId: empId, type: 'vacation', startDate: '2026-11-16', endDate: '2026-12-11' });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('saldo_insuficiente');
    });

    it('férias de Dezembro a Janeiro contam em dois saldos (2027 sem pacote fiscal)', async () => {
      const r = await post(employeeUser, '/v1/absences', { employeeId: empId, type: 'vacation', startDate: '2026-12-21', endDate: '2027-01-08' });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ workingDays: 13, status: 'pending' });
      const [b] = (await get(owner, `/v1/leave/balances?year=2026&employeeId=${empId}`)).json();
      expect(b).toMatchObject({ pending: 8, available: 5 });
      const cancel = await post(employeeUser, `/v1/absences/${r.json().id}/cancel`);
      expect(cancel.json().status).toBe('cancelled');
    });

    it('recusa exige motivo', async () => {
      const r = await post(employeeUser, '/v1/absences', { employeeId: empId, type: 'training', startDate: '2026-11-17', endDate: '2026-11-18', reason: 'Curso de Excel' });
      expect((await post(managerUser, `/v1/absences/${r.json().id}/reject`)).statusCode).toBe(400);
      const ok = await post(managerUser, `/v1/absences/${r.json().id}/reject`, { note: 'Fecho do mês' });
      expect(ok.json()).toMatchObject({ status: 'rejected', decisionNote: 'Fecho do mês' });
    });

    it('limites legais, faltas injustificadas e elegibilidade de 6 meses', async () => {
      const pat = await post(employeeUser, '/v1/absences', { employeeId: empId, type: 'paternity', startDate: '2026-11-23', endDate: '2026-12-04' });
      expect(pat.json().error).toBe('limite_legal');
      expect((await post(employeeUser, '/v1/absences', { employeeId: empId, type: 'unjustified', startDate: '2026-11-19', endDate: '2026-11-19' })).statusCode).toBe(403);
      const hr = await post(owner, '/v1/absences', { employeeId: empId, type: 'unjustified', startDate: '2026-11-19', endDate: '2026-11-19', approve: true });
      expect(hr.json()).toMatchObject({ status: 'approved', workingDays: 1 });
      const novo = await post(owner, '/v1/employees', { number: '12', name: 'Recém Admitido', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-09-01', base: 200000 } });
      const early = await post(owner, '/v1/absences', { employeeId: novo.json().id, type: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06' });
      expect(early.statusCode).toBe(422);
      expect(early.json().message).toContain('01/03/2027');
    });

    it('visibilidade: colaborador só as suas, chefia a equipa, outra empresa nada', async () => {
      const mine = (await get(employeeUser, '/v1/absences')).json();
      expect(mine.every((a: { employeeId: string }) => a.employeeId === empId)).toBe(true);
      const team = (await get(managerUser, '/v1/absences')).json();
      expect(team.every((a: { employeeId: string }) => [empId, chiefId].includes(a.employeeId))).toBe(true);
      expect((await get(ownerB, '/v1/absences')).json()).toEqual([]);
      expect((await post(ownerB, `/v1/absences/${vacationId}/cancel`)).statusCode).toBe(404);
    });
  });

  describe('assiduidade (entrega 4)', () => {
    let manager = '';
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    let openId = '';

    beforeAll(async () => { manager = await login(`chefe+${stamp}@a.ao`); });

    it('ponto com a hora do servidor: entrada, entrada repetida, saída imediata', async () => {
      const a = await post(employeeUser, '/v1/attendance/clock', { action: 'in' });
      expect(a.statusCode).toBe(201);
      expect((await post(employeeUser, '/v1/attendance/clock', { action: 'in' })).json().error).toBe('entrada_aberta');
      expect((await post(employeeUser, '/v1/attendance/clock', { action: 'out' })).json().error).toBe('demasiado_cedo');
      const me = (await get(employeeUser, '/v1/attendance/me')).json();
      expect(me.open).toBe(true);
      expect((await post(owner, '/v1/attendance/clock', { action: 'in' })).json().error).toBe('sem_ficha');
      const current = new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);
      expect((await post(manager, '/v1/attendance/approve', { employeeId: empId, period: current })).json().error).toBe('mes_em_curso');
    });

    it('o colaborador não corrige os próprios registos; a chefia sim', async () => {
      const own = await post(employeeUser, '/v1/attendance/entries', { employeeId: empId, date: '2026-09-01', start: '08:00', end: '17:00', note: 'esqueci' });
      expect(own.statusCode).toBe(403);
      const mk = (date: string, start: string, end: string | null) => post(manager, '/v1/attendance/entries', { employeeId: empId, date, start, end, note: 'Registo em papel' });
      expect((await mk('2026-09-01', '08:00', '12:00')).statusCode).toBe(201);
      expect((await mk('2026-09-01', '13:00', '18:00')).statusCode).toBe(201);
      expect((await mk('2026-09-05', '09:00', '12:00')).statusCode).toBe(201);
      const open = await mk('2026-09-02', '08:00', null);
      openId = open.json().id;
      expect((await mk('2026-09-03', '10:00', '09:00')).json().error).toBe('horas_invalidas');
    });

    it('folha do mês: extra em dia útil e em dia de descanso, saídas em falta', async () => {
      const s = (await get(manager, `/v1/attendance/sheet?period=2026-09&employeeId=${empId}`)).json();
      expect(s.summary).toMatchObject({ workedMinutes: 720, overtimeMinutes: 240, restOrHolidayOvertimeMinutes: 180, openDays: 1 });
      expect(s.summary.days.find((d: { date: string }) => d.date === '2026-09-05').flags).toContain('rest_day_work');
      expect(s.canApprove).toBe(true);
      expect((await get(ownerB, `/v1/attendance/sheet?period=2026-09&employeeId=${empId}`)).statusCode).toBe(404);
    });

    it('aprovação: exige saídas completas e motivo para cortar horas; depois bloqueia correcções', async () => {
      expect((await post(manager, '/v1/attendance/approve', { employeeId: empId, period: '2026-09' })).json().error).toBe('saidas_em_falta');
      const fix = await app.inject({ method: 'PATCH', url: `/v1/attendance/entries/${openId}`, headers: as(manager), payload: { end: '17:00', note: 'Saída confirmada pela chefia' } });
      expect(fix.json().out).toBe('17:00');
      expect((await post(manager, '/v1/attendance/approve', { employeeId: empId, period: '2026-09', approvedOvertimeMinutes: 60 })).json().error).toBe('motivo_obrigatorio');
      expect((await post(manager, '/v1/attendance/approve', { employeeId: empId, period: '2026-09', approvedOvertimeMinutes: 9999, note: 'x' })).json().error).toBe('extra_acima');
      const ok = await post(manager, '/v1/attendance/approve', { employeeId: empId, period: '2026-09', approvedOvertimeMinutes: 60, note: 'Sábado não autorizado previamente' });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ overtimeMinutes: 300, approvedOvertimeMinutes: 60 });
      const again = await app.inject({ method: 'PATCH', url: `/v1/attendance/entries/${openId}`, headers: as(manager), payload: { end: '18:00', note: 'tentativa' } });
      expect(again.json().error).toBe('mes_aprovado');
    });

    it('processamento: horas extra aprovadas e faltas injustificadas entram no salário', async () => {
      const draft = await post(payrollUser, '/v1/payroll-runs', { period: '2026-09' });
      const run = (await get(payrollUser, `/v1/payroll-runs/${draft.json().run.id}`)).json();
      const line = run.lines.find((l: { employeeId: string }) => l.employeeId === empId);
      expect(Number(line.overtimeHours)).toBe(1);
      expect(line.breakdown.some((b: { code: string }) => b.code === 'HE')).toBe(true);
      const nov = await post(payrollUser, '/v1/payroll-runs', { period: '2026-11' });
      const novRun = (await get(payrollUser, `/v1/payroll-runs/${nov.json().run.id}`)).json();
      const novLine = novRun.lines.find((l: { employeeId: string }) => l.employeeId === empId);
      expect(novLine.absenceDays).toBe(1);
      expect(novLine.breakdown.some((b: { code: string }) => b.code === 'FALTAS')).toBe(true);
    });

    it('reabrir: só RH, e nunca com o processamento fechado', async () => {
      expect((await post(manager, '/v1/attendance/reopen', { employeeId: empId, period: '2026-09', note: 'corrigir' })).statusCode).toBe(403);
      expect((await post(owner, '/v1/attendance/reopen', { employeeId: empId, period: '2026-10', note: 'corrigir' })).json().error).toBe('periodo_fechado');
      expect((await post(owner, '/v1/attendance/reopen', { employeeId: empId, period: '2026-09', note: 'Rever sábado' })).json()).toEqual({ ok: true });
    });
  });

  describe('processamento completo (entrega 5)', () => {
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const lineOf = async (runId: string) => (await get(payrollUser, `/v1/payroll-runs/${runId}`)).json().lines.find((l: { employeeId: string }) => l.employeeId === empId);
    const codes = (l: { breakdown: { code: string }[] }) => l.breakdown.map((b) => b.code);
    let decRun = '';
    let bigAdvance = '';

    it('variáveis do mês: só o processamento as lança', async () => {
      expect((await post(employeeUser, '/v1/payroll-variables', { employeeId: empId, period: '2026-12', kind: 'bonus', label: 'Prémio', amount: 1 })).statusCode).toBe(403);
      for (const [kind, label, amount] of [['bonus', 'Prémio de desempenho', 50000], ['advance', 'Adiantamento de 10/12', 30000], ['other_deduction', 'Quota sindical', 10000]] as const) {
        expect((await post(payrollUser, '/v1/payroll-variables', { employeeId: empId, period: '2026-12', kind, label, amount })).statusCode).toBe(201);
      }
      bigAdvance = (await post(payrollUser, '/v1/payroll-variables', { employeeId: empId, period: '2026-12', kind: 'advance', label: 'Erro', amount: 5_000_000 })).json().id;
    });

    it('descontos acima do ilíquido são recusados com o nome do colaborador', async () => {
      const r = await post(payrollUser, '/v1/payroll-runs', { period: '2026-12' });
      expect(r.statusCode).toBe(422);
      expect(r.json().message).toContain('Joana Teste');
      expect((await app.inject({ method: 'DELETE', url: `/v1/payroll-variables/${bigAdvance}`, headers: as(payrollUser) })).statusCode).toBe(204);
    });

    it('Dezembro: Natal proporcional ao ano de admissão, subsídio de férias por pagar, variáveis no recibo', async () => {
      const r = await post(payrollUser, '/v1/payroll-runs', { period: '2026-12' });
      expect(r.statusCode).toBe(201);
      decRun = r.json().run.id;
      const l = await lineOf(decRun);
      expect(codes(l)).toEqual(expect.arrayContaining(['BASE', 'BONUS', 'SUBFER', 'SUBNAT', 'ADIANT', 'OUTDESC']));
      const natal = l.breakdown.find((b: { code: string }) => b.code === 'SUBNAT');
      expect(natal.name).toMatch(/proporcional 98[.,]9/);
    });

    it('decisão manual: excluir o subsídio de férias e voltar à regra automática', async () => {
      const off = await post(payrollUser, `/v1/payroll-runs/${decRun}/subsidies`, { employeeId: empId, holiday: false });
      expect(off.statusCode).toBe(200);
      expect(codes(await lineOf(decRun))).not.toContain('SUBFER');
      await post(payrollUser, `/v1/payroll-runs/${decRun}/subsidies`, { employeeId: empId, holiday: null });
      expect(codes(await lineOf(decRun))).toContain('SUBFER');
    });

    it('fecho: lançamento equilibrado com adiantamentos (36.3) e outros descontos (36.9)', async () => {
      const close = await post(financeUser, `/v1/payroll-runs/${decRun}/close`);
      expect(close.statusCode).toBe(200);
      const je = (await get(financeUser, '/v1/journal')).json().find((j: { reference: string }) => j.reference === 'PS-202612');
      const d = je.lines.reduce((s: number, x: { debitMinor: number }) => s + x.debitMinor, 0);
      const cr = je.lines.reduce((s: number, x: { creditMinor: number }) => s + x.creditMinor, 0);
      expect(d).toBe(cr);
      expect(je.lines.find((x: { account: string }) => x.account === '36.9').creditMinor).toBe(1_000_000);
      expect(je.lines.find((x: { account: string }) => x.account === '36.3').creditMinor).toBe(3_000_000);
      expect((await post(payrollUser, '/v1/payroll-variables', { employeeId: empId, period: '2026-12', kind: 'bonus', label: 'Tarde', amount: 1 })).json().error).toBe('processamento_fechado');
    });

    it('nunca paga o mesmo subsídio duas vezes no ano', async () => {
      const nov = (await get(payrollUser, '/v1/payroll-runs?period=2026-11')).json()[0];
      const r = await post(payrollUser, `/v1/payroll-runs/${nov.id}/subsidies`, { employeeId: empId, christmas: true });
      expect(r.json().warnings.map((w: { message: string }) => w.message)).toEqual(expect.arrayContaining([expect.stringContaining('subsídio de Natal de 2026 já foi pago')]));
      expect(codes(await lineOf(nov.id))).not.toContain('SUBNAT');
    });

    it('recibos: o colaborador vê só os seus e só de processamentos fechados', async () => {
      const list = (await get(employeeUser, '/v1/payslips')).json();
      expect(list.map((p: { period: string }) => p.period)).toEqual(expect.arrayContaining(['2026-12', '2026-10']));
      expect(list.map((p: { period: string }) => p.period)).not.toContain('2026-11');
      const slip = (await get(employeeUser, `/v1/payslips/${list[0].id}`)).json();
      expect(slip).toMatchObject({ period: '2026-12', employee: { name: 'Joana Teste' }, company: { name: 'Empresa A' } });
      expect(slip.hash).toMatch(/^[0-9a-f]{64}$/);
      const run = (await get(payrollUser, `/v1/payroll-runs/${decRun}`)).json();
      const other = run.lines.find((l: { employeeId: string }) => l.employeeId !== empId).id;
      expect((await get(employeeUser, `/v1/payslips/${other}`)).statusCode).toBe(404);
      expect((await get(ownerB, `/v1/payslips/${list[0].id}`)).statusCode).toBe(404);
    });

    it('definições: mês do subsídio de Natal configurável pelo RH', async () => {
      expect((await app.inject({ method: 'PATCH', url: '/v1/company/settings', headers: as(payrollUser), payload: { christmasSubsidyMonth: 11 } })).statusCode).toBe(403);
      const r = await app.inject({ method: 'PATCH', url: '/v1/company/settings', headers: as(owner), payload: { christmasSubsidyMonth: 11, holidaySubsidyMonth: 6 } });
      expect(r.json()).toMatchObject({ christmasSubsidyMonth: 11, holidaySubsidyMonth: 6 });
    });
  });

  describe('obrigações e pagamentos (entrega 6)', () => {
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    let oct = '';
    let dec = '';
    let nov = '';
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

    beforeAll(async () => {
      oct = (await get(payrollUser, '/v1/payroll-runs?period=2026-10')).json()[0].id;
      dec = (await get(payrollUser, '/v1/payroll-runs?period=2026-12')).json()[0].id;
      nov = (await get(payrollUser, '/v1/payroll-runs?period=2026-11')).json()[0].id;
    });

    it('obrigações dos processamentos fechados com prazos legais', async () => {
      expect((await get(employeeUser, '/v1/obligations')).statusCode).toBe(403);
      const list = (await get(financeUser, '/v1/obligations')).json();
      expect(list.map((r: { period: string }) => r.period)).toEqual(['2026-12', '2026-10']);
      const o = list[1].obligations;
      expect(o.map((x: { kind: string; dueDate: string }) => [x.kind, x.dueDate])).toEqual([['salaries', '2026-10-31'], ['inss', '2026-11-10'], ['irt', '2026-11-30']]);
      const run = (await get(financeUser, `/v1/payroll-runs/${oct}`)).json();
      const inss = run.lines.reduce((s: number, l: { inssEmployeeMinor: number; inssEmployerMinor: number }) => s + l.inssEmployeeMinor + l.inssEmployerMinor, 0);
      expect(o[1].amountMinor).toBe(inss);
    });

    it('pagamento pelas Finanças gera o lançamento PGC e não se repete', async () => {
      expect((await post(payrollUser, `/v1/payroll-runs/${oct}/payments`, { kind: 'salaries', paidOn: '2026-10-30' })).statusCode).toBe(403);
      expect((await post(financeUser, `/v1/payroll-runs/${oct}/payments`, { kind: 'salaries', paidOn: '2099-01-01' })).json().error).toBe('data_futura');
      const r = await post(financeUser, `/v1/payroll-runs/${oct}/payments`, { kind: 'salaries', paidOn: today, reference: 'TRF BFA 0099' });
      expect(r.statusCode).toBe(201);
      expect(r.json().journalReference).toBe('PG-SAL-202610');
      const je = (await get(financeUser, '/v1/journal')).json().find((j: { reference: string }) => j.reference === 'PG-SAL-202610');
      expect(je.lines.map((l: { account: string }) => l.account)).toEqual(['36.1.2', '43.1']);
      expect(je.lines[0].debitMinor).toBe(je.lines[1].creditMinor);
      expect((await post(financeUser, `/v1/payroll-runs/${oct}/payments`, { kind: 'salaries', paidOn: today })).json().error).toBe('ja_pago');
      const o = (await get(financeUser, '/v1/obligations')).json()[1].obligations[0];
      expect(o).toMatchObject({ status: 'paid', paidAt: today, reference: 'TRF BFA 0099' });
    });

    it('estorno com motivo: lançamento inverso, obrigação volta a estar por pagar', async () => {
      expect((await post(financeUser, `/v1/payroll-runs/${oct}/payments/salaries/reverse`, {})).statusCode).toBe(400);
      const r = await post(financeUser, `/v1/payroll-runs/${oct}/payments/salaries/reverse`, { note: 'Transferência devolvida pelo banco' });
      expect(r.json().journalReference).toMatch(/^ES-SAL-202610-/);
      const es = (await get(financeUser, '/v1/journal')).json().find((j: { reference: string }) => j.reference === r.json().journalReference);
      expect(es.lines.map((l: { account: string; debitMinor: number }) => [l.account, l.debitMinor > 0])).toEqual([['36.1.2', false], ['43.1', true]]);
      expect((await get(financeUser, '/v1/obligations')).json()[1].obligations[0].paidAt).toBeNull();
    });

    it('mapa de IRT em CSV para Excel e em JSON', async () => {
      const csv = await get(financeUser, `/v1/payroll-runs/${dec}/maps/irt?format=csv`);
      expect(csv.body.replace(/^\uFEFF/, '').startsWith('N.º;Nome;NIF/BI;Rendimento ilíquido')).toBe(true);
      expect(csv.body).toContain('Joana Teste');
      expect(csv.body).toMatch(/;TOTAL;/);
      const json = (await get(financeUser, `/v1/payroll-runs/${dec}/maps/irt`)).json();
      const run = (await get(financeUser, `/v1/payroll-runs/${dec}`)).json();
      expect(json.totalIrt).toBe(run.lines.reduce((s: number, l: { irtMinor: number }) => s + l.irtMinor, 0));
      expect(json.rows.find((r: { name: string }) => r.name === 'Joana Teste').taxable).toBeGreaterThan(0);
      expect((await get(financeUser, `/v1/payroll-runs/${nov}/maps/irt`)).json().error).toBe('processamento_aberto');
    });

    it('folha do INSS assinala colaboradores sem n.º de segurança social', async () => {
      const j = (await get(payrollUser, `/v1/payroll-runs/${dec}/maps/inss`)).json();
      expect(j.missingInssNumber).toContain('Joana Teste');
      const joana = j.rows.find((r: { name: string }) => r.name === 'Joana Teste');
      expect(joana.employee).toBe(Math.round(joana.base * 0.03));
    });

    it('ficheiro de transferência: só IBAN válido; os restantes são listados', async () => {
      const info = (await get(financeUser, `/v1/payroll-runs/${dec}/bank-file?format=json`)).json();
      expect(info.excluded.map((x: { name: string; reason: string }) => [x.name, x.reason])).toEqual(expect.arrayContaining([['Chefe Teste', 'sem IBAN']]));
      const csv = (await get(financeUser, `/v1/payroll-runs/${dec}/bank-file`)).body;
      expect(csv).toContain('AO06004000005521889010155;Joana Teste;');
      expect(csv).toContain('SALARIO 12/2026');
      expect(csv).not.toContain('Chefe Teste');
    });
  });

  describe('finanças de pessoal (entrega 7)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

    it('balancete do período equilibrado, com saldos devedores e credores', async () => {
      expect((await get(employeeUser, '/v1/ledger/trial-balance?from=2026-10-01&to=2026-12-31')).statusCode).toBe(403);
      const tb = (await get(financeUser, '/v1/ledger/trial-balance?from=2026-10-01&to=2026-12-31')).json();
      expect(tb.totals.balanced).toBe(true);
      const acc = (code: string) => tb.rows.find((r: { account: string }) => r.account === code);
      expect(acc('72.2.1').closingMinor).toBeGreaterThan(0);
      expect(acc('34.3').closingMinor).toBeLessThan(0);
      expect(acc('43.1').closingMinor).toBe(0); // pagamento de salários e respectivo estorno
      expect(acc('72.2.1').label).toBe('Remunerações do pessoal — vencimento base');
      const csv = (await get(financeUser, '/v1/ledger/trial-balance?from=2026-10-01&to=2026-12-31&format=csv')).body;
      expect(csv.replace(/^\uFEFF/, '').startsWith('Conta;Descrição;Saldo inicial devedor')).toBe(true);
    });

    it('razão da conta com saldo acumulado', async () => {
      const r = (await get(financeUser, '/v1/ledger/account?code=36.1.2&from=2026-10-01&to=2026-12-31')).json();
      expect(r.movements.length).toBeGreaterThanOrEqual(4);
      expect(r.closingMinor).toBe(r.movements.at(-1).balanceMinor);
    });

    it('plano de contas: classes validadas; alterações valem para lançamentos futuros', async () => {
      const plan = (await get(financeUser, '/v1/ledger/accounts')).json();
      expect(plan.find((p: { role: string }) => p.role === 'bank')).toMatchObject({ account: '43.1', expectedClass: '4' });
      const put = (cookie: string, mappings: object[]) => app.inject({ method: 'PUT', url: '/v1/ledger/accounts', headers: as(cookie), payload: { mappings } });
      expect((await put(payrollUser, [{ role: 'bank', account: '43.1.2', label: 'BAI — salários' }])).statusCode).toBe(403);
      const bad = await put(financeUser, [{ role: 'baseSalary', account: '62.1', label: 'Errado' }]);
      expect(bad.json().error).toBe('plano_invalido');
      expect(bad.json().message).toContain('Classe 7');
      expect((await put(financeUser, [{ role: 'bank', account: '43.1.2', label: 'BAI — conta de salários' }])).statusCode).toBe(200);
      const oct = (await get(financeUser, '/v1/payroll-runs?period=2026-10')).json()[0].id;
      const pay = await app.inject({ method: 'POST', url: `/v1/payroll-runs/${oct}/payments`, headers: as(financeUser), payload: { kind: 'irt', paidOn: today } });
      expect(pay.statusCode).toBe(201);
      const je = (await get(financeUser, `/v1/ledger/journal?from=${today}&to=${today}&source=payroll_payment`)).json().find((j: { reference: string }) => j.reference === 'PG-IRT-202610');
      expect(je.lines.map((l: { account: string }) => l.account)).toEqual(['34.3', '43.1.2']);
      const ps = (await get(financeUser, '/v1/ledger/journal?from=2026-10-01&to=2026-10-31&source=payroll')).json()[0];
      expect(ps).toMatchObject({ reference: 'PS-202610', date: '2026-10-31' });
      expect(ps.lines.some((l: { account: string }) => l.account === '43.1.2')).toBe(false);
    });

    it('exportação para o ERP: só os novos, e marcação para não repetir', async () => {
      const csv = (await get(financeUser, '/v1/ledger/export?from=2026-10-01&to=2026-12-31&onlyNew=1')).body;
      expect(csv).toContain('PS-202610');
      expect(csv).toContain('31/10/2026;Pessoal;PS-202610');
      expect((await app.inject({ method: 'POST', url: '/v1/ledger/export/mark', headers: as(payrollUser), payload: { from: '2026-10-01', to: '2026-12-31' } })).statusCode).toBe(403);
      const mark = await app.inject({ method: 'POST', url: '/v1/ledger/export/mark', headers: as(financeUser), payload: { from: '2026-10-01', to: '2026-12-31' } });
      expect(mark.json().marked).toBeGreaterThan(0);
      const again = (await get(financeUser, '/v1/ledger/export?from=2026-10-01&to=2026-12-31&onlyNew=1')).body;
      expect(again.replace(/^\uFEFF/, '').trim().split('\r\n')).toHaveLength(1);
    });
  });

  describe('conciliação bancária (entrega 8)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const pt = (d: string) => d.split('-').reverse().join('/');
    const kzs = (m: number) => { const v = (Math.abs(m) / 100).toFixed(2).split('.'); return `${v[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${v[1]}`; };
    let accountId = '';
    let oct = '';
    let salaries = 0;
    let irt = 0;
    let csv = '';

    it('conta bancária: só Finanças cria; conta PGC da classe 4; IBAN validado', async () => {
      expect((await post(payrollUser, '/v1/bank/accounts', { name: 'BAI', ledgerAccount: '43.1' })).statusCode).toBe(403);
      expect((await post(financeUser, '/v1/bank/accounts', { name: 'BAI', ledgerAccount: '62.1' })).statusCode).toBe(400);
      expect((await post(financeUser, '/v1/bank/accounts', { name: 'BAI', ledgerAccount: '43.1', iban: 'AO06 1234' })).json().error).toBe('iban_invalido');
      const r = await post(financeUser, '/v1/bank/accounts', { name: 'BAI — salários', bankName: 'BAI', ledgerAccount: '43.1' });
      expect(r.statusCode).toBe(201);
      accountId = r.json().id;
      expect((await get(ownerB, `/v1/bank/reconciliation?accountId=${accountId}`)).statusCode).toBe(404);
    });

    it('pré-visualiza e importa o extracto; concilia automaticamente o IRT já registado', async () => {
      const obl = (await get(financeUser, '/v1/obligations')).json().find((r: { period: string }) => r.period === '2026-10');
      oct = obl.runId;
      salaries = obl.obligations.find((o: { kind: string }) => o.kind === 'salaries').amountMinor;
      irt = obl.obligations.find((o: { kind: string }) => o.kind === 'irt').amountMinor;
      const rows = [
        [today, 'TRF RECEBIDA CLIENTE', 0, 50_000_000],
        [today, 'PAG AGT IRT GRUPO A 10/2026', irt, 0],
        [today, 'TRF SALARIOS 10/2026', salaries, 0],
        [today, 'COMISSAO MANUTENCAO', 150_000, 0],
      ] as const;
      let bal = 100_000_000;
      const lines = rows.map(([d, desc, deb, cred]) => { bal += cred - deb; return `${pt(d)};${pt(d)};${desc};${deb ? kzs(deb) : ''};${cred ? kzs(cred) : ''};${kzs(bal)}`; });
      csv = `Extracto BAI\nConta;0040 0000\n\nData Mov.;Data Valor;Descritivo;Débito;Crédito;Saldo\n${lines.reverse().join('\n')}\n`;
      const pv = (await post(financeUser, '/v1/bank/statements/preview', { accountId, text: csv })).json();
      expect(pv).toMatchObject({ headerRow: 3, count: 4, newCount: 4, duplicates: 0, balance: { ok: true, openingMinor: 100_000_000 } });
      expect((await post(payrollUser, '/v1/bank/statements', { accountId, text: csv })).statusCode).toBe(403);
      const imp = await post(financeUser, '/v1/bank/statements', { accountId, fileName: 'extracto-out.csv', text: csv });
      expect(imp.statusCode).toBe(201);
      expect(imp.json()).toMatchObject({ count: 4, newCount: 4, matched: 1 });
      const again = (await post(financeUser, '/v1/bank/statements', { accountId, text: csv })).json();
      expect(again).toMatchObject({ newCount: 0, duplicates: 4, matched: 0 });
    });

    it('obrigação por pagar com movimento correspondente: regista o pagamento a partir do extracto', async () => {
      const rec = (await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}`)).json();
      expect(rec.summary).toMatchObject({ matched: 1, pendingDebits: 2 });
      expect(rec.payments.find((p: { kind: string; period: string }) => p.kind === 'irt' && p.period === '2026-10')).toBeUndefined();
      const sal = rec.unpaid.find((u: { kind: string; period: string }) => u.kind === 'salaries' && u.period === '2026-10');
      expect(sal.candidate.lineIds).toHaveLength(1);
      const commission = rec.lines.find((l: { description: string }) => l.description === 'COMISSAO MANUTENCAO').id;
      expect((await post(financeUser, '/v1/bank/register-payment', { accountId, runId: oct, kind: 'salaries', lineIds: [commission] })).json().error).toBe('valor_diferente');
      const r = await post(financeUser, '/v1/bank/register-payment', { accountId, runId: oct, kind: 'salaries', lineIds: sal.candidate.lineIds });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ paidOn: today, reference: 'TRF SALARIOS 10/2026', bankAccountId: accountId });
      const o = (await get(financeUser, '/v1/obligations')).json().find((x: { period: string }) => x.period === '2026-10').obligations.find((x: { kind: string }) => x.kind === 'salaries');
      expect(o).toMatchObject({ status: 'paid', reconciled: true });
    });

    it('movimentos que não são de pessoal: ignorar com motivo e repor', async () => {
      const rec = (await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}`)).json();
      const ids = rec.lines.filter((l: { status: string }) => l.status === 'pending').map((l: { id: string }) => l.id);
      expect(ids).toHaveLength(2);
      expect((await post(financeUser, '/v1/bank/lines/ignore', { lineIds: ids, note: '' })).statusCode).toBe(400);
      expect((await post(financeUser, '/v1/bank/lines/ignore', { lineIds: ids, note: 'Não é de pessoal' })).json().ignored).toBe(2);
      expect((await post(financeUser, `/v1/bank/lines/${ids[0]}/restore`, {})).statusCode).toBe(200);
      expect((await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}`)).json().summary).toMatchObject({ pending: 1, outOfScope: 1, matched: 2 });
    });

    it('desfazer e conciliar manualmente; valores têm de bater; extracto conciliado não se apaga', async () => {
      const rec = (await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}&status=matched`)).json();
      const irtLine = rec.lines.find((l: { description: string }) => l.description.includes('IRT'));
      expect(irtLine.match).toMatchObject({ kind: 'auto', payment: 'IRT retido (Grupo A) 2026-10' });
      expect((await app.inject({ method: 'DELETE', url: `/v1/bank/matches/${irtLine.matchId}`, headers: as(financeUser) })).statusCode).toBe(200);
      const after = (await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}`)).json();
      const pay = after.payments.find((p: { kind: string; period: string }) => p.kind === 'irt' && p.period === '2026-10');
      expect(pay.suggestion.lineIds).toEqual([irtLine.id]);
      const other = after.lines.find((l: { status: string; amountMinor: number }) => l.status === 'pending' && l.id !== irtLine.id);
      if (other) expect((await post(financeUser, '/v1/bank/matches', { accountId, paymentId: pay.id, lineIds: [other.id] })).statusCode).toBe(400);
      expect((await post(financeUser, '/v1/bank/matches', { accountId, paymentId: pay.id, lineIds: [irtLine.id] })).statusCode).toBe(201);
      const st = (await get(financeUser, `/v1/bank/statements?accountId=${accountId}`)).json();
      expect(st).toHaveLength(2);
      expect(st.find((s: { newCount: number }) => s.newCount === 4).balanceOk).toBe(true);
      expect((await app.inject({ method: 'DELETE', url: `/v1/bank/statements/${st.find((s: { newCount: number }) => s.newCount === 4).id}`, headers: as(financeUser) })).json().error).toBe('extracto_conciliado');
      expect((await app.inject({ method: 'DELETE', url: `/v1/bank/statements/${st.find((s: { newCount: number }) => s.newCount === 0).id}`, headers: as(financeUser) })).statusCode).toBe(200);
    });

    it('estorno de um pagamento conciliado devolve o movimento a "por conciliar"', async () => {
      const r = await post(financeUser, `/v1/payroll-runs/${oct}/payments/salaries/reverse`, { note: 'Teste de estorno' });
      expect(r.statusCode).toBe(200);
      const rec = (await get(financeUser, `/v1/bank/reconciliation?accountId=${accountId}`)).json();
      expect(rec.lines.some((l: { description: string }) => l.description === 'TRF SALARIOS 10/2026')).toBe(true);
      expect(rec.unpaid.find((u: { kind: string; period: string }) => u.kind === 'salaries' && u.period === '2026-10').candidate).not.toBeNull();
    });
  });

  describe('despesas e ajudas de custo (entrega 9)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    let manager = '';
    let claimId = '';
    const lines = [
      { kind: 'expense', date: today, description: 'Hotel Lobito', category: 'lodging', amount: 45000, documentRef: 'FT 2026/118' },
      { kind: 'per_diem', date: today, description: 'Deslocação ao Lobito', zone: 'national', days: 2.5, rate: 20000 },
    ];

    beforeAll(async () => { manager = await login(`chefe+${stamp}@a.ao`); });

    it('diária da empresa nas definições', async () => {
      const r = await app.inject({ method: 'PATCH', url: '/v1/company/settings', headers: as(owner), payload: { perDiemNationalMinor: 2_000_000 } });
      expect(r.json().perDiemNationalMinor).toBe(2_000_000);
    });

    it('o colaborador cria, completa e submete a nota; numeração por ano', async () => {
      expect((await post(employeeUser, '/v1/expenses', { title: 'Deslocação ao Lobito', employeeId: 'outro', lines })).statusCode).toBe(403);
      const r = await post(employeeUser, '/v1/expenses', { title: 'Deslocação ao Lobito', lines: [{ ...lines[0], documentRef: '' }] });
      expect(r.statusCode).toBe(201);
      claimId = r.json().id;
      expect(r.json().number).toMatch(/^ND-\d{4}-0001$/);
      expect((await post(employeeUser, `/v1/expenses/${claimId}/submit`)).json().message).toContain('recibo ou factura');
      const over = await app.inject({ method: 'PUT', url: `/v1/expenses/${claimId}`, headers: as(employeeUser), payload: { title: 'Deslocação ao Lobito', lines: [lines[0], { ...lines[1], rate: 25000 }] } });
      expect(over.statusCode).toBe(200);
      expect((await post(employeeUser, `/v1/expenses/${claimId}/submit`)).json().message).toContain('acima da fixada');
      await app.inject({ method: 'PUT', url: `/v1/expenses/${claimId}`, headers: as(employeeUser), payload: { title: 'Deslocação ao Lobito', tripFrom: today, tripTo: today, lines } });
      const d = (await get(employeeUser, `/v1/expenses/${claimId}`)).json();
      expect(d.totals).toEqual({ expensesMinor: 4_500_000, perDiemMinor: 5_000_000, totalMinor: 9_500_000 });
      expect(d.lines[1].days).toBe(2.5);
      expect((await post(employeeUser, `/v1/expenses/${claimId}/submit`)).json().status).toBe('submitted');
      expect((await app.inject({ method: 'PUT', url: `/v1/expenses/${claimId}`, headers: as(employeeUser), payload: { title: 'Alterada', lines } })).json().error).toBe('nao_editavel');
    });

    it('a chefia directa decide; o próprio não; recusa exige motivo; aprovação gera lançamento', async () => {
      expect((await get(manager, '/v1/expenses?scope=approve')).json().map((x: { id: string }) => x.id)).toContain(claimId);
      expect((await post(employeeUser, `/v1/expenses/${claimId}/decision`, { approve: true })).statusCode).toBe(403);
      expect((await post(manager, `/v1/expenses/${claimId}/decision`, { approve: false })).json().error).toBe('motivo_obrigatorio');
      const ok = await post(manager, `/v1/expenses/${claimId}/decision`, { approve: true, note: 'Ok' });
      expect(ok.json().status).toBe('approved');
      const je = (await get(financeUser, `/v1/ledger/journal?from=${today}&to=${today}`)).json().find((j: { reference: string }) => j.reference === ok.json().number);
      expect(je.lines.map((l: { account: string; debitMinor: number; creditMinor: number }) => [l.account, l.debitMinor, l.creditMinor])).toEqual([['75.2', 4_500_000, 0], ['72.8', 5_000_000, 0], ['36.9', 0, 9_500_000]]);
    });

    it('Finanças reembolsa (ficheiro de transferências, lançamento, conciliação bancária) e pode estornar', async () => {
      expect((await get(financeUser, '/v1/expenses?scope=pay')).json().map((x: { id: string }) => x.id)).toContain(claimId);
      expect((await post(payrollUser, `/v1/expenses/${claimId}/pay`, { paidOn: today })).statusCode).toBe(403);
      const account = (await get(financeUser, '/v1/bank/accounts')).json()[0];
      const paid = await post(financeUser, `/v1/expenses/${claimId}/pay`, { paidOn: today, reference: 'TRF 777', bankAccountId: account.id });
      expect(paid.json()).toMatchObject({ status: 'paid', paidOn: today });
      const rec = (await get(financeUser, `/v1/bank/reconciliation?accountId=${account.id}`)).json();
      const p = rec.payments.find((x: { id: string }) => x.id === `exp:${claimId}`);
      expect(p).toMatchObject({ kind: 'expense', amountMinor: 9_500_000 });
      const csv = `Data;Descritivo;Montante\n${today.split('-').reverse().join('/')};TRF REEMB DESPESAS;-95.000,00\n`;
      expect((await post(financeUser, '/v1/bank/statements', { accountId: account.id, text: csv })).json().matched).toBe(1);
      expect((await post(financeUser, `/v1/expenses/${claimId}/reverse-payment`, { note: 'Transferência devolvida' })).statusCode).toBe(200);
      const after = (await get(financeUser, `/v1/expenses/${claimId}`)).json();
      expect(after).toMatchObject({ status: 'approved', matchId: null });
      expect((await get(financeUser, '/v1/expenses-bank-file')).statusCode).toBe(200);
      const again = await post(financeUser, `/v1/expenses/${claimId}/pay`, { paidOn: today });
      expect(again.json().status).toBe('paid');
    });

    it('colaborador só vê as suas; notas pagas não se anulam', async () => {
      expect((await get(employeeUser, '/v1/expenses?scope=all')).json()).toEqual([]);
      expect((await post(employeeUser, `/v1/expenses/${claimId}/cancel`)).json().error).toBe('estado_invalido');
      expect((await get(ownerB, `/v1/expenses/${claimId}`)).statusCode).toBe(404);
    });
  });

  describe('cessação de contrato (entrega 10)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    let leaverId = '';
    let terminationId = '';
    const kase = () => ({ employeeId: leaverId, reason: 'objective_dismissal', effectiveDate: '2026-11-15', noticeDate: '2026-11-01' });

    beforeAll(async () => {
      const e = await post(owner, '/v1/employees', {
        number: '77', name: 'Saída Teste', jobTitle: 'Motorista', biNumber: '004512399LA041', iban: 'AO06 0040 0000 5521 8890 1015 5',
        contract: { type: 'indefinite', startDate: '2019-03-01', base: 300000, meal: 30000, transport: 25000 },
      });
      expect(e.statusCode).toBe(201);
      leaverId = e.json().id;
      expect((await post(owner, '/v1/users', { name: 'Saída', email: `saida+${stamp}@a.ao`, password: pw, role: 'employee', employeeId: leaverId })).statusCode).toBe(201);
    });

    it('pré-visualiza o fecho de contas: compensação legal, aviso em falta, férias e recibo final estimado', async () => {
      expect((await post(payrollUser, '/v1/terminations/preview', kase())).statusCode).toBe(403);
      const p = (await post(owner, '/v1/terminations/preview', kase())).json();
      expect(p.proposal.seniority).toMatchObject({ years: 7, months: 8 });
      expect(p.proposal.notice).toMatchObject({ requiredDays: 30, givenDays: 14, missingDays: 16 });
      const by = (c: string) => p.items.find((i: { code: string }) => i.code === c)?.amountMinor;
      expect(by('COMP')).toBe(30_000_000 * 5 + 15_000_000 * 2);
      expect(by('AVISO')).toBe(16_000_000);
      expect(by('FERNG')).toBe(30_000_000); // 22 dias por gozar = 1 mês
      expect(p.payslip.lines.find((l: { code: string }) => l.code === 'BASE')).toMatchObject({ name: 'Vencimento base (15 dia(s))', amountMinor: 15_000_000 });
      expect(p.payslip.netMinor).toBeGreaterThan(by('COMP'));
    });

    it('rascunho com ajuste manual; confirmação cessa contrato, desactiva o acesso e põe o fecho no processamento', async () => {
      const p = (await post(owner, '/v1/terminations/preview', kase())).json();
      const items = [...p.items, { code: 'OUTDESC', label: 'Devolução de telemóvel não efectuada', basis: 'Acordo', kind: 'deduction', amountMinor: 5_000_000, inInss: false, inIrt: false }];
      const r = await post(owner, '/v1/terminations', { ...kase(), items, note: 'Extinção do posto (reestruturação logística)' });
      expect(r.statusCode).toBe(201);
      terminationId = r.json().id;
      expect((await post(owner, '/v1/terminations', kase())).json().error).toBe('cessacao_existente');
      const c = await post(owner, `/v1/terminations/${terminationId}/confirm`);
      expect(c.json().status).toBe('confirmed');
      expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `saida+${stamp}@a.ao`, password: pw } })).json().error).toBe('acesso_desactivado');
      expect((await get(owner, `/v1/employees/${leaverId}`)).json().status).toBe('terminated');
      const vars = (await get(payrollUser, '/v1/payroll-variables?period=2026-11')).json().filter((v: { employeeId: string }) => v.employeeId === leaverId);
      expect(vars.map((v: { code: string }) => v.code)).toContain('COMP');
      expect((await app.inject({ method: 'DELETE', url: `/v1/payroll-variables/${vars[0].id}`, headers: as(payrollUser) })).json().error).toBe('gerida_pela_cessacao');
      await post(payrollUser, '/v1/payroll-runs', { period: '2026-11' });
      const run = (await get(payrollUser, '/v1/payroll-runs?period=2026-11')).json()[0];
      const detail = (await get(payrollUser, `/v1/payroll-runs/${run.id}`)).json();
      const line = detail.lines.find((l: { employeeId: string }) => l.employeeId === leaverId);
      const codes = line.breakdown.map((b: { code: string }) => b.code);
      expect(codes).toEqual(expect.arrayContaining(['BASE', 'COMP', 'AVISO', 'FERNG', 'OUTDESC']));
      expect(line.breakdown.find((b: { code: string }) => b.code === 'BASE').amountMinor).toBe(15_000_000);
      const dec = (await get(payrollUser, '/v1/payroll-runs?period=2026-12')).json()[0];
      if (dec) expect((await get(payrollUser, `/v1/payroll-runs/${dec.id}`)).json().lines.some((l: { employeeId: string }) => l.employeeId === leaverId)).toBe(false);
    });

    it('documentos: dados para fecho de contas e certificado; anular reverte tudo enquanto o mês não fecha', async () => {
      const d = (await get(financeUser, `/v1/terminations/${terminationId}`)).json();
      expect(d).toMatchObject({ reasonLabel: 'Despedimento individual por causas objectivas', hireDate: '2019-03-01', employee: { name: 'Saída Teste' } });
      expect(d.totals.deductionsMinor).toBe(5_000_000);
      expect((await post(owner, `/v1/terminations/${terminationId}/cancel`, {})).statusCode).toBe(400);
      expect((await post(owner, `/v1/terminations/${terminationId}/cancel`, { note: 'Acordo de permanência' })).json().status).toBe('cancelled');
      expect((await get(owner, `/v1/employees/${leaverId}`)).json().status).toBe('active');
      expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `saida+${stamp}@a.ao`, password: pw } })).statusCode).toBe(200);
      expect((await get(payrollUser, '/v1/payroll-variables?period=2026-11')).json().some((v: { employeeId: string }) => v.employeeId === leaverId)).toBe(false);
    });
  });

  describe('documentos (entrega 11)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    let docId = '';
    let code = '';

    it('modelos do Kianda versionados com o pacote; pré-visualização com campos preenchidos e em falta', async () => {
      expect((await get(employeeUser, '/v1/document-templates')).statusCode).toBe(403);
      const t = (await get(owner, '/v1/document-templates')).json();
      expect(t.templates.find((x: { key: string }) => x.key === 'declaracao_servico')).toMatchObject({ source: 'kianda', version: expect.stringMatching(/^AO-2026/) });
      const p = (await post(owner, '/v1/documents/preview', { employeeId: empId, templateKey: 'declaracao_rendimentos', inputs: {} })).json();
      expect(p.text).toContain('Joana Teste');
      expect(p.text).toMatch(/kwanzas/);
      expect(p.missingLabels).toEqual(['Finalidade']);
      expect((await post(owner, '/v1/documents', { employeeId: empId, templateKey: 'declaracao_rendimentos', inputs: {} })).json().error).toBe('campos_em_falta');
    });

    it('emite com número anual e código; o colaborador vê os seus; verificação pública sem conteúdo; anulação', async () => {
      const r = await post(owner, '/v1/documents', { employeeId: empId, templateKey: 'declaracao_servico', inputs: { 'pedido.finalidade': 'abertura de conta bancária' } });
      expect(r.statusCode).toBe(201);
      docId = r.json().id;
      code = r.json().verificationCode;
      expect(r.json().number).toMatch(/^DOC-\d{4}-0001$/);
      expect(r.json().body).toContain('abertura de conta bancária');
      expect((await get(employeeUser, '/v1/documents')).json().map((d: { id: string }) => d.id)).toEqual([docId]);
      expect((await get(employeeUser, `/v1/documents/${docId}`)).statusCode).toBe(200);
      expect((await get(ownerB, `/v1/documents/${docId}`)).statusCode).toBe(404);
      const v = (await app.inject({ method: 'GET', url: `/v1/public/documents/${code.toLowerCase().replace(/-/g, '')}` })).json();
      expect(v).toMatchObject({ valid: true, title: 'Declaração de serviço', employee: 'Joana Teste' });
      expect(v.body).toBeUndefined();
      expect((await post(employeeUser, `/v1/documents/${docId}/revoke`, { note: 'x' })).statusCode).toBe(403);
      expect((await post(owner, `/v1/documents/${docId}/revoke`, { note: 'Dados desactualizados' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/v1/public/documents/${code}` })).json()).toMatchObject({ valid: false, revoked: true });
    });

    it('a empresa adapta um modelo (nova versão, campos validados) e pode voltar ao do Kianda', async () => {
      const bad = await app.inject({ method: 'PUT', url: '/v1/document-templates/declaracao_servico', headers: as(owner), payload: { title: 'Declaração', body: 'Texto com {{colaborador.salario}} que não existe no Kianda.' } });
      expect(bad.json().error).toBe('campos_desconhecidos');
      const ok = await app.inject({ method: 'PUT', url: '/v1/document-templates/declaracao_servico', headers: as(owner), payload: { title: 'Declaração de vínculo', body: '# Declaração de vínculo\n\n{{colaborador.nome}} trabalha connosco desde {{contrato.admissao}} ({{pedido.finalidade}}).' } });
      expect(ok.json().version).toBe(1);
      const t = (await get(owner, '/v1/document-templates')).json().templates.find((x: { key: string }) => x.key === 'declaracao_servico');
      expect(t).toMatchObject({ source: 'empresa', version: 'Empresa v1', title: 'Declaração de vínculo' });
      const d = (await post(owner, '/v1/documents', { employeeId: empId, templateKey: 'declaracao_servico', inputs: { 'pedido.finalidade': 'visto' } })).json();
      expect(d).toMatchObject({ templateVersion: 'Empresa v1', title: 'Declaração de vínculo' });
      await post(owner, '/v1/document-templates/declaracao_servico/reset');
      expect((await get(owner, '/v1/document-templates')).json().templates.find((x: { key: string }) => x.key === 'declaracao_servico').source).toBe('kianda');
      expect((await get(owner, `/v1/documents/${d.id}`)).json().body).toContain('trabalha connosco');
    });
  });

  describe('recrutamento e desempenho (entrega 12)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url, headers: as(cookie), payload });
    let manager = '';
    let chiefId = '';
    let openingId = '';
    let candId = '';
    let companyId = '';

    beforeAll(async () => {
      manager = await login(`chefe+${stamp}@a.ao`);
      chiefId = (await get(owner, `/v1/employees/${empId}`)).json().managerId;
      companyId = (await get(owner, '/v1/auth/me')).json().company.id;
    });

    it('vaga publicada recebe candidaturas pela página de carreiras; repetida e robô recusados', async () => {
      expect((await post(employeeUser, '/v1/openings', { title: 'Motorista' })).statusCode).toBe(403);
      const o = await post(owner, '/v1/openings', { title: 'Contabilista sénior', hiringManagerId: chiefId, positions: 1, salaryMin: 450000, salaryMax: 600000, status: 'open', isPublic: true, description: 'Fecho mensal e fiscalidade' });
      expect(o.statusCode).toBe(201);
      openingId = o.json().id;
      const pub = (await app.inject({ method: 'GET', url: `/v1/public/careers/${companyId}` })).json();
      expect(pub.openings.map((x: { id: string }) => x.id)).toContain(openingId);
      expect(pub.openings[0].salaryMinMinor).toBeUndefined();
      const apply = (p: object) => app.inject({ method: 'POST', url: `/v1/public/careers/${companyId}/openings/${openingId}/apply`, payload: p });
      expect((await apply({ name: 'Ana Candidata', email: 'ana@x.ao', phone: '923000000' })).statusCode).toBe(400);
      expect((await apply({ name: 'Robô', email: 'r@x.ao', phone: '923000001', consent: true, website: 'spam.com' })).statusCode).toBe(400);
      expect((await apply({ name: 'Ana Candidata', email: 'Ana@x.ao', phone: '923000000', consent: true, cvUrl: 'https://drive.example.com/cv.pdf' })).statusCode).toBe(201);
      expect((await apply({ name: 'Ana Candidata', email: 'ana@x.ao', phone: '923000000', consent: true })).json().error).toBe('candidatura_repetida');
    });

    it('pipeline: chefia responsável vê e comenta; recusa exige motivo; só se admite a partir da proposta', async () => {
      const list = (await get(manager, '/v1/openings')).json();
      expect(list.map((x: { id: string }) => x.id)).toEqual([openingId]);
      const d = (await get(manager, `/v1/openings/${openingId}`)).json();
      candId = d.candidates[0].id;
      expect(d.stats).toMatchObject({ total: 1, active: 1, bySource: { site: 1 } });
      expect((await get(employeeUser, `/v1/candidates/${candId}`)).statusCode).toBe(404);
      expect((await post(manager, `/v1/candidates/${candId}/events`, { kind: 'interview', text: 'Entrevista técnica' })).json().error).toBe('data_obrigatoria');
      expect((await post(manager, `/v1/candidates/${candId}/events`, { kind: 'interview', text: 'Entrevista técnica', scheduledAt: '2026-11-03T10:00:00+01:00' })).statusCode).toBe(201);
      expect((await post(manager, `/v1/candidates/${candId}/stage`, { stage: 'rejected' })).json().error).toBe('motivo_obrigatorio');
      for (const stage of ['screening', 'interview', 'offer']) expect((await post(manager, `/v1/candidates/${candId}/stage`, { stage })).statusCode).toBe(200);
      expect((await post(owner, `/v1/candidates/${candId}/stage`, { stage: 'hired' })).json().error).toBe('usar_admissao');
      const hire = await post(owner, '/v1/employees', { number: '88', name: 'Ana Candidata', jobTitle: 'Contabilista sénior', candidateId: candId, contract: { type: 'indefinite', startDate: '2026-11-16', base: 500000, meal: 30000, transport: 25000 } });
      expect(hire.statusCode).toBe(201);
      const c = (await get(owner, `/v1/candidates/${candId}`)).json();
      expect(c).toMatchObject({ stage: 'hired', employeeId: hire.json().id });
      expect(c.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['stage', 'interview']));
      expect((await get(owner, `/v1/openings/${openingId}`)).json().stats.byStage.hired).toBe(1);
    });

    it('ciclo de avaliação: pesos validados, lançamento com a chefia como avaliadora', async () => {
      expect((await post(owner, '/v1/review-cycles', { name: 'Anual 2026', periodFrom: '2026-01-01', periodTo: '2026-12-31', competencies: [{ key: 'a', label: 'Qualidade', weight: 50 }] })).json().error).toBe('ciclo_invalido');
      const cy = await post(owner, '/v1/review-cycles', { name: 'Avaliação anual 2026', periodFrom: '2026-01-01', periodTo: '2026-12-31', deadline: '2026-12-15', competencyWeight: 60 });
      expect(cy.statusCode).toBe(201);
      const launch = await post(owner, `/v1/review-cycles/${cy.json().id}/launch`);
      expect(launch.json().reviews).toBeGreaterThan(1);
      const team = (await get(manager, '/v1/reviews')).json().team;
      expect(team.map((r: { employeeName: string }) => r.employeeName)).toContain('Joana Teste');
    });

    it('auto-avaliação → chefia (objectivos e notas) → o colaborador toma conhecimento; notas da chefia só depois de submetidas', async () => {
      const mine = (await get(employeeUser, '/v1/reviews')).json().mine[0];
      const comps = (await get(employeeUser, `/v1/reviews/${mine.id}`)).json().cycle.competencies as { key: string }[];
      const all = (v: number) => Object.fromEntries(comps.map((k) => [k.key, v]));
      expect((await put(employeeUser, `/v1/reviews/${mine.id}/self`, { scores: { [comps[0]!.key]: 4 }, submit: true })).json().error).toBe('incompleta');
      expect((await put(manager, `/v1/reviews/${mine.id}/objectives`, { objectives: [{ title: 'Fecho mensal até dia 5', weight: 60 }, { title: 'Reconciliações', weight: 30 }] })).json().error).toBe('pesos_invalidos');
      expect((await put(manager, `/v1/reviews/${mine.id}/objectives`, { objectives: [{ title: 'Fecho mensal até dia 5', weight: 70 }, { title: 'Reconciliações bancárias semanais', weight: 30 }] })).statusCode).toBe(200);
      expect((await put(employeeUser, `/v1/reviews/${mine.id}/self`, { scores: all(4), comment: 'Ano positivo', submit: true })).json().status).toBe('manager');
      expect((await put(employeeUser, `/v1/reviews/${mine.id}/manager`, { scores: all(5), submit: false })).statusCode).toBe(409);
      const m = await put(manager, `/v1/reviews/${mine.id}/manager`, { scores: all(3), objectives: [{ score: 5, result: 'Cumprido em 11 de 12 meses' }, { score: 4 }], comment: 'Bom ano; reforçar delegação', recommendation: 'training', submit: true });
      expect(m.json()).toMatchObject({ status: 'acknowledgement', finalScore: '3.68' });
      const seen = (await get(employeeUser, `/v1/reviews/${mine.id}`)).json();
      expect(seen).toMatchObject({ finalScore: 3.68, rating: 'Supera', role: 'self', can: { acknowledge: true } });
      expect((await post(employeeUser, `/v1/reviews/${mine.id}/acknowledge`, { comment: 'Concordo' })).json().status).toBe('done');
      const cycles = (await get(owner, '/v1/review-cycles')).json();
      const det = (await get(owner, `/v1/review-cycles/${cycles[0].id}`)).json();
      expect(det.distribution.Supera).toBe(1);
    });
  });

  describe('portal do colaborador (entrega 13)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });

    it('resumo do portal: último recibo, despesas, documentos e declarações disponíveis', async () => {
      const p = (await get(employeeUser, '/v1/portal')).json();
      expect(p.lastPayslip).toMatchObject({ period: expect.stringMatching(/^2026-/) });
      expect(p.selfService.templates.map((t: { key: string }) => t.key)).toEqual(['declaracao_servico', 'declaracao_rendimentos']);
      expect(p.selfService.autoIssue).toBe(false);
    });

    it('pedido de declaração: o RH emite ou recusa; com emissão automática sai logo', async () => {
      expect((await post(employeeUser, '/v1/document-requests', { templateKey: 'contrato_indeterminado', inputs: {} })).statusCode).toBe(400);
      expect((await post(employeeUser, '/v1/document-requests', { templateKey: 'declaracao_servico', inputs: {} })).json().error).toBe('campos_em_falta');
      const r = await post(employeeUser, '/v1/document-requests', { templateKey: 'declaracao_servico', inputs: { 'pedido.finalidade': 'visto de turismo' } });
      expect(r.json().status).toBe('pending');
      const inbox = (await get(owner, '/v1/portal/inbox')).json();
      expect(inbox.documents.map((d: { id: string }) => d.id)).toContain(r.json().id);
      expect((await post(employeeUser, `/v1/document-requests/${r.json().id}/issue`)).statusCode).toBe(403);
      const issued = await post(owner, `/v1/document-requests/${r.json().id}/issue`);
      expect(issued.json()).toMatchObject({ status: 'issued', documentNumber: expect.stringMatching(/^DOC-/) });
      expect((await get(employeeUser, `/v1/documents/${issued.json().documentId}`)).json().body).toContain('visto de turismo');
      await app.inject({ method: 'PATCH', url: '/v1/company/settings', headers: as(owner), payload: { autoIssueDeclarations: true } });
      const auto = await post(employeeUser, '/v1/document-requests', { templateKey: 'declaracao_rendimentos', inputs: { 'pedido.finalidade': 'crédito automóvel' } });
      expect(auto.json()).toMatchObject({ status: 'issued', decisionNote: 'Emitida automaticamente' });
      await app.inject({ method: 'PATCH', url: '/v1/company/settings', headers: as(owner), payload: { autoIssueDeclarations: false } });
    });

    it('alteração de dados pessoais: IBAN validado, sem alterações recusado, RH aprova e a ficha muda', async () => {
      expect((await post(employeeUser, '/v1/profile-requests', { changes: { iban: 'AO06 1234' } })).json().error).toBe('iban_invalido');
      const ficha = (await get(employeeUser, `/v1/employees/${empId}`)).json();
      expect((await post(employeeUser, '/v1/profile-requests', { changes: { iban: ficha.iban } })).json().error).toBe('sem_alteracoes');
      const r = await post(employeeUser, '/v1/profile-requests', { changes: { address: 'Rua Direita do Kinaxixi, 12, Luanda', phone: '923456789', iban: 'AO06.0040.0000.5521.8890.1025.2' }, note: 'Mudei de casa e de conta' });
      expect(r.statusCode).toBe(201);
      expect(r.json().changes.iban).toBe('AO06004000005521889010252');
      expect(r.json().previous.address ?? null).toBe(ficha.address ?? null);
      expect((await post(employeeUser, `/v1/profile-requests/${r.json().id}/approve`)).statusCode).toBe(403);
      expect((await post(owner, `/v1/profile-requests/${r.json().id}/approve`)).json().status).toBe('approved');
      const after = (await get(employeeUser, `/v1/employees/${empId}`)).json();
      expect(after).toMatchObject({ address: 'Rua Direita do Kinaxixi, 12, Luanda', phone: '923456789', iban: 'AO06004000005521889010252' });
      const r2 = await post(employeeUser, '/v1/profile-requests', { changes: { phone: '912000000' } });
      expect((await post(owner, `/v1/profile-requests/${r2.json().id}/reject`, { note: 'Número inválido' })).json().status).toBe('rejected');
      expect((await get(employeeUser, '/v1/profile-requests')).json().requests.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('licenças e plataforma (entrega 14)', () => {
    const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: as(cookie) });
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(cookie), payload });
    const patch = (cookie: string, url: string, payload: object) => app.inject({ method: 'PATCH', url, headers: as(cookie), payload });
    let companyId = '';
    beforeAll(async () => { await getDb().delete(platformSettings); });

    it('empresa nova em período experimental, com código e escalão pela dimensão declarada', async () => {
      const me = (await get(owner, '/v1/auth/me')).json();
      companyId = me.company.id;
      expect(me.licence).toMatchObject({ status: 'trial', canWrite: true });
      expect(me.company.code).toMatch(/^[A-Z2-9]{6}$/);
      expect(me.platformAdmin).toBe(false);
      const nif = String(Date.now()).slice(-10);
      const big = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Grande Lda', nif, sector: 'mining', employeesEstimate: 300 }, name: 'Dono G', email: `g+${stamp}@g.ao`, password: pw, acceptTerms: true } });
      expect(big.statusCode).toBe(201);
      const b = (await get(cookieOf(big), '/v1/billing')).json();
      expect(b).toMatchObject({ status: 'trial', tier: { key: 't3' }, limit: 500 });
    });

    it('pedido de pagamento anual com 20% de desconto; o cliente indica a referência', async () => {
      expect((await get(employeeUser, '/v1/billing')).statusCode).toBe(403);
      const b = (await get(financeUser, '/v1/billing')).json();
      expect(b.prices.find((t: { key: string }) => t.key === 't1').prices.annual.totalMinor).toBe(95_999_000);
      const r = await post(financeUser, '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'annual' });
      expect(r.json()).toMatchObject({ amountMinor: 95_999_000, discountMinor: 23_999_800, status: 'pending', number: expect.stringMatching(/^PF-/) });
      const me = (await get(owner, '/v1/auth/me')).json();
      expect(r.json().periodStart > me.licence.trialEndsAt).toBe(true); // começa depois do experimental
      expect((await post(financeUser, '/v1/billing/requests', { kind: 'extra_seats', seats: 10 })).json().error).toBe('preco_por_definir');
      expect((await post(financeUser, `/v1/billing/requests/${r.json().id}/reference`, { payerReference: 'TRF BAI 778899' })).json().payerReference).toBe('TRF BAI 778899');
    });

    it('consola: só administradores; confirmar o pagamento activa a licença; extras com preço definido', async () => {
      expect((await get(owner, '/v1/platform/companies')).statusCode).toBe(403);
      await getDb().insert(platformAdmins).values({ email: `dona+${stamp}@a.ao` }).onConflictDoNothing();
      expect((await get(owner, '/v1/auth/me')).json().platformAdmin).toBe(true);
      const list = (await get(owner, '/v1/platform/companies')).json();
      expect(list.companies.find((x: { id: string }) => x.id === companyId)).toMatchObject({ status: 'trial', pendingPayments: 1 });
      const pending = (await get(owner, '/v1/platform/payment-requests')).json().find((x: { companyId: string }) => x.companyId === companyId);
      const ok = await post(owner, `/v1/platform/payment-requests/${pending.id}/confirm`, { invoiceRef: 'FT KRH2026/0001' });
      expect(ok.json().status).toBe('paid');
      const b = (await get(financeUser, '/v1/billing')).json();
      expect(b).toMatchObject({ status: 'active', cycle: 'annual', paidUntil: pending.periodEnd });
      await app.inject({ method: 'PUT', url: '/v1/platform/settings', headers: as(owner), payload: { extraSeatMinor: 500_000, bank: { holder: 'Kianda RH, Lda.', bankName: 'BAI', iban: 'AO06004000005521889010252' }, supportContact: 'suporte@kianda.ao' } });
      const extra = await post(financeUser, '/v1/billing/requests', { kind: 'extra_seats', seats: 10 });
      expect(extra.json()).toMatchObject({ amountMinor: 5_000_000 });
      await post(owner, `/v1/platform/payment-requests/${extra.json().id}/confirm`, {});
      expect((await get(financeUser, '/v1/billing')).json()).toMatchObject({ extraSeats: 10, limit: 110 });
    });

    it('licença suspensa: só consulta (escrever dá 402), mas pode tratar da licença; limite de colaboradores', async () => {
      await patch(owner, `/v1/platform/companies/${companyId}/subscription`, { status: 'suspended' });
      expect((await get(owner, '/v1/employees')).statusCode).toBe(200);
      const w = await post(owner, '/v1/departments', { name: 'Bloqueado', costCenter: 'CC-X' });
      expect(w.statusCode).toBe(402);
      expect(w.json().error).toBe('licenca_inactiva');
      expect((await post(financeUser, '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'monthly' })).statusCode).toBe(201);
      await patch(owner, `/v1/platform/companies/${companyId}/subscription`, { status: 'active' });
      const n = (await get(owner, '/v1/employees')).json().filter((e: { status: string }) => e.status === 'active').length;
      await patch(owner, `/v1/platform/companies/${companyId}/subscription`, { tierKey: 'custom', customMaxEmployees: n, extraSeats: 0 });
      const over = await post(owner, '/v1/employees', { number: '999', name: 'Excedente', jobTitle: 'Teste', contract: { type: 'indefinite', startDate: '2026-11-02', base: 150000 } });
      expect(over.json().error).toBe('limite_colaboradores');
      await patch(owner, `/v1/platform/companies/${companyId}/subscription`, { tierKey: 't1', extraSeats: 10 });
    });

    it('logotipo para o papel timbrado: só PNG/JPEG', async () => {
      expect((await app.inject({ method: 'PUT', url: '/v1/company/logo', headers: as(owner), payload: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } })).statusCode).toBe(400);
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      expect((await app.inject({ method: 'PUT', url: '/v1/company/logo', headers: as(owner), payload: { dataUrl: png } })).statusCode).toBe(200);
      expect((await get(employeeUser, '/v1/company/branding')).json().logo).toBe(png);
    });
  });

  it('logout limpa o cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: as(owner) });
    expect(r.cookies.find((c) => c.name === 'kianda_session')?.value).toBe('');
  });
});
