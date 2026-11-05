import { luandaDate, type PlatformModule } from '@kianda/core';
import { and, auditLogs, companies, companyModules, desc, eq, financialModels, getDb, gte, inArray, isNull, modelingMembers, sql, valuationAnalyses, valuationMembers, type Db } from '@kianda/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { body, requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { COPILOT_KNOWLEDGE_VERSION, COPILOT_NAMES, expertGuides } from '../services/copilot-knowledge.js';
import { copilotAiConfig, copilotDailyLimit, requestExpertAnswer } from '../services/copilot-ai.js';
import { modelingCopilotContext, valuationCopilotContext } from '../services/copilot-context.js';
import { projectPermission, visibleModels } from '../services/modeling-access.js';
import { lockModelingCompany, modelingUsage, requireModelingSector } from '../services/modeling-policy.js';
import { lockValuationCompany, valuationUsage } from '../services/valuation-policy.js';
import { DomainError } from '../services/payroll.js';

const moduleSchema = z.enum(['hr', 'modeling', 'valuation']);
async function membership(db: Db, actor: Actor, module: PlatformModule) {
  if (module === 'hr') return;
  if (module === 'modeling') {
    let [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, actor.companyId), eq(modelingMembers.userId, actor.actorId)));
    if (!member && actor.role === 'owner') {
      await lockModelingCompany(db, actor.companyId);
      [member] = await db.select().from(modelingMembers).where(and(eq(modelingMembers.companyId, actor.companyId), eq(modelingMembers.userId, actor.actorId)));
      if (!member) {
        if (!(await modelingUsage(db, actor.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'Atingiu o limite de utilizadores do Integra.', 409);
        [member] = await db.insert(modelingMembers).values({ companyId: actor.companyId, userId: actor.actorId, addedBy: actor.actorId }).returning();
        await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'activate', entity: 'modeling_member', entityId: member!.id });
      }
    }
    if (!member?.enabled) throw new DomainError('sem_permissao', 'Solicite ao proprietário acesso ao Integra.', 403);
    return member;
  }
  let [member] = await db.select().from(valuationMembers).where(and(eq(valuationMembers.companyId, actor.companyId), eq(valuationMembers.userId, actor.actorId)));
  if (!member && actor.role === 'owner') {
    await lockValuationCompany(db, actor.companyId);
    [member] = await db.select().from(valuationMembers).where(and(eq(valuationMembers.companyId, actor.companyId), eq(valuationMembers.userId, actor.actorId)));
    if (!member) {
      if (!(await valuationUsage(db, actor.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'Atingiu o limite de utilizadores do Valora.', 409);
      [member] = await db.insert(valuationMembers).values({ companyId: actor.companyId, userId: actor.actorId, addedBy: actor.actorId }).returning();
      await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'activate', entity: 'valuation_member', entityId: member!.id });
    }
  }
  if (!member?.enabled) throw new DomainError('sem_permissao', 'Solicite ao proprietário acesso ao Valora.', 403);
}

async function financialContext(db: Db, actor: Actor, module: PlatformModule, entityId: string, revision?: number) {
  if (module === 'hr') throw new DomainError('contexto_invalido', 'O copiloto RH não recebe fichas ou documentos de colaboradores.', 400);
  if (module === 'modeling') {
    const member = await membership(db, actor, module);
    const [row] = await db.select().from(financialModels).where(and(eq(financialModels.id, entityId), eq(financialModels.companyId, actor.companyId)));
    if (!row || !member || !(await projectPermission(db, member, actor.role, row.id))) throw new DomainError('nao_encontrado', 'Projecto inexistente.', 404);
    await requireModelingSector(db, actor.companyId, row.sector);
    if (revision !== undefined && revision !== row.revision) throw new DomainError('revisao_invalida', 'O projecto mudou. Actualize o resumo e autorize o contexto novamente.', 409);
    return modelingCopilotContext(row.assumptions, row.currency, row.revision);
  }
  const [row] = await db.select().from(valuationAnalyses).where(and(eq(valuationAnalyses.id, entityId), eq(valuationAnalyses.companyId, actor.companyId)));
  if (!row) throw new DomainError('nao_encontrado', 'Análise inexistente.', 404);
  if (revision !== undefined && revision !== row.revision) throw new DomainError('revisao_invalida', 'A análise mudou. Actualize o resumo e autorize o contexto novamente.', 409);
  return valuationCopilotContext(row.data, row.revision);
}

export function copilotRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/copilots/*', bodyLimit({ maxSize: 64000, onError: c => c.json({ error: 'pedido_extenso', message: 'Reduza o tamanho da pergunta e da conversa.' }, 413) }));
  app.use('/v1/copilots/*', requireCompany);
  app.use('/v1/copilots/:module/*', async (c, next) => {
    moduleSchema.parse(c.req.param('module')); c.header('Cache-Control', 'private, no-store'); await next();
  });
  app.get('/v1/copilots/:module/setup', async c => {
    const module = moduleSchema.parse(c.req.param('module')), actor = c.get('actor'), db = getDb();
    const member = await membership(db, actor, module);
    let entities: { id: string; name: string; revision: number }[] = [];
    if (module === 'modeling' && member) {
      const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, actor.companyId), eq(companyModules.module, module)));
      const rows = await db.select({ id: financialModels.id, name: financialModels.name, revision: financialModels.revision }).from(financialModels).where(and(eq(financialModels.companyId, actor.companyId), isNull(financialModels.archivedAt), inArray(financialModels.sector, grant?.modelingSectors ?? []))).orderBy(desc(financialModels.updatedAt)).limit(200);
      entities = await visibleModels(db, member, actor.role, rows);
    } else if (module === 'valuation') entities = await db.select({ id: valuationAnalyses.id, name: valuationAnalyses.name, revision: valuationAnalyses.revision }).from(valuationAnalyses).where(and(eq(valuationAnalyses.companyId, actor.companyId), isNull(valuationAnalyses.archivedAt))).orderBy(desc(valuationAnalyses.updatedAt)).limit(200);
    return c.json({ module, name: COPILOT_NAMES[module], knowledgeVersion: COPILOT_KNOWLEDGE_VERSION, aiReady: !!copilotAiConfig(), canAsk: c.get('moduleAccess').canWrite, dailyLimit: copilotDailyLimit(), guides: expertGuides(module), entities });
  });
  app.get('/v1/copilots/:module/context/:entityId', async c => {
    const module = moduleSchema.parse(c.req.param('module')), actor = c.get('actor'), db = getDb();
    await membership(db, actor, module);
    return c.json(await financialContext(db, actor, module, z.string().min(1).max(128).parse(c.req.param('entityId'))));
  });
  app.post('/v1/copilots/:module/ask', async c => {
    const module = moduleSchema.parse(c.req.param('module')), actor = c.get('actor'), db = getDb();
    await membership(db, actor, module);
    const b = z.object({ question: z.string().trim().min(3).max(1500), consent: z.literal(true, { message: 'Autorize o envio da pergunta ao serviço de IA.' }), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(3000) })).max(6).default([]), context: z.object({ entityId: z.string().min(1).max(128), revision: z.number().int().positive(), consent: z.literal(true, { message: 'Autorize expressamente o envio deste resumo financeiro.' }) }).optional() }).parse(await body(c));
    if (!copilotAiConfig()) throw new DomainError('copiloto_por_activar', 'A conversa com IA aguarda activação pela plataforma. Os guias do módulo continuam disponíveis.', 503);
    const context = b.context ? await financialContext(db, actor, module, b.context.entityId, b.context.revision) : undefined;
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const day = new Date(`${luandaDate(new Date())}T00:00:00+01:00`), hour = new Date(Date.now() - 3600000);
    const [count] = await db.select({ daily: sql<number>`count(*)::int`, hourly: sql<number>`count(*) filter(where ${auditLogs.actorId} = ${actor.actorId} and ${auditLogs.at} >= ${hour})::int` }).from(auditLogs).where(and(eq(auditLogs.companyId, actor.companyId), eq(auditLogs.action, 'copilot_request'), gte(auditLogs.at, day)));
    if (Number(count?.daily ?? 0) >= copilotDailyLimit() || Number(count?.hourly ?? 0) >= 20) throw new DomainError('limite_copiloto', 'Atingiu o limite de perguntas de IA. Os guias do módulo continuam disponíveis; tente mais tarde.', 429);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'copilot_request', entity: 'copilot', entityId: crypto.randomUUID(), after: { module, usedContext: !!context, contextRevision: context?.revision ?? null } });
    // Só valores imutáveis atravessam esta fronteira. O HTTP não mantém uma ligação nem bloqueios PostgreSQL.
    c.set('afterTenant', async () => c.json(await requestExpertAnswer(module, b.question, b.history, context)));
    return c.json({ processing: true });
  });
  return app;
}
