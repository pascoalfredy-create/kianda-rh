import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financialTemplate } from '@kianda/core';
import { closeDb, getDb, platformAdmins, sql } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { isDocumentExport } from '../src/services/document-access.js';
import { testClient } from './inject.js';

describe('documentos e consultas são operações distintas', () => {
  it('identifica todos os ficheiros de negócio, inclusive os downloads sem formato explícito', () => {
    for (const [path, format] of [
      ['/v1/modeling/models/uuid/reports/sumario', undefined], ['/v1/modeling/models/uuid/reports/analise/', 'xlsx'],
      ['/v1/ledger/export', undefined], ['/v1/ledger/export/mark', undefined], ['/v1/ledger/trial-balance', 'csv'],
      ['/v1/budgets/uuid/export', undefined], ['/v1/expenses-bank-file', undefined],
      ['/v1/payroll-runs/uuid/bank-file', undefined], ['/v1/payroll-runs/uuid/bank-file', 'xlsx'],
      ['/v1/payroll-runs/uuid/maps/agt', 'xlsx'], ['/v1/payroll-runs/uuid/maps/inss', 'csv'], ['/v1/payroll-runs/uuid/maps/irt', 'csv'],
      ['/v1/reports/people', 'xlsx'],
    ]) expect(isDocumentExport(path!, format), `${path}?format=${format}`).toBe(true);
  });
  it('preserva cálculos, dados dos mapas e catálogos para pré-visualização', () => {
    for (const [path, format] of [
      ['/v1/modeling/models/uuid/reports', undefined], ['/v1/modeling/models/uuid/versions/uuid', undefined],
      ['/v1/modeling/export-options', undefined], ['/v1/modeling/models/uuid/calculation', undefined],
      ['/v1/payroll-runs/uuid/bank-file', 'json'], ['/v1/payroll-runs/uuid/maps/agt', undefined],
      ['/v1/payroll-runs/uuid/maps/inss', 'json'], ['/v1/ledger/trial-balance', undefined], ['/v1/reports/people', 'json'],
    ]) expect(isDocumentExport(path!, format), `${path}?format=${format}`).toBe(false);
  });
});

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
describe.skipIf(!process.env.DATABASE_URL)('avaliação, pagamento e exportação por módulo', () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`, email = `${stamp}@preview.test`;
  let cookie = '', companyId = '', modelId = '', versionId = '', ownerId = '';
  const req = (method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  const output = () => req('GET', `/v1/modeling/models/${modelId}/reports/sumario?version=${versionId}`);
  beforeAll(async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { company: { name: 'Avaliação sintética', nif: stamp.slice(-10), sector: 'services' }, name: 'Gestor sintético', email, password: 'Previsualizacao2026abc', modules: ['hr', 'modeling'], modelingPlan: { key: 'pme', cycle: 'monthly', primarySector: 'servicos', sectors: ['servicos', 'comercio'] } } });
    expect(r.statusCode).toBe(201); companyId = r.json().company.id; ownerId = r.json().user.id;
    cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    await getDb().insert(platformAdmins).values({ email });
  });
  it('o teste permite criar, calcular e aprovar para pré-visualização, mas não disponibiliza ficheiros', async () => {
    const model = await req('POST', '/v1/modeling/models', { name: 'Estudo de avaliação', sector: 'servicos', currency: 'Kz', assumptions: financialTemplate('servicos').assumptions });
    expect(model.statusCode).toBe(201); modelId = model.json().id;
    expect((await req('GET', `/v1/modeling/models/${modelId}/calculation`)).statusCode).toBe(200);
    const version = await req('POST', `/v1/modeling/models/${modelId}/versions`, { revision: 1, label: 'Pré-visualização' });
    expect(version.statusCode).toBe(201); versionId = version.json().id;
    expect((await req('GET', `/v1/modeling/models/${modelId}/versions/${versionId}`)).json().payload.reports.sumario).toBeTruthy();
    for (const path of ['/v1/modeling/session', '/v1/modeling/bootstrap', '/v1/modeling/export-options', `/v1/modeling/models/${modelId}/reports`]) {
      const data = (await req('GET', path)).json();
      expect(data.formats ?? data).toEqual({ pdf: false, xlsx: false, csv: false });
    }
    const previous = process.env.KIANDA_MODELING_OWNER_USER_ID;
    try {
      process.env.KIANDA_MODELING_OWNER_USER_ID = ownerId;
      for (const format of ['pdf', 'xlsx']) {
        const file = await req('GET', `/v1/modeling/models/${modelId}/reports/sumario?format=${format}&version=${versionId}`);
        expect(file.statusCode).toBe(402); expect(file.json().error).toBe('exportacao_requer_subscricao');
        expect(file.headers['content-type']).toContain('application/json'); expect(file.headers['content-disposition']).toBeUndefined();
      }
    } finally { if (previous === undefined) delete process.env.KIANDA_MODELING_OWNER_USER_ID; else process.env.KIANDA_MODELING_OWNER_USER_ID = previous; }
    expect((await req('GET', '/v1/ledger/trial-balance?from=2026-10-01&to=2026-10-31')).statusCode).toBe(200);
    expect((await req('GET', '/v1/ledger/trial-balance?from=2026-10-01&to=2026-10-31&format=csv')).statusCode).toBe(402);
    expect((await req('POST', '/v1/ledger/export/mark', { from: '2026-10-01', to: '2026-10-31' })).statusCode).toBe(402);
    const n = (await getDb().execute(sql`select count(*)::int as n from audit_logs where company_id=${companyId} and action='export_report'`)).rows[0];
    expect(n?.n).toBe(0);
  });
  it('pagar RH liberta apenas os documentos RH e preserva os dias gratuitos restantes', async () => {
    const before = (await req('GET', '/v1/modules')).json();
    const pay = await req('POST', '/v1/billing/requests', { kind: 'subscription', tierKey: 't1', cycle: 'annual' });
    expect(pay.statusCode).toBe(201); expect(pay.json()).toMatchObject({ amountMinor: 30_498_000, discountMinor: 5_382_000 });
    expect(pay.json().periodStart > before.hr.trialEndsAt).toBe(true);
    expect((await req('POST', `/v1/platform/payment-requests/${pay.json().id}/confirm`, {})).statusCode).toBe(200);
    expect((await req('GET', '/v1/ledger/trial-balance?from=2026-10-01&to=2026-10-31&format=csv')).headers['content-type']).toContain('text/csv');
    expect((await output()).statusCode).toBe(402);
    expect((await req('GET', '/v1/modules')).json().modeling).toEqual(before.modeling);
  });
  it('pagar Integra liberta o PDF já pré-visualizado, conservando a restrição de Excel', async () => {
    const pay = await req('POST', '/v1/billing/requests', { kind: 'modeling_subscription', planKey: 'pme', cycle: 'semiannual', sectors: ['servicos', 'comercio'] });
    expect(pay.statusCode).toBe(201); expect(pay.json()).toMatchObject({ amountMinor: 37_260_000, discountMinor: 4_140_000 });
    expect((await req('POST', `/v1/platform/payment-requests/${pay.json().id}/confirm`, {})).statusCode).toBe(200);
    const file = await output(); expect(file.statusCode).toBe(200); expect(file.headers['content-type']).toBe('application/pdf'); expect(new TextDecoder().decode(file.bytes.slice(0,8))).toBe('%PDF-1.7');
    expect((await req('GET', '/v1/modeling/export-options')).json()).toEqual({ pdf: true, xlsx: false, csv: false });
    expect((await req('GET', `/v1/modeling/models/${modelId}/reports/sumario?format=xlsx`)).statusCode).toBe(403);
  });
  it('uma avaliação expirada mantém a pré-visualização mas não permite contornar o bloqueio com a versão aprovada', async () => {
    await getDb().execute(sql`update company_modules set status='trial', trial_ends_at='2000-01-01', paid_until=null where company_id=${companyId} and module='modeling'`);
    const session = (await req('GET', '/v1/modeling/session')).json();
    expect(session).toMatchObject({ canWrite: false, formats: { pdf: false, xlsx: false, csv: false }, licence: { status: 'suspended' } });
    expect((await req('GET', `/v1/modeling/models/${modelId}/versions/${versionId}`)).statusCode).toBe(200);
    expect((await output()).statusCode).toBe(402);
  });
});
