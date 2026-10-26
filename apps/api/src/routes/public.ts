import { AO_2026, calculatePayroll, getPack, kz, listPacks, PackNotFoundError, solveBaseForNet } from '@kianda/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
export async function publicRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', packs: listPacks() }));

  app.get('/v1/packs/AO/:year', async (req, reply) => {
    const { year } = z.object({ year: z.coerce.number().int() }).parse(req.params);
    try {
      const p = getPack('AO', year);
      return { version: p.version, irtBrackets: p.irt.brackets.length, minimumWage: p.minimumWage, labour: p.labour, holidays: p.holidays, toValidate: p.toValidate, sources: p.sources };
    } catch (e) {
      if (e instanceof PackNotFoundError) return reply.code(404).send({ error: 'pacote_inexistente', message: e.message });
      throw e;
    }
  });

  app.post('/v1/payroll/simulate', async (req) => {
    const b = simulateBody.parse(req.body);
    const rest = { period: b.period, mealMinor: kz(b.meal), transportMinor: kz(b.transport), overtimeHours: b.overtimeHours, holidaySubsidy: b.holidaySubsidy, christmasSubsidy: b.christmasSubsidy };
    return b.base !== undefined ? calculatePayroll({ ...rest, baseMinor: kz(b.base) }) : solveBaseForNet(kz(b.targetNet!), rest);
  });

  app.get('/v1/packs', async () => ({ available: listPacks(), current: AO_2026.version }));
}
