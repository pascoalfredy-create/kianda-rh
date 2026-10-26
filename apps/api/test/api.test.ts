import { closeDb } from '@kianda/db';
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

  it('logout limpa o cookie', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: as(owner) });
    expect(r.cookies.find((c) => c.name === 'kianda_session')?.value).toBe('');
  });
});
