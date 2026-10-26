import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit, setRateLimitEnabled, type AppEnv } from '../src/plugins/tenant.js';

describe('limite de tentativas', () => {
  setRateLimitEnabled(true);
  const app = new Hono<AppEnv>();
  app.post('/login', rateLimit('t', 3, 60_000), (c) => (c.req.header('x-ok') ? c.json({ ok: true }) : c.json({ error: 'x' }, 401)));
  const hit = (ip: string, ok = false) => app.request('/login', { method: 'POST', headers: { 'x-forwarded-for': ip, ...(ok ? { 'x-ok': '1' } : {}), 'cf-connecting-ip': '10.0.0.1' } });

  it('logins bem-sucedidos não gastam tentativas', async () => {
    for (let i = 0; i < 6; i++) expect((await hit('1.1.1.1', true)).status).toBe(200);
  });
  it('3 falhas bloqueiam esse IP, mas não os outros (mesmo com o mesmo cf-connecting-ip do Worker)', async () => {
    for (let i = 0; i < 3; i++) expect((await hit('2.2.2.2')).status).toBe(401);
    expect((await hit('2.2.2.2', true)).status).toBe(429);
    expect((await hit('3.3.3.3', true)).status).toBe(200);
  });
});
