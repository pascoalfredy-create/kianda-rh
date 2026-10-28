import { convertFinancialCurrency, FINANCIAL_CURRENCIES, type FinancialCurrencyConversion } from '@kianda/core';
import { and, auditLogs, eq, financialModels, getDb } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, type AppEnv } from '../plugins/tenant.js';
import { financialFingerprint } from '../services/modeling-calculation.js';
import { modelingExchangeQuote } from '../services/modeling-exchange.js';
import { lockModelingCompany } from '../services/modeling-policy.js';
import { DomainError } from '../services/payroll.js';
const currency = z.enum(FINANCIAL_CURRENCIES);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Data inválida');
export function modelingCurrencyRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/modeling/exchange-rate', async (c) => {
    const input = z.object({ from: currency, to: currency }).parse(c.req.query());
    return c.json(await modelingExchangeQuote(input.from, input.to));
  });
  app.post('/v1/modeling/models/:id/convert-currency', async (c) => {
    const input = z.object({ revision: z.number().int().positive(), from: currency, to: currency, rate: z.number().finite().min(1e-12).max(1e12), rateDate: date, source: z.string().trim().min(1).max(160), reference: z.boolean().default(false) }).parse(await body(c));
    let source = input.source;
    if (input.reference) {
      const quote = await modelingExchangeQuote(input.from, input.to, input.rateDate);
      if (quote.rateDate !== input.rateDate || quote.rate !== input.rate) throw new DomainError('cambio_alterado', 'A taxa não coincide com a referência indicada. Obtenha a referência novamente ou indique uma taxa manual.', 409);
      source = quote.source;
    }
    const db = getDb(), a = c.get('actor');
    await lockModelingCompany(db, a.companyId);
    const [current] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')))).for('update');
    if (!current) throw new DomainError('nao_encontrado', 'Projecto inexistente.', 404);
    if (current.archivedAt) throw new DomainError('projecto_arquivado', 'Restaure o projecto antes de converter a moeda.', 409);
    if (current.revision !== input.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de converter.', 409);
    const converted = convertFinancialCurrency(current.assumptions as Record<string, unknown>, input.from, input.to, input.rate), appliedAt = new Date();
    const conversion: FinancialCurrencyConversion = { from: input.from, to: input.to, storedFrom: currency.parse(current.currency), rate: input.rate, rateDate: input.rateDate, source: input.reference ? source : `Indicada pelo utilizador: ${source}`, appliedAt: appliedAt.toISOString() };
    const [model] = await db.update(financialModels).set({ currency: input.to, assumptions: { ...converted, currencyConversion: conversion }, revision: current.revision + 1, updatedAt: appliedAt }).where(eq(financialModels.id, current.id)).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'convert_currency', entity: 'financial_model', entityId: current.id, before: { revision: current.revision, currency: current.currency, assumptionsHash: financialFingerprint(current.assumptions) }, after: { revision: model!.revision, conversion, assumptionsHash: financialFingerprint(model!.assumptions) } });
    return c.json(model);
  });
  return app;
}
