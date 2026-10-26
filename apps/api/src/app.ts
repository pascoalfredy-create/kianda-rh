import { PackNotFoundError } from '@kianda/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { setRateLimitEnabled, type AppEnv } from './plugins/tenant.js';
import { absenceRoutes } from './routes/absences.js';
import { attendanceRoutes } from './routes/attendance.js';
import { authRoutes } from './routes/auth.js';
import { employeeRoutes } from './routes/employees.js';
import { payrollRoutes } from './routes/payroll.js';
import { publicRoutes } from './routes/public.js';
import { DomainError } from './services/payroll.js';

/**
 * API Hono — corre igual em Node (servidor local, testes) e em Cloudflare Workers (produção).
 * Sem geração de código em tempo de execução (proibida nos Workers).
 */
export function buildApp(opts: { logger?: boolean; rateLimit?: boolean } = {}) {
  setRateLimitEnabled(opts.rateLimit !== false);
  const app = new Hono<AppEnv>();

  app.use('*', cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true }));
  if (opts.logger) {
    app.use('*', async (c, next) => {
      const t = Date.now();
      await next();
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - t}ms`);
    });
  }

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: 'dados_invalidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
    if (err instanceof DomainError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof PackNotFoundError) return c.json({ error: 'pacote_inexistente', message: err.message }, 422);
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === '23505' || e.cause?.code === '23505') return c.json({ error: 'duplicado', message: 'Registo duplicado' }, 409);
    console.error(err);
    return c.json({ error: 'erro_interno', message: 'Erro interno. Tente novamente.' }, 500);
  });
  app.notFound((c) => c.json({ error: 'nao_encontrado', message: 'Rota inexistente' }, 404));

  app.route('/', publicRoutes());
  app.route('/', authRoutes());
  app.route('/', employeeRoutes());
  app.route('/', absenceRoutes());
  app.route('/', attendanceRoutes());
  app.route('/', payrollRoutes());
  return app;
}

export type App = ReturnType<typeof buildApp>;
