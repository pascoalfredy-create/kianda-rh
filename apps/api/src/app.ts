import cors from '@fastify/cors';
import { PackNotFoundError } from '@kianda/core';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { absenceRoutes } from './routes/absences.js';
import { employeeRoutes } from './routes/employees.js';
import { payrollRoutes } from './routes/payroll.js';
import { publicRoutes } from './routes/public.js';
import { DomainError } from './services/payroll.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'dados_invalidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof DomainError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof PackNotFoundError) return reply.code(422).send({ error: 'pacote_inexistente', message: err.message });
    if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'duplicado', message: 'Registo duplicado' });
    app.log.error(err);
    return reply.code(500).send({ error: 'erro_interno' });
  });

  await app.register(publicRoutes);
  await app.register(employeeRoutes);
  await app.register(absenceRoutes);
  await app.register(payrollRoutes);
  return app;
}
