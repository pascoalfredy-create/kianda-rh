import { analyzeFinancialHistory, financialModelFromHistory, type FinancialSector } from '@kianda/core';
import { and, auditLogs, eq, financialHistoricalInputs, financialModels, getDb } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, type AppEnv, type Ctx } from '../plugins/tenant.js';
import { financialFingerprint, financialModelOf } from '../services/modeling-calculation.js';
import { financialHistoryOf } from '../services/modeling-versions.js';
import { lockModelingCompany, requireProjectCapacity } from '../services/modeling-policy.js';
import { DomainError } from '../services/payroll.js';
const revision = z.number().int().positive();
async function lockedModel(c: Ctx, expected: number) {
  const [model] = await getDb().select().from(financialModels).where(and(eq(financialModels.id, c.req.param('id') ?? ''), eq(financialModels.companyId, c.get('actor').companyId))).for('update');
  if (!model) throw new DomainError('nao_encontrado', 'Projecto inexistente.', 404);
  if (model.archivedAt) throw new DomainError('projecto_arquivado', 'Restaure o projecto antes de importar dados.', 409);
  if (model.revision !== expected) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo.', 409);
  return model;
}
export function modelingHistoryRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/modeling/models/:id/history', async (c) => {
    const model = await financialModelOf(c, true);
    return c.json({ revision: model.revision, historical: await financialHistoryOf(getDb(), model) });
  });
  app.put('/v1/modeling/models/:id/history', async (c) => {
    const input = z.object({ revision, input: z.unknown() }).parse(await body(c));
    // Validação pura antes do bloqueio: um CSV inválido não ocupa a linha do projecto.
    const analysis = analyzeFinancialHistory(input.input), db = getDb(), actor = c.get('actor');
    await lockModelingCompany(db, actor.companyId);
    const model = await lockedModel(c, input.revision), inputHash = financialFingerprint(analysis.input), updatedAt = new Date();
    const [before] = await db.select({ inputHash: financialHistoricalInputs.inputHash }).from(financialHistoricalInputs).where(and(eq(financialHistoricalInputs.companyId, model.companyId), eq(financialHistoricalInputs.modelId, model.id)));
    if (before?.inputHash === inputHash) return c.json({ model, historical: await financialHistoryOf(db, model) });
    const values = { companyId: model.companyId, modelId: model.id, input: analysis.input, inputHash, updatedBy: actor.actorId, updatedAt };
    await db.insert(financialHistoricalInputs).values(values).onConflictDoUpdate({ target: financialHistoricalInputs.modelId, set: values });
    const [updated] = await db.update(financialModels).set({ revision: model.revision + 1, updatedAt }).where(eq(financialModels.id, model.id)).returning();
    await db.insert(auditLogs).values({ companyId: model.companyId, actorId: actor.actorId, action: 'import_trial_balance', entity: 'financial_model', entityId: model.id, before: { historicalHash: before?.inputHash ?? null }, after: { historicalHash: inputHash, revision: updated!.revision, years: analysis.input.anos, currency: analysis.input.moeda } });
    return c.json({ model: updated, historical: { inputHash, updatedAt, analysis } });
  });
  app.post('/v1/modeling/models/:id/history/to-model', async (c) => {
    const input = z.object({ revision }).parse(await body(c)), db = getDb(), actor = c.get('actor');
    // Ordem de bloqueios igual à criação/arquivo: empresa antes de projecto.
    await lockModelingCompany(db, actor.companyId);
    const source = await lockedModel(c, input.revision), historical = await financialHistoryOf(db, source);
    if (!historical) throw new DomainError('historico_em_falta', 'Analise os balancetes antes de criar o modelo.', 422);
    const { notes, ...values } = financialModelFromHistory(historical.analysis.input, source.sector as FinancialSector);
    await requireProjectCapacity(db, actor.companyId);
    const [model] = await db.insert(financialModels).values({ ...values, companyId: actor.companyId, createdBy: actor.actorId }).returning();
    await db.insert(financialHistoricalInputs).values({ companyId: actor.companyId, modelId: model!.id, input: historical.analysis.input, inputHash: historical.inputHash, updatedBy: actor.actorId });
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create_from_trial_balance', entity: 'financial_model', entityId: model!.id, after: { sourceModelId: source.id, sourceRevision: source.revision, historicalHash: historical.inputHash, revision: 1 } });
    return c.json({ model, historical, notes }, 201);
  });
  return app;
}
