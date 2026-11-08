import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, closeDb, compensationChanges, contracts, departments, employeeChecklists, employees, eq, getDb, measureQueries, subscriptions, users } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient, type InjectResponse } from './inject.js';
const app = testClient(buildApp({ rateLimit: false }));
const cookie = (r: InjectResponse) => 'kianda_session=' + r.cookies.find(c => c.name === 'kianda_session')!.value;
const req = (actor: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: actor }, ...(payload === undefined ? {} : { payload }) });
const stamp = String(Date.now()) + Math.floor(Math.random() * 10000), password = 'Migracao2026segura';
const options = { salaryEffectiveDate: '2026-11-01', defaultContractType: 'indefinite', defaultCurrency: 'AOA', createDepartments: true, skipExisting: false };
const source = (start: number, count = 1) => ({ sourceName: 'Pessoal.xlsx', options, rows: Array.from({ length: count }, (_, i) => ({ line: i + 2, values: { number: String(start + i).padStart(6, '0'), name: 'Pessoa Sintética ' + (start + i), jobTitle: 'Técnico', startDate: '2024-03-04', base: 150000, department: 'Operações' } })) });
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('migração em lote de colaboradores', () => {
  let owner = '', other = '', limited = '', finance = '', companyId = '', limitedId = '';
  const preview = (actor: string, data: unknown) => req(actor, 'POST', '/v1/employees/import/preview', data);
  const commit = (actor: string, data: object, fingerprint: string, importId = crypto.randomUUID()) => req(actor, 'POST', '/v1/employees/import/commit', { ...data, fingerprint, importId, confirm: true });
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Migração ' + i, nif: String(Number(stamp.slice(-10)) + i).padStart(10, '0') }, name: 'Responsável', email: stamp + '.' + i + '@migration.test', password, modules: ['hr'] } });
      expect(r.statusCode, r.body).toBe(201);
      if (i === 0) { owner = cookie(r); companyId = r.json().company.id; } else if (i === 1) other = cookie(r); else { limited = cookie(r); limitedId = r.json().company.id; }
    }
    await getDb().update(subscriptions).set({ tierKey: 't5' }).where(eq(subscriptions.companyId, companyId));
    await getDb().update(subscriptions).set({ tierKey: 'custom', customMaxEmployees: 1 }).where(eq(subscriptions.companyId, limitedId));
    const email = stamp + '.finance@migration.test';
    expect((await req(owner, 'POST', '/v1/users', { name: 'Finanças', email, password, role: 'finance' })).statusCode).toBe(201);
    finance = cookie(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } }));
  });
  it('pré-visualiza sem gravar e importa 1.001 pessoas em poucas operações, com repetição segura', async () => {
    const data = source(1, 1001), checked = await preview(owner, data);
    expect(checked.statusCode, checked.body).toBe(200); expect(checked.json()).toMatchObject({ canImport: true, counts: { total: 1001, ready: 1001, errors: 0 } });
    expect((await req(owner, 'GET', '/v1/employees')).json()).toHaveLength(0);
    const importId = crypto.randomUUID();
    const measured = await measureQueries(() => Promise.all([commit(owner, data, checked.json().fingerprint, importId), commit(owner, data, checked.json().fingerprint, importId)]));
    expect(measured.value.map(r => r.statusCode).sort()).toEqual([200, 201]);
    expect(measured.queries).toBeLessThan(100);
    const list = (await req(owner, 'GET', '/v1/employees')).json();
    expect(list).toHaveLength(1001); expect(list[0].number).toBe('000001');
    const person = (await req(owner, 'GET', '/v1/employees/' + list[0].id)).json();
    expect(person.contract.startDate).toBe('2024-03-04'); expect(person.compensation.current.effectiveDate).toBe('2026-11-01');
    expect(person.compensation.current.baseMinor).toBe(15000000);
    expect(await getDb().select().from(employeeChecklists).where(eq(employeeChecklists.companyId, companyId))).toHaveLength(0);
    expect(await getDb().select().from(users).where(eq(users.companyId, companyId))).toHaveLength(2);
    expect(person.contract.salaryKnownFrom).toBe('2026-11-01');
    const correction = await req(owner, 'PATCH', '/v1/employees/' + list[0].id + '/compensation/' + person.compensation.current.id, { base: 155000, meal: 0, transport: 0, currency: 'AOA', reason: 'Correcção de importação', expected: person.compensation.current });
    expect(correction.statusCode, correction.body).toBe(200);
    const beforeMigration = await req(owner, 'GET', '/v1/payroll-runs/opening?period=2026-10&batch=1');
    expect(beforeMigration.json().payrollPeople).toHaveLength(0);
    expect((await req(owner, 'POST', '/v1/payroll-runs/batch', { period: '2026-10', employeeIds: [list[0].id] })).statusCode).toBe(400);
    const payroll = await req(owner, 'POST', '/v1/payroll-runs/batch', { period: '2026-11', employeeIds: [list[0].id, list[1].id] });
    expect(payroll.statusCode, payroll.body).toBe(201); expect(payroll.json().lines).toBe(2);
  }, 60000);
  it('recusa duplicados e permite ignorar existentes sem lhes alterar a remuneração', async () => {
    const duplicate = await preview(owner, source(1)); expect(duplicate.json()).toMatchObject({ canImport: false, counts: { errors: 1 } });
    const data = source(1001, 2); data.options = { ...options, skipExisting: true }; data.rows[0]!.values.base = 1;
    const checked = await preview(owner, data); expect(checked.json()).toMatchObject({ canImport: true, counts: { skipped: 1, ready: 1 } });
    const done = await commit(owner, data, checked.json().fingerprint); expect(done.statusCode, done.body).toBe(201); expect(done.json()).toMatchObject({ created: 1, skipped: 1 });
    const [last] = await getDb().select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.number, '001001')));
    const [salary] = await getDb().select().from(compensationChanges).where(eq(compensationChanges.employeeId, last!.id)); expect(salary!.baseMinor).toBe(15000000);
  });
  it('reconhece o centro de custo informado noutra linha do mesmo departamento', async () => {
    const data = source(2200, 2);
    for (const row of data.rows) row.values.department = 'Contabilidade';
    Object.assign(data.rows[1]!.values, { costCenter: 'CC72' });
    const checked = await preview(owner, data);
    expect(checked.json()).toMatchObject({ canImport: true, newDepartments: [{ name: 'Contabilidade', costCenter: 'CC72' }] });
    expect((await commit(owner, data, checked.json().fingerprint)).statusCode).toBe(201);
  });
  it('um erro impede todo o lote, incluindo novos departamentos, e o hash impede confirmar outro ficheiro', async () => {
    const bad = source(2000, 2); bad.rows[1]!.values.base = -1; bad.rows[0]!.values.department = 'Não criar';
    const checked = await preview(owner, bad); expect(checked.json().canImport).toBe(false);
    expect((await commit(owner, bad, checked.json().fingerprint)).statusCode).toBe(409);
    expect(await getDb().select().from(departments).where(and(eq(departments.companyId, companyId), eq(departments.name, 'Não criar')))).toHaveLength(0);
    expect(await getDb().select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.number, '002000')))).toHaveLength(0);
    const valid = source(2100), p = await preview(owner, valid); valid.rows[0]!.values.base = 160000;
    expect((await commit(owner, valid, p.json().fingerprint)).json().error).toBe('importacao_alterada');
  });
  it('limita por empresa, perfil e faixa de licença e deixa descarregar o modelo no teste', async () => {
    const foreign = await preview(other, source(1)); expect(foreign.json()).toMatchObject({ canImport: true, counts: { ready: 1 } }); expect(foreign.body).not.toContain('Pessoa Sintética 1001');
    expect((await preview(finance, source(3000))).statusCode).toBe(403);
    const tooMany = await preview(other, source(1, 101)); expect(tooMany.json().canImport).toBe(true); expect(tooMany.json().licence.notice).toContain('101 a 250 colaboradores');
    const template = await req(other, 'GET', '/v1/employees/import/template'); expect(template.statusCode, template.body).toBe(200); expect(template.headers['content-type']).toContain('spreadsheetml');
    expect((await preview(other, { ...source(1), companyId })).statusCode).toBe(400);
    expect((await preview(other, source(1, 5001))).statusCode).toBe(400);
  });
  it('a admissão individual e o lote concorrentes não ultrapassam a última vaga da licença', async () => {
    const data = source(1), p = await preview(limited, data);
    expect(p.json().canImport).toBe(true);
    const replies = await Promise.all([commit(limited, data, p.json().fingerprint), req(limited, 'POST', '/v1/employees', { number: 'outro', name: 'Outro Sintético', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 150000 } })]);
    expect(replies.filter(r => r.statusCode === 201)).toHaveLength(1);
    expect(replies.some(r => r.statusCode === 402 || r.statusCode === 409)).toBe(true);
    expect((await req(limited, 'GET', '/v1/employees')).json()).toHaveLength(1);
  });
});
