import { AO_2026, calculatePayroll, getPack, kz, labourRules, listPacks, PackNotFoundError, solveBaseForNet } from '@kianda/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, type AppEnv } from '../plugins/tenant.js';

const simulateBody = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** Valores em kwanzas (a API converte para cêntimos). */
  base: z.number().nonnegative().optional(),
  targetNet: z.number().nonnegative().optional(),
  meal: z.number().nonnegative().default(0),
  transport: z.number().nonnegative().default(0),
  overtimeHours: z.number().nonnegative().default(0),
  holidaySubsidy: z.boolean().default(false),
  christmasSubsidy: z.boolean().default(false),
}).refine((b) => b.base !== undefined || b.targetNet !== undefined, { message: 'Indique base ou targetNet' });

/** Rotas sem empresa: saúde, regras publicadas e simulador salarial. */
export function publicRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/health', (c) => c.json({ status: 'ok', packs: listPacks() }));

  app.get('/v1/packs/AO/:year', (c) => {
    const { year } = z.object({ year: z.coerce.number().int() }).parse(c.req.param());
    try {
      const p = getPack('AO', year);
      return c.json({ version: p.version, irtBrackets: p.irt.brackets.length, minimumWage: p.minimumWage, labour: p.labour, holidays: p.holidays, toValidate: p.toValidate, sources: p.sources });
    } catch (e) {
      if (e instanceof PackNotFoundError) return c.json({ error: 'pacote_inexistente', message: e.message }, 404);
      throw e;
    }
  });

  app.post('/v1/payroll/simulate', async (c) => {
    const b = simulateBody.parse(await body(c));
    const rest = { period: b.period, mealMinor: kz(b.meal), transportMinor: kz(b.transport), overtimeHours: b.overtimeHours, holidaySubsidy: b.holidaySubsidy, christmasSubsidy: b.christmasSubsidy };
    return c.json(b.base !== undefined ? calculatePayroll({ ...rest, baseMinor: kz(b.base) }) : solveBaseForNet(kz(b.targetNet!), rest));
  });

  /** Feriados nacionais do ano (gerados; disponíveis mesmo sem pacote fiscal publicado). */
  app.get('/v1/holidays/:year', (c) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2020).max(2100) }).parse(c.req.param());
    return c.json(labourRules('AO', year).holidays);
  });

  app.get('/v1/packs', (c) => c.json({ available: listPacks(), current: AO_2026.version }));
  return app;
}
