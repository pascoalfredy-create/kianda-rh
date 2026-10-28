import { randomUUID } from 'node:crypto';
import { FINANCIAL_DOCUMENT_KEYS, FINANCIAL_REPORT_KEYS, FINANCIAL_REPORT_TITLES, type FinancialReportDocument } from '@kianda/core';
import { financialHistoricalDocument, financialHistoryOf, financialReportBundle, financialVersionOf } from '../services/modeling-versions.js';
import { modelingHistoryRoutes } from './modeling-history.js';
import { renderFinancialPdf } from '../lib/financial-pdf.js';
import { renderFinancialXlsx } from '../lib/financial-xlsx.js';
import { FINANCIAL_SECTORS, financialBreakEvenPrice, financialScenarios, financialSensitivity, financialTemplate, runFinancialModel } from '@kianda/core';
import { financialCalculationSource, financialFingerprint, financialModelOf } from '../services/modeling-calculation.js';
import { modelingExportOptions, modelingUsage, lockModelingCompany, requireProjectCapacity } from '../services/modeling-policy.js';
import { moduleLicence } from '../services/modules.js';
import { DomainError } from '../services/payroll.js';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { and, auditLogs, companies, desc, eq, financialModelVersions, financialModels, financialPersonnelImports, getDb, gte, inArray, lte, payrollLines, payrollRuns, personnelBudgetLines, personnelBudgets, modelingMembers, users } from '@kianda/db';
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
    c.header('Cache-Control', 'private, no-store');
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

  app.get('/v1/modeling/session', async (c) => {
    const a = c.get('actor'), db = getDb();
    const [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, a.companyId), eq(modelingMembers.userId, a.actorId)));
    const [company] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, a.companyId));
    const licence = await moduleLicence(db, a.companyId, 'modeling');
    return c.json({ user: { id: a.actorId, name: a.session.name, role: a.role }, company, permission: member!.permission, canWrite: member!.permission === 'editor' && licence.canWrite, formats: await modelingExportOptions(db, a.actorId), usage: await modelingUsage(db, a.companyId) });
  });
  app.route('/', modelingHistoryRoutes());

  const scenarioQuery = z.object({ scenario: z.enum(['base', 'otim', 'pess']).optional(), revision: z.coerce.number().int().positive().optional() });
  app.get('/v1/modeling/templates', async (c) => c.json(FINANCIAL_SECTORS.map(financialTemplate)));
  app.get('/v1/modeling/templates/:sector', async (c) => c.json(financialTemplate(sector.parse(c.req.param('sector')))));
  app.post('/v1/modeling/simulate', async (c) => {
    const input = z.object({ assumptions, overrides: z.object({ cen: z.enum(['base', 'otim', 'pess']).optional(), preco: z.number().optional(), volume: z.number().optional(), cvar: z.number().optional(), fixos: z.number().optional(), capex: z.number().optional(), wacc: z.number().optional() }).default({}) }).parse(await body(c));
    return c.json(runFinancialModel(input.assumptions, input.overrides));
  });
  app.get('/v1/modeling/models/:id/calculation', async (c) => {
    const query = scenarioQuery.parse(c.req.query()), model = await financialModelOf(c);
    if (query.revision !== undefined && query.revision !== model.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de calcular.', 409);
    return c.json({ ...financialCalculationSource(model), result: runFinancialModel(model.assumptions, { cen: query.scenario }) });
  });
  app.get('/v1/modeling/models/:id/scenarios', async (c) => {
    const query = scenarioQuery.parse(c.req.query()), model = await financialModelOf(c);
    if (query.revision !== undefined && query.revision !== model.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de calcular.', 409);
    return c.json({ ...financialCalculationSource(model), results: financialScenarios(model.assumptions) });
  });
  app.get('/v1/modeling/models/:id/sensitivity', async (c) => {
    const query = scenarioQuery.parse(c.req.query()), model = await financialModelOf(c);
    if (query.revision !== undefined && query.revision !== model.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de calcular.', 409);
    return c.json({ ...financialCalculationSource(model), rows: financialSensitivity(model.assumptions, query.scenario), breakEvenPriceMultiplier: financialBreakEvenPrice(model.assumptions, query.scenario) });
  });

  const versionMetadata = { id: financialModelVersions.id, versionNumber: financialModelVersions.versionNumber, label: financialModelVersions.label, sourceRevision: financialModelVersions.sourceRevision, sourceHash: financialModelVersions.sourceHash, payloadHash: financialModelVersions.payloadHash, engineVersion: financialModelVersions.engineVersion, reportVersion: financialModelVersions.reportVersion, approvedBy: financialModelVersions.approvedBy, approvedAt: financialModelVersions.approvedAt };
  app.get('/v1/modeling/models/:id/versions', async (c) => {
    const model = await financialModelOf(c);
    return c.json(await getDb().select(versionMetadata).from(financialModelVersions).where(and(eq(financialModelVersions.companyId, c.get('actor').companyId), eq(financialModelVersions.modelId, model.id))).orderBy(desc(financialModelVersions.versionNumber)));
  });
  app.get('/v1/modeling/models/:id/versions/:versionId', async (c) => {
    const model = await financialModelOf(c);
    return c.json(await financialVersionOf(getDb(), c.get('actor').companyId, model.id, z.uuid().parse(c.req.param('versionId'))));
  });
  app.post('/v1/modeling/models/:id/versions', requireRole(), async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ revision, label: z.string().trim().min(1).max(80) }).parse(await body(c));
    const [model] = await db.select().from(financialModels).where(and(eq(financialModels.companyId, a.companyId), eq(financialModels.id, c.req.param('id')))).for('update');
    if (!model) throw new DomainError('nao_encontrado', 'Projecto inexistente', 404);
    if (model.archivedAt) throw new DomainError('projecto_arquivado', 'Restaure o projecto antes de aprovar uma nova versão.', 409);
    if (model.revision !== input.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de aprovar.', 409);
    const [existing] = await db.select(versionMetadata).from(financialModelVersions).where(and(eq(financialModelVersions.modelId, model.id), eq(financialModelVersions.companyId, a.companyId), eq(financialModelVersions.sourceRevision, input.revision), eq(financialModelVersions.label, input.label)));
    if (existing) return c.json(existing);
    const [latest] = await db.select({ n: financialModelVersions.versionNumber }).from(financialModelVersions).where(eq(financialModelVersions.modelId, model.id)).orderBy(desc(financialModelVersions.versionNumber)).limit(1);
    const versionNumber = (latest?.n ?? 0) + 1, id = randomUUID(), approvedAt = new Date();
    const [user] = await db.select({ name: users.name }).from(users).where(and(eq(users.id, a.actorId), eq(users.companyId, a.companyId)));
    const payload = await financialReportBundle(db, model, { state: 'approved', asOf: approvedAt.toISOString(), versionId: id, versionNumber, versionLabel: input.label, approvedByName: user?.name ?? a.session.name });
    const [version] = await db.insert(financialModelVersions).values({ id, companyId: a.companyId, modelId: model.id, versionNumber, label: input.label, sourceRevision: model.revision, sourceHash: payload.source.sourceHash, payloadHash: financialFingerprint(payload), engineVersion: payload.result.engineVersion, reportVersion: payload.reportVersion, payload, approvedBy: a.actorId, approvedAt }).returning(versionMetadata);
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'approve_version', entity: 'financial_model_version', entityId: id, after: { modelId: model.id, versionNumber, label: input.label, sourceRevision: model.revision, sourceHash: payload.source.sourceHash } });
    return c.json(version, 201);
  });
  app.get('/v1/modeling/models/:id/reports', async (c) => {
    const model = await financialModelOf(c, true), query = z.object({ version: z.uuid().optional() }).parse(c.req.query()), db = getDb();
    const historical = query.version ? Boolean((await financialVersionOf(db, c.get('actor').companyId, model.id, query.version)).payload.reports.analise) : Boolean(await financialHistoryOf(db, model));
    return c.json({ reports: [...FINANCIAL_REPORT_KEYS.map((key) => ({ key, title: FINANCIAL_REPORT_TITLES[key], available: true })), { key: 'analise', title: 'Relatório de análise económico-financeira', available: historical, ...(historical ? {} : { reason: 'Requer balancetes históricos analisados nesta revisão ou versão.' }) }], formats: await modelingExportOptions(db, c.get('actor').actorId) });
  });
  app.get('/v1/modeling/models/:id/reports/:reportKey', async (c) => {
    const a = c.get('actor'), db = getDb();
    const query = z.object({ format: z.enum(['pdf', 'xlsx']).default('pdf'), version: z.uuid().optional(), revision: z.coerce.number().int().positive().optional(), scenario: z.enum(['base', 'otim', 'pess']).optional() }).refine((q) => !q.version || !q.scenario, 'Uma versão aprovada não admite alteração de cenário.').parse(c.req.query());
    if (query.format === 'xlsx' && !(await modelingExportOptions(db, a.actorId)).xlsx) throw new DomainError('formato_nao_permitido', 'A exportação Excel é exclusiva da conta do proprietário da plataforma. Utilize PDF.', 403);
    const model = await financialModelOf(c, true);
    const key = z.enum(FINANCIAL_DOCUMENT_KEYS).parse(c.req.param('reportKey'));
    if (!query.version && query.revision !== undefined && model.revision !== query.revision) throw new DomainError('revisao_invalida', 'Projecto alterado. Volte a carregá-lo antes de exportar.', 409);
    const bundle: FinancialReportDocument = query.version ? (await financialVersionOf(db, a.companyId, model.id, query.version)).payload : key === 'analise' ? await financialHistoricalDocument(db, model) : await financialReportBundle(db, query.scenario ? { ...model, assumptions: { ...(model.assumptions as Record<string, unknown>), cen: query.scenario } } : model);
    if (!bundle.reports[key]) throw new DomainError('historico_em_falta', 'Esta versão não contém balancetes históricos analisados.', 422);
    const data = query.format === 'pdf' ? renderFinancialPdf(bundle, key) : renderFinancialXlsx(bundle, key);
    const ref = bundle.source.versionNumber ? 'v' + bundle.source.versionNumber : 'r' + bundle.source.revision;
    const filename = `Integra-${model.id.slice(0, 8)}-${ref}-${key}.${query.format}`;
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'export_report', entity: 'financial_model', entityId: model.id, after: { report: key, format: query.format, versionId: bundle.source.versionId ?? null, sourceRevision: bundle.source.revision, sourceHash: bundle.source.sourceHash, historicalHash: bundle.source.historicalHash ?? null } });
    return new Response(new Uint8Array(data), { headers: { 'content-type': query.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-source-revision': String(bundle.source.revision), 'x-source-hash': bundle.source.sourceHash, 'x-source-scenario': key === 'analise' ? 'historical' : (bundle as import('@kianda/core').FinancialReportBundle).result.scenario, ...(bundle.source.historicalHash ? { 'x-source-history-hash': bundle.source.historicalHash } : {}) } });
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
