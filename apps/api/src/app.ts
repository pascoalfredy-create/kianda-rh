import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { PackNotFoundError } from '@kianda/core';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { SESSION_COOKIE } from './plugins/tenant.js';
import { absenceRoutes } from './routes/absences.js';
import { authRoutes } from './routes/auth.js';
import { employeeRoutes } from './routes/employees.js';
import { payrollRoutes } from './routes/payroll.js';
import { publicRoutes } from './routes/public.js';
import { DomainError } from './services/payroll.js';

function jwtSecret(): string {
  const s = process.env.API_JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('API_JWT_SECRET em falta ou com menos de 32 caracteres');
  return 'segredo-de-desenvolvimento-nao-usar-em-producao-0123456789';
}

export async function buildApp(opts: { logger?: boolean; rateLimit?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  await app.register(cookie);
  await app.register(jwt, { secret: jwtSecret(), cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(rateLimit, { global: false, max: opts.rateLimit === false ? 10_000 : undefined });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'dados_invalidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof PackNotFoundError) return reply.code(422).send({ error: 'pacote_inexistente', message: err.message });
    const e = err as { code?: string; statusCode?: number; message?: string; cause?: { code?: string } };
    if (e.code === '23505' || e.cause?.code === '23505') return reply.code(409).send({ error: 'duplicado', message: 'Registo duplicado' });
    if (e.statusCode === 429) return reply.code(429).send({ error: 'demasiados_pedidos', message: 'Demasiadas tentativas. Aguarde e tente novamente.' });
    app.log.error(err);
    return reply.code(500).send({ error: 'erro_interno' });
  });

  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(employeeRoutes);
  await app.register(absenceRoutes);
  await app.register(payrollRoutes);
  return app;
}
