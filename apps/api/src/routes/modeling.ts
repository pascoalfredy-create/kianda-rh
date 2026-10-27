import { moduleLicence } from '../services/modules.js';
import { DomainError } from '../services/payroll.js';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { and, auditLogs, desc, eq, financialModels, financialPersonnelImports, getDb, gte, inArray, lte, payrollLines, payrollRuns, personnelBudgetLines, personnelBudgets } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';

const sector = z.enum(['mineracao', 'petroleo', 'agro', 'comercio', 'servicos', 'industria', 'imobiliario', 'tecnologia']);
const currency = z.enum(['Kz', 'USD', 'EUR']);
const revision = z.number().int().positive();
const assumptions = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 200_000, 'Pressupostos demasiado extensos');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const modelSchema = z.object({ name: z.string().trim().min(1).max(200), sector, currency, assumptions });
const yearPeriods = (from: string) => { const [y, m] = from.split('-').map(Number); return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y!, m! - 1 + i, 1)).toISOString().slice(0, 7)); };

export function modelingRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/modeling', requireCompany);
  app.use('/v1/modeling/*', requireCompany);
  app.use('/v1/modeling/*', requireRole('finance'));

  app.get('/v1/modeling/models', async (c) => c.json(await getDb().select().from(financialModels).where(eq(financialModels.companyId, c.get('actor').companyId)).orderBy(desc(financialModels.updatedAt))));
  app.post('/v1/modeling/models', async (c) => {
    const a = c.get('actor'), db = getDb(), input = modelSchema.parse(await body(c));
    const [model] = await db.insert(financialModels).values({ ...input, companyId: a.companyId, createdBy: a.actorId }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'create', entity: 'financial_model', entityId: model!.id, after: { revision: 1 } });
    return c.json(model, 201);
  });
  app.get('/v1/modeling/models/:id', async (c) => {
    const [model] = await getDb().select().from(financialModels).where(and(eq(financialModels.companyId, c.get('actor').companyId), eq(financialModels.id, c.req.param('id'))));
    if (!model) throw new DomainError('nao_encontrado', 'Modelo inexistente', 404);
    const imports = await getDb().select().from(financialPersonnelImports).where(eq(financialPersonnelImports.modelId, model.id)).orderBy(desc(financialPersonnelImports.importedAt));
    return c.json({ ...model, imports });
  });
  app.put('/v1/modeling/models/:id', async (c) => {
    const a = c.get('actor'), db = getDb(), input = modelSchema.extend({ revision }).parse(await body(c));
    const { revision: expected, ...values } = input;
    const [model] = await db.update(financialModels).set({ ...values, revision: expected + 1, updatedAt: new Date() })
      .where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')), eq(financialModels.revision, expected))).returning();
    if (!model) throw new DomainError('revisao_invalida', 'Modelo inexistente ou alterado por outro utilizador. Volte a carregá-lo.', 409);
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'update', entity: 'financial_model', entityId: model.id, after: { revision: model.revision } });
    return c.json(model);
  });

  /** Importação explícita; a base RH nunca altera um modelo posteriormente. */
  app.post('/v1/modeling/models/:id/import-personnel', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.discriminatedUnion('source', [
      z.object({ source: z.literal('budget'), budgetId: z.string().min(1), revision, exchangeRate: z.number().positive().finite().max(1e9).optional() }),
      z.object({ source: z.literal('actual'), from: period, to: period, revision, exchangeRate: z.number().positive().finite().max(1e9).optional() }),
    ]).parse(await body(c));
    const hr = await moduleLicence(db, a.companyId, 'hr');
    if (!hr.canWrite) throw new DomainError('rh_inactivo', 'A importação requer o módulo RH activo. Pode preencher os pressupostos manualmente.', 403);
    const [model] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id'))));
    if (!model) throw new DomainError('nao_encontrado', 'Modelo inexistente', 404);
    if (model.revision !== input.revision) throw new DomainError('revisao_invalida', 'Modelo alterado. Volte a carregá-lo.', 409);
    if (model.currency !== 'Kz' && !input.exchangeRate) throw new DomainError('cambio_obrigatorio', 'Indique unidades da moeda do modelo por 1 Kz.', 400);
    if (model.currency === 'Kz' && input.exchangeRate !== undefined && input.exchangeRate !== 1) throw new DomainError('cambio_invalido', 'Modelos em Kz usam câmbio 1.', 400);
    let from: string, to: string, sourceId: string | null = null;
    let months: { period: string; costMinor: number; headcount: number }[];
    if (input.source === 'budget') {
      const [budget] = await db.select().from(personnelBudgets).where(and(eq(personnelBudgets.companyId, a.companyId), eq(personnelBudgets.id, input.budgetId))).for('share');
      if (!budget) throw new DomainError('nao_encontrado', 'Orçamento inexistente', 404);
      if (budget.status !== 'approved') throw new DomainError('orcamento_nao_aprovado', 'Seleccione um orçamento de pessoal aprovado.', 409);
      sourceId = budget.id; from = `${budget.year}-01`; to = `${budget.year}-12`;
      const lines = await db.select().from(personnelBudgetLines).where(and(eq(personnelBudgetLines.companyId, a.companyId), eq(personnelBudgetLines.budgetId, budget.id)));
      months = yearPeriods(from).map((p) => ({ period: p, costMinor: lines.filter((l) => l.period === p).reduce((s, l) => s + l.costMinor, 0), headcount: lines.filter((l) => l.period === p).reduce((s, l) => s + Number(l.headcount), 0) }));
    } else {
      from = input.from; to = input.to;
      const periods = yearPeriods(from);
      if (periods[11] !== to) throw new DomainError('periodo_invalido', 'Seleccione exactamente 12 meses consecutivos.', 400);
      const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, a.companyId), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, from), lte(payrollRuns.period, to)));
      if (new Set(runs.map((r) => r.period)).size !== 12) throw new DomainError('periodos_em_falta', 'Os 12 meses devem ter processamento fechado.', 409);
      const lines = await db.select().from(payrollLines).where(inArray(payrollLines.runId, runs.map((r) => r.id)));
      months = periods.map((p) => {
        const ids = new Set(runs.filter((r) => r.period === p).map((r) => r.id));
        const mine = lines.filter((l) => ids.has(l.runId));
        return { period: p, costMinor: mine.reduce((s, l) => s + l.grossMinor + l.inssEmployerMinor, 0), headcount: new Set(mine.map((l) => l.employeeId)).size };
      });
    }
    const totalMinor = months.reduce((s, m) => s + m.costMinor, 0);
    if (!Number.isSafeInteger(totalMinor)) throw new DomainError('montante_invalido', 'Custo fora do intervalo suportado.', 400);
    const exchangeRate = input.exchangeRate ?? 1;
    const annualPersonnel = totalMinor / 100 * exchangeRate;
    if (!Number.isFinite(annualPersonnel) || annualPersonnel * 100 > Number.MAX_SAFE_INTEGER) throw new DomainError('montante_invalido', 'Valor convertido fora do intervalo suportado.', 400);
    const importedAt = new Date();
    const snapshot = { source: input.source, sourceId, sourceCurrency: 'Kz', currency: model.currency, exchangeRate, from, to, months, totalMinor, annualPersonnel, importedAt: importedAt.toISOString() };
    const [updated] = await db.update(financialModels).set({ assumptions: { ...model.assumptions as Record<string, unknown>, pessoal: annualPersonnel }, revision: model.revision + 1, updatedAt: importedAt })
      .where(and(eq(financialModels.id, model.id), eq(financialModels.companyId, a.companyId), eq(financialModels.revision, input.revision))).returning();
    if (!updated) throw new DomainError('revisao_invalida', 'Modelo alterado. Volte a carregá-lo.', 409);
    const [record] = await db.insert(financialPersonnelImports).values({ companyId: a.companyId, modelId: model.id, source: input.source, sourceId, fromPeriod: from, toPeriod: to, snapshot, importedBy: a.actorId, importedAt }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'import_personnel', entity: 'financial_model', entityId: model.id, before: { pessoal: (model.assumptions as Record<string, unknown>).pessoal ?? null }, after: { importId: record!.id, revision: updated.revision, pessoal: annualPersonnel } });
    return c.json({ model: updated, import: record }, 201);
  });
  return app;
}

/** Gestão técnica na consola existente; nenhuma adesão é concedida por omissão. */
export function moduleRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/modules', requireCompany);
  app.get('/v1/modules', requireRole('finance'), async (c) => {
    const db = getDb(), { companyId } = c.get('actor');
    return c.json({ hr: await moduleLicence(db, companyId, 'hr'), modeling: await moduleLicence(db, companyId, 'modeling') });
  });
  return app;
}
