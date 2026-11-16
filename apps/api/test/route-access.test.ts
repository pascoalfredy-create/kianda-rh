import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

/**
 * Blindagem de acesso: todas as rotas da API exigem sessão, excepto as públicas desta lista.
 * Uma rota nova sem protecção (ou um intermediário que deixe de correr) faz este teste falhar.
 */
const PUBLIC = new Set([
  'GET /health', 'GET /v1/public/support', 'POST /v1/public/visit', 'GET /v1/public/push-key',
  'GET /v1/packs', 'GET /v1/packs/AO/:year', 'GET /v1/holidays/:year', 'POST /v1/payroll/simulate',
  'POST /v1/auth/register', 'POST /v1/auth/login', 'POST /v1/auth/login/2fa', 'POST /v1/auth/logout', 'POST /v1/auth/login-pin', 'POST /v1/auth/forgot',
  'GET /v1/public/kiosk/:token', 'GET /v1/public/documents/:code',
  'GET /v1/public/careers/:companyId', 'GET /v1/public/careers/:companyId/openings/:openingId', 'POST /v1/public/careers/:companyId/openings/:openingId/apply',
  'POST /v1/public/gateway/proxypay', 'POST /v1/public/email-verification',
  'GET /v1/public/access/:token', 'POST /v1/public/access/:token',
]);

describe('acesso às rotas', () => {
  it('sem sessão, só as rotas públicas respondem; as outras devolvem 401 ou 403', async () => {
    const app = buildApp();
    const routes = [...new Map(app.routes.filter(r => r.method !== 'ALL').map(r => [`${r.method} ${r.path}`, r])).values()];
    expect(routes.length).toBeGreaterThan(300);
    const open: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const path = r.path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, 'x').replace(/\*/g, 'x');
      const res = await app.request(path, { method: r.method, headers: { 'content-type': 'application/json' }, body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}' });
      if (res.status !== 401 && res.status !== 403) open.push(`${res.status} ${key}`);
    }
    expect(open).toEqual([]);
    // A lista pública não pode ter rotas que já não existem.
    const existing = new Set(routes.map(r => `${r.method} ${r.path}`));
    expect([...PUBLIC].filter(k => !existing.has(k))).toEqual([]);
  }, 120_000);
});
