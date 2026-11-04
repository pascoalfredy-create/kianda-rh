import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';

/** Acolhimento e saída: listas automáticas na admissão e na cessação, responsáveis, prazos, modelos e isolamento. */
const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'Acolhimento2026seguro';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

describe('sem sessão', () => {
  it('as listas exigem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/checklists' })).statusCode).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('acolhimento e saída', () => {
  let owner = '', other = '', chief = '', worker = '', finance = '', chiefId = '', workerId = '', onboardingId = '', offboardingId = '', terminationId = '';
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const employee = (number: string, name: string, startDate: string) => ({ number, name, gender: 'M', jobTitle: 'Técnico', province: 'Luanda', nif: `00000${number.padStart(5, '0')}`, contract: { type: 'indefinite', startDate, base: 300000, meal: 30000, transport: 25000 } });
  const login = async (email: string) => cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
  const tasksOf = async (session: string, id: string) => (await req(session, 'GET', `/v1/checklists/${id}`)).json().tasks as { id: string; title: string; responsible: string; dueDate: string; canComplete: boolean; doneAt: string | null }[];

  beforeAll(async () => {
    for (const i of [0, 1]) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: `Acolhe ${i}`, sector: 'services', nif: String(Number(stamp.slice(-9)) * 10 + i).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}.${i}@acolhe.test`, password, modules: ['hr'] } });
      expect(r.statusCode).toBe(201);
      if (!i) owner = cookieOf(r); else other = cookieOf(r);
    }
    const c = await req(owner, 'POST', '/v1/employees', employee('11', 'Chefe Mavinga', '2025-01-06')); expect(c.statusCode).toBe(201); chiefId = c.json().id;
    for (const [email, role, employeeId] of [[`${stamp}.chefe@acolhe.test`, 'manager', chiefId], [`${stamp}.fin@acolhe.test`, 'finance', undefined]] as const) {
      expect((await req(owner, 'POST', '/v1/users', { name: role, email, password, role, ...(employeeId ? { employeeId } : {}) })).statusCode).toBe(201);
    }
    chief = await login(`${stamp}.chefe@acolhe.test`); finance = await login(`${stamp}.fin@acolhe.test`);
  });

  it('a admissão cria a lista de acolhimento a partir do modelo-tipo, com prazos contados do início do contrato', async () => {
    const e = await req(owner, 'POST', '/v1/employees', employee('12', 'Rosa Kiala', '2026-11-16'));
    expect(e.statusCode).toBe(201); workerId = e.json().id;
    expect((await req(owner, 'PATCH', `/v1/employees/${workerId}`, { managerId: chiefId })).statusCode).toBe(200);
    expect((await req(owner, 'POST', '/v1/users', { name: 'Rosa', email: `${stamp}.rosa@acolhe.test`, password, role: 'employee', employeeId: workerId })).statusCode).toBe(201);
    worker = await login(`${stamp}.rosa@acolhe.test`);
    const lists = (await req(owner, 'GET', `/v1/checklists?employeeId=${workerId}`)).json();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ kind: 'onboarding', status: 'open', referenceDate: '2026-11-16', title: 'Acolhimento de novos colaboradores', employee: { name: 'Rosa Kiala' } });
    onboardingId = lists[0].id;
    const tasks = await tasksOf(owner, onboardingId);
    expect(tasks.length).toBe(11);
    expect(tasks.find(t => t.title.startsWith('Posto de trabalho'))!.dueDate).toBe('2026-11-15');
    expect(tasks.find(t => t.title.startsWith('Avaliação do período experimental'))!.dueDate).toBe('2027-01-10');
    // A chefia admitida em 2025 também teve a sua lista; o RH não duplica uma lista em curso.
    expect((await req(owner, 'POST', '/v1/checklists', { employeeId: workerId, kind: 'onboarding', referenceDate: '2026-11-16' })).json().error).toBe('lista_existente');
  });

  it('cada perfil vê e marca só o que lhe cabe', async () => {
    const asWorker = await tasksOf(worker, onboardingId);
    expect(asWorker.every(t => t.responsible === 'employee')).toBe(true);
    expect(asWorker).toHaveLength(2);
    const asChief = await tasksOf(chief, onboardingId);
    expect(asChief).toHaveLength(11);
    const hrTask = asChief.find(t => t.responsible === 'hr')!, chiefTask = asChief.find(t => t.responsible === 'manager')!, finTask = asChief.find(t => t.responsible === 'finance')!;
    expect(hrTask.canComplete).toBe(false); expect(chiefTask.canComplete).toBe(true);
    expect((await req(chief, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${hrTask.id}`, { done: true })).statusCode).toBe(403);
    expect((await req(worker, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${hrTask.id}`, { done: true })).statusCode).toBe(404);
    const done = await req(chief, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${chiefTask.id}`, { done: true, note: 'Portátil e EPI entregues' });
    expect(done.statusCode).toBe(200); expect(done.json().task).toMatchObject({ doneByName: 'manager', note: 'Portátil e EPI entregues' });
    expect((await req(finance, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${finTask.id}`, { done: true })).statusCode).toBe(200);
    expect((await req(worker, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${asWorker[0]!.id}`, { done: true })).statusCode).toBe(200);
    // As tarefas do colaborador aparecem no seu painel e no contador do menu quando estão a vencer.
    const mine = (await req(worker, 'GET', '/v1/checklists/my-tasks')).json();
    expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ responsible: 'employee', employee: { name: 'Rosa Kiala' } });
    // O contador do menu (SQL) segue as mesmas regras da lista «as minhas tarefas» (TypeScript), para cada perfil.
    for (const session of [owner, chief, finance, worker]) {
      const urgent = ((await req(session, 'GET', '/v1/checklists/my-tasks')).json() as { state: string }[]).filter(t => t.state === 'overdue' || t.state === 'due_soon').length;
      expect((await req(session, 'GET', '/v1/notifications/counts')).json().tasks).toBe(urgent);
      expect((await req(session, 'GET', '/v1/auth/me')).json().notifications.tasks).toBe(urgent);
      if (session === owner || session === chief) expect(urgent).toBeGreaterThan(0);
    }
  });

  it('a lista fecha quando a última tarefa é feita e reabre se uma for desmarcada', async () => {
    for (const t of await tasksOf(owner, onboardingId)) if (!t.doneAt) expect((await req(owner, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${t.id}`, { done: true })).statusCode).toBe(200);
    expect((await req(owner, 'GET', `/v1/checklists/${onboardingId}`)).json()).toMatchObject({ status: 'completed', progress: { percent: 100 } });
    const first = (await tasksOf(owner, onboardingId))[0]!;
    expect((await req(owner, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${first.id}`, { done: false })).json().status).toBe('open');
    expect((await req(owner, 'PATCH', `/v1/checklists/${onboardingId}/tasks/${first.id}`, { done: true })).json().status).toBe('completed');
  });

  it('a cessação cria a lista de saída; mudar a data desloca os prazos; anular a cessação anula a lista', async () => {
    const t = await req(owner, 'POST', '/v1/terminations', { employeeId: workerId, reason: 'mutual_agreement', effectiveDate: '2026-12-31', noticeDate: '2026-12-01', agreedCompensationMinor: 0 });
    expect(t.statusCode).toBe(201); terminationId = t.json().id;
    const out = (await req(owner, 'GET', `/v1/checklists?employeeId=${workerId}&kind=offboarding`)).json();
    expect(out).toHaveLength(1); expect(out[0]).toMatchObject({ referenceDate: '2026-12-31', terminationId }); offboardingId = out[0].id;
    expect((await tasksOf(owner, offboardingId)).find(t => t.title.startsWith('Plano de passagem'))!.dueDate).toBe('2026-12-21');
    const moved = await req(owner, 'PUT', `/v1/terminations/${terminationId}`, { employeeId: workerId, reason: 'mutual_agreement', effectiveDate: '2027-01-15', noticeDate: '2026-12-01', agreedCompensationMinor: 0 });
    expect(moved.statusCode).toBe(200);
    expect((await req(owner, 'GET', `/v1/checklists/${offboardingId}`)).json().referenceDate).toBe('2027-01-15');
    expect((await tasksOf(owner, offboardingId)).find(t => t.title.startsWith('Plano de passagem'))!.dueDate).toBe('2027-01-05');
    expect((await req(owner, 'POST', `/v1/terminations/${terminationId}/cancel`, { note: 'O colaborador ficou' })).statusCode).toBe(200);
    expect((await req(owner, 'GET', `/v1/checklists/${offboardingId}`)).json()).toMatchObject({ status: 'cancelled', cancelReason: 'Cessação anulada' });
  });

  it('o RH ajusta o modelo; desligar «criar automaticamente» deixa de criar listas na admissão', async () => {
    expect((await req(chief, 'GET', '/v1/checklist-templates')).statusCode).toBe(403);
    const templates = (await req(owner, 'GET', '/v1/checklist-templates')).json();
    expect(templates.map((t: { kind: string }) => t.kind)).toEqual(['onboarding', 'offboarding']);
    expect((await req(owner, 'PUT', '/v1/checklist-templates/onboarding', { name: 'Entrada', autoStart: true, items: [{ title: 'X', responsible: 'hr', offsetDays: 999 }] })).statusCode).toBe(400);
    const saved = await req(owner, 'PUT', '/v1/checklist-templates/onboarding', { name: 'Entrada na obra', autoStart: false, items: [{ title: 'Exame médico de admissão', responsible: 'hr', offsetDays: -2 }] });
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ name: 'Entrada na obra', autoStart: false });
    const e = await req(owner, 'POST', '/v1/employees', employee('13', 'Sem lista', '2026-12-01'));
    expect((await req(owner, 'GET', `/v1/checklists?employeeId=${e.json().id}&status=all`)).json()).toEqual([]);
    const manual = await req(owner, 'POST', '/v1/checklists', { employeeId: e.json().id, kind: 'onboarding', referenceDate: '2026-12-01' });
    expect(manual.statusCode).toBe(201);
    expect((await tasksOf(owner, manual.json().id)).map(t => [t.title, t.dueDate])).toEqual([['Exame médico de admissão', '2026-11-29']]);
  });

  it('outra empresa não vê nem altera as listas', async () => {
    expect((await req(other, 'GET', `/v1/checklists/${onboardingId}`)).statusCode).toBe(404);
    expect((await req(other, 'GET', '/v1/checklists?status=all')).json()).toEqual([]);
    expect((await req(other, 'POST', '/v1/checklists', { employeeId: workerId, kind: 'onboarding', referenceDate: '2026-11-16' })).statusCode).toBe(404);
  });
});
