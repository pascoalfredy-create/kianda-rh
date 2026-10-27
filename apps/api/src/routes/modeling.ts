import { modelingExportOptions, modelingUsage, lockModelingCompany, requireProjectCapacity } from '../services/modeling-policy.js';
import { moduleLicence } from '../services/modules.js';
import { DomainError } from '../services/payroll.js';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { and, auditLogs, desc, eq, financialModels, financialPersonnelImports, getDb, gte, inArray, lte, payrollLines, payrollRuns, personnelBudgetLines, personnelBudgets, modelingMembers, users } from '@kianda/db';
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
  app.use('/v1/modeling/*', async (c, next) => {
    const a = c.get('actor'), db = getDb();
    let [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, a.companyId), eq(modelingMembers.userId, a.actorId)));
    if (!member && a.role === 'owner') {
      await lockModelingCompany(db, a.companyId);
      // Relê depois do bloqueio para que dois primeiros pedidos não consumam dois lugares.
      [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, a.companyId), eq(modelingMembers.userId, a.actorId)));
      if (!member) {
        if (!(await modelingUsage(db, a.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'Atingiu o limite de utilizadores da Modelagem.', 409);
        [member] = await db.insert(modelingMembers).values({ companyId: a.companyId, userId: a.actorId, addedBy: a.actorId }).returning();
        await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'activate', entity: 'modeling_member', entityId: member!.id });
      }
    }
    if (!member?.enabled) return c.json({ error: 'sem_permissao', message: 'Solicite ao proprietário acesso à Modelagem.' }, 403);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && member.permission !== 'editor') return c.json({ error: 'sem_permissao', message: 'O seu acesso permite apenas consulta.' }, 403);
    await next();
  });

  app.get('/v1/modeling/usage', async (c) => c.json(await modelingUsage(getDb(), c.get('actor').companyId)));
  app.get('/v1/modeling/export-options', async (c) => c.json(await modelingExportOptions(getDb(), c.get('actor').actorId)));
  app.get('/v1/modeling/members', requireRole(), async (c) => {
    return c.json(await getDb().select({ userId: modelingMembers.userId, permission: modelingMembers.permission, enabled: modelingMembers.enabled, name: users.name }).from(modelingMembers).innerJoin(users, eq(users.id, modelingMembers.userId)).where(eq(modelingMembers.companyId, c.get('actor').companyId)));
  });
  app.put('/v1/modeling/members/:userId', requireRole(), async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ enabled: z.boolean(), permission: z.enum(['editor', 'viewer']).default('editor') }).parse(await body(c));
    const userId = c.req.param('userId');
    if (userId === a.actorId && (!input.enabled || input.permission !== 'editor')) throw new DomainError('proprio_acesso', 'Não pode retirar o seu próprio acesso de gestão.', 409);
    await lockModelingCompany(db, a.companyId);
    const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, a.companyId)));
    if (!user || user.disabledAt) throw new DomainError('nao_encontrado', 'Utilizador activo inexistente nesta empresa.', 404);
    const [before] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, a.companyId), eq(modelingMembers.userId, userId)));
    if (input.enabled && !before?.enabled && !(await modelingUsage(db, a.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'O plano inclui cinco utilizadores. Contacte a plataforma para contratar acessos adicionais.', 409);
    const [member] = await db.insert(modelingMembers).values({ ...input, userId, companyId: a.companyId, addedBy: a.actorId }).onConflictDoUpdate({ target: [modelingMembers.companyId, modelingMembers.userId], set: input }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'change_access', entity: 'modeling_member', entityId: member!.id, before: before ?? null, after: member });
    return c.json(member);
  });


  app.get('/v1/modeling/models', async (c) => c.json(await getDb().select().from(financialModels).where(eq(financialModels.companyId, c.get('actor').companyId)).orderBy(desc(financialModels.updatedAt))));
  app.post('/v1/modeling/models', async (c) => {
    const a = c.get('actor'), db = getDb(), input = modelSchema.parse(await body(c));
    await requireProjectCapacity(db, a.companyId);
    const [model] = await db.insert(financialModels).values({ ...input, companyId: a.companyId, createdBy: a.actorId }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'create', entity: 'financial_model', entityId: model!.id, after: { revision: 1 } });
    return c.json(model, 201);
  });
  app.post('/v1/modeling/models/:id/archive', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ archived: z.boolean(), revision }).parse(await body(c));
    await lockModelingCompany(db, a.companyId);
    const [current] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')))).for('update');
    if (!current) throw new DomainError('nao_encontrado', 'Projecto inexistente', 404);
    if (current.revision !== input.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo.', 409);
    if (!input.archived && current.archivedAt) await requireProjectCapacity(db, a.companyId);
    const [model] = await db.update(financialModels).set({ archivedAt: input.archived ? new Date() : null, revision: current.revision + 1, updatedAt: new Date() }).where(eq(financialModels.id, current.id)).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: input.archived ? 'archive' : 'restore', entity: 'financial_model', entityId: current.id, after: { revision: model!.revision } });
    return c.json(model);
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
    const [current] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')))).for('update');
    if (current?.archivedAt) throw new DomainError('projecto_arquivado', 'Restaure o projecto antes de o alterar.', 409);
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
    await lockModelingCompany(db, a.companyId);
    const [model] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')))).for('update');
    if (!model) throw new DomainError('nao_encontrado', 'Modelo inexistente', 404);
    if (model.archivedAt) throw new DomainError('projecto_arquivado', 'Restaure o projecto antes de importar dados.', 409);
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
