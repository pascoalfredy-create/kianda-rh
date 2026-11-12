import { canExportDocuments, luandaDate, personnelCostMkz, VALUATION_BALANCE_KEYS, VALUATION_FLOW_KEYS, VALUATION_OPTIONAL_FLOW_KEYS, valuationDataIssue } from '@kianda/core';
import { and, auditLogs, companies, companyModules, desc, eq, getDb, gte, inArray, lte, payrollLines, payrollRuns, users, valuationAnalyses, valuationMembers, valuationVersions, type Db, type ValuationAnalysisRow } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv, type Ctx } from '../plugins/tenant.js';
import { moduleLicence } from '../services/modules.js';
import { DomainError } from '../services/payroll.js';
import { lockValuationCompany, requireAnalysisCapacity, valuationUsage } from '../services/valuation-policy.js';

const revision = z.number().int().positive();
const name = z.string().trim().min(1, 'Indique o nome da análise').max(200);
const data = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  const issue = valuationDataIssue(value);
  if (issue) ctx.addIssue({ code: 'custom', message: issue });
});
const MAX_REQUEST_BYTES = 1_500_000;

/** Lista sem os dados completos: abrir uma análise é um pedido próprio. */
const summary = { id: valuationAnalyses.id, name: valuationAnalyses.name, ownCompany: valuationAnalyses.ownCompany, revision: valuationAnalyses.revision, archivedAt: valuationAnalyses.archivedAt, updatedAt: valuationAnalyses.updatedAt, createdAt: valuationAnalyses.createdAt };

async function analysisOf(c: Ctx, forUpdate = false) {
  const a = c.get('actor'), db = getDb();
  const query = db.select().from(valuationAnalyses).where(and(eq(valuationAnalyses.companyId, a.companyId), eq(valuationAnalyses.id, c.req.param('id') ?? '')));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw new DomainError('nao_encontrado', 'Análise inexistente', 404);
  return row;
}

const VERSION_GAP_MS = 30 * 60_000, VERSIONS_KEPT = 50;
/**
 * Guarda o estado anterior antes de o alterar (V-8). Nas gravações automáticas, uma cópia por sessão de trabalho (30 min);
 * antes de importações e reposições, sempre. Mantém as 50 mais recentes por análise.
 */
async function keepVersion(db: Db, row: ValuationAnalysisRow, actorId: string, reason: 'edit' | 'import_balance' | 'import_personnel' | 'before_restore') {
  if (reason === 'edit') {
    const [last] = await db.select({ createdAt: valuationVersions.createdAt }).from(valuationVersions).where(eq(valuationVersions.analysisId, row.id)).orderBy(desc(valuationVersions.createdAt)).limit(1);
    const lastEdit = new Date(row.updatedAt).getTime();
    if (last && Date.now() - new Date(last.createdAt).getTime() < VERSION_GAP_MS && Date.now() - lastEdit < VERSION_GAP_MS) return;
  }
  await db.insert(valuationVersions).values({ companyId: row.companyId, analysisId: row.id, revision: row.revision, name: row.name, data: row.data, reason, savedBy: actorId });
  const old = await db.select({ id: valuationVersions.id }).from(valuationVersions).where(eq(valuationVersions.analysisId, row.id)).orderBy(desc(valuationVersions.createdAt)).offset(VERSIONS_KEPT);
  if (old.length) await db.delete(valuationVersions).where(inArray(valuationVersions.id, old.map(v => v.id)));
}

export function valuationRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/valuation', requireCompany);
  app.use('/v1/valuation/*', requireCompany);
  app.use('/v1/valuation/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_REQUEST_BYTES) return c.json({ error: 'pedido_extenso', message: 'A análise excede o tamanho máximo (1 MB).' }, 413);
    const a = c.get('actor'), db = getDb();
    let [member] = await db.select().from(valuationMembers).where(and(eq(valuationMembers.companyId, a.companyId), eq(valuationMembers.userId, a.actorId)));
    if (!member && a.role === 'owner') {
      await lockValuationCompany(db, a.companyId);
      // Relê depois do bloqueio para que dois primeiros pedidos não ocupem dois lugares.
      [member] = await db.select().from(valuationMembers).where(and(eq(valuationMembers.companyId, a.companyId), eq(valuationMembers.userId, a.actorId)));
      if (!member) {
        if (!(await valuationUsage(db, a.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'Atingiu o limite de utilizadores do Valora.', 409);
        [member] = await db.insert(valuationMembers).values({ companyId: a.companyId, userId: a.actorId, addedBy: a.actorId }).returning();
        await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'activate', entity: 'valuation_member', entityId: member!.id });
      }
    }
    if (!member?.enabled) return c.json({ error: 'sem_permissao', message: 'Solicite ao proprietário acesso ao Valora.' }, 403);
    c.set('valuationPermission', member.permission);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && member.permission !== 'editor' && !c.req.path.startsWith('/v1/valuation/members')) return c.json({ error: 'sem_permissao', message: 'O seu acesso permite apenas consulta.' }, 403);
    await next();
  });

  const session = async (c: Ctx) => {
    const a = c.get('actor'), db = getDb(), access = c.get('moduleAccess');
    const [row] = await db.select({ company: { id: companies.id, name: companies.name, nif: companies.nif }, balanceMapping: companies.valuationBalanceMapping, grant: companyModules }).from(companies)
      .leftJoin(companyModules, and(eq(companyModules.companyId, companies.id), eq(companyModules.module, 'valuation'))).where(eq(companies.id, a.companyId));
    const permission = c.get('valuationPermission');
    const hr = await moduleLicence(db, a.companyId, 'hr');
    const exportable = canExportDocuments(access.status);
    return {
      user: { id: a.actorId, name: a.session.name, role: a.role }, company: row!.company, permission, balanceMapping: row?.balanceMapping ?? {},
      canWrite: permission === 'editor' && access.canWrite,
      formats: { pdf: exportable, docx: exportable, xlsx: exportable },
      licence: { status: access.status, trialEndsAt: row?.grant?.trialEndsAt ?? null, paidUntil: row?.grant?.paidUntil ?? null },
      usage: await valuationUsage(db, a.companyId),
      hr: { available: hr.canRead },
    };
  };
  app.put('/v1/valuation/balance-mapping', requireRole(), async (c) => {
    const a = c.get('actor'), db = getDb();
    if (!c.get('moduleAccess').canWrite) throw new DomainError('sem_permissao', 'A licença permite apenas consulta.', 403);
    const rubric = z.enum([...VALUATION_FLOW_KEYS, ...VALUATION_OPTIONAL_FLOW_KEYS, ...VALUATION_BALANCE_KEYS]);
    const input = z.object({
      account: z.string().regex(/^\d{1,20}$/),
      rubric: rubric.nullable(),
    }).parse(await body(c));
    const [company] = await db.select({ mapping: companies.valuationBalanceMapping }).from(companies).where(eq(companies.id, a.companyId)).for('update');
    const mapping = { ...company!.mapping };
    if (input.rubric === null) delete mapping[input.account];
    else mapping[input.account] = input.rubric;
    if (Object.keys(mapping).length > 500) throw new DomainError('limite_mapeamento', 'O mapeamento admite até 500 contas.', 422);
    await db.update(companies).set({ valuationBalanceMapping: mapping }).where(eq(companies.id, a.companyId));
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'update', entity: 'valuation_balance_mapping', entityId: a.companyId, after: input });
    return c.json(mapping);
  });
  app.get('/v1/valuation/session', async (c) => c.json(await session(c)));
  /** Abertura da interface: sessão, lista de análises e a mais recente já carregada. */
  app.get('/v1/valuation/bootstrap', async (c) => {
    const db = getDb(), companyId = c.get('actor').companyId;
    const analyses = await db.select(summary).from(valuationAnalyses).where(eq(valuationAnalyses.companyId, companyId)).orderBy(desc(valuationAnalyses.updatedAt));
    const first = analyses.find(x => !x.archivedAt);
    const [current] = first ? await db.select().from(valuationAnalyses).where(and(eq(valuationAnalyses.companyId, companyId), eq(valuationAnalyses.id, first.id))) : [];
    return c.json({ ...(await session(c)), analyses, current: current ?? null });
  });

  app.get('/v1/valuation/analyses', async (c) => c.json(await getDb().select(summary).from(valuationAnalyses).where(eq(valuationAnalyses.companyId, c.get('actor').companyId)).orderBy(desc(valuationAnalyses.updatedAt))));
  app.get('/v1/valuation/analyses/:id', async (c) => c.json(await analysisOf(c)));

  app.post('/v1/valuation/analyses', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ name, data, ownCompany: z.boolean().default(false), source: z.enum(['blank', 'example', 'duplicate', 'file']).default('blank') }).parse(await body(c));
    await requireAnalysisCapacity(db, a.companyId);
    const [row] = await db.insert(valuationAnalyses).values({ companyId: a.companyId, name: input.name, data: input.data, ownCompany: input.ownCompany, createdBy: a.actorId, updatedBy: a.actorId }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'create', entity: 'valuation_analysis', entityId: row!.id, after: { name: row!.name, ownCompany: row!.ownCompany, source: input.source } });
    return c.json(row, 201);
  });

  /** Gravação com controlo de concorrência: quem tiver uma versão desactualizada recebe 409 e recarrega. */
  app.put('/v1/valuation/analyses/:id', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ revision, name: name.optional(), data: data.optional(), ownCompany: z.boolean().optional(), importBalance: z.literal(true).optional() })
      .refine(v => v.name !== undefined || v.data !== undefined || v.ownCompany !== undefined, 'Nada para gravar')
      .refine(v => !v.importBalance || v.data !== undefined, 'A importação deve incluir os dados da análise').parse(await body(c));
    const current = await analysisOf(c, true);
    if (current.archivedAt) throw new DomainError('analise_arquivada', 'Restaure a análise antes de a alterar.', 409);
    if (current.revision !== input.revision) return c.json({ error: 'revisao_invalida', message: 'A análise foi alterada noutra sessão. Recarregue para continuar com a versão mais recente.', revision: current.revision }, 409);
    if (input.data !== undefined) await keepVersion(db, current, a.actorId, input.importBalance ? 'import_balance' : 'edit');
    const [row] = await db.update(valuationAnalyses).set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.data !== undefined ? { data: input.data } : {}), ...(input.ownCompany !== undefined ? { ownCompany: input.ownCompany } : {}), revision: current.revision + 1, updatedBy: a.actorId, updatedAt: new Date() })
      .where(and(eq(valuationAnalyses.id, current.id), eq(valuationAnalyses.companyId, a.companyId), eq(valuationAnalyses.revision, input.revision))).returning();
    if (!row) return c.json({ error: 'revisao_invalida', message: 'A análise foi alterada noutra sessão. Recarregue para continuar.' }, 409);
    // A auditoria regista quem gravou e a revisão; os valores ficam na própria análise.
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: input.importBalance ? 'import_balance' : 'update', entity: 'valuation_analysis', entityId: row.id,
      before: { revision: current.revision, ...(input.name !== undefined && input.name !== current.name ? { name: current.name } : {}), ...(input.ownCompany !== undefined ? { ownCompany: current.ownCompany } : {}) },
      after: { revision: row.revision, ...(input.name !== undefined && input.name !== current.name ? { name: row.name } : {}), ...(input.ownCompany !== undefined ? { ownCompany: row.ownCompany } : {}) } });
    return c.json({ id: row.id, name: row.name, ownCompany: row.ownCompany, revision: row.revision, updatedAt: row.updatedAt });
  });

  /** Versões anteriores (sem os dados): quem gravou, quando e porquê. */
  app.get('/v1/valuation/analyses/:id/versions', async (c) => {
    const db = getDb(), current = await analysisOf(c);
    const rows = await db.select({ id: valuationVersions.id, revision: valuationVersions.revision, name: valuationVersions.name, reason: valuationVersions.reason, createdAt: valuationVersions.createdAt, savedBy: users.name })
      .from(valuationVersions).leftJoin(users, eq(users.id, valuationVersions.savedBy))
      .where(and(eq(valuationVersions.companyId, current.companyId), eq(valuationVersions.analysisId, current.id))).orderBy(desc(valuationVersions.createdAt));
    return c.json(rows);
  });
  /** Repor uma versão anterior: o estado actual fica guardado como versão antes da reposição. */
  app.post('/v1/valuation/analyses/:id/versions/:versionId/restore', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ revision }).parse(await body(c));
    const current = await analysisOf(c, true);
    if (current.archivedAt) throw new DomainError('analise_arquivada', 'Restaure a análise antes de a alterar.', 409);
    if (current.revision !== input.revision) return c.json({ error: 'revisao_invalida', message: 'A análise foi alterada noutra sessão. Recarregue para continuar.', revision: current.revision }, 409);
    const [version] = await db.select().from(valuationVersions).where(and(eq(valuationVersions.companyId, a.companyId), eq(valuationVersions.analysisId, current.id), eq(valuationVersions.id, c.req.param('versionId') ?? '')));
    if (!version) throw new DomainError('nao_encontrado', 'Versão inexistente', 404);
    const issue = valuationDataIssue(version.data);
    if (issue) throw new DomainError('versao_invalida', 'Esta versão já não abre no motor actual: ' + issue, 409);
    await keepVersion(db, current, a.actorId, 'before_restore');
    const [row] = await db.update(valuationAnalyses).set({ data: version.data, revision: current.revision + 1, updatedBy: a.actorId, updatedAt: new Date() })
      .where(and(eq(valuationAnalyses.id, current.id), eq(valuationAnalyses.companyId, a.companyId), eq(valuationAnalyses.revision, input.revision))).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'restore_version', entity: 'valuation_analysis', entityId: current.id,
      before: { revision: current.revision }, after: { revision: row!.revision, versionId: version.id, versionRevision: version.revision, versionDate: version.createdAt } });
    return c.json(row);
  });

  app.post('/v1/valuation/analyses/:id/archive', async (c) => {
    const a = c.get('actor'), db = getDb();
    const current = await analysisOf(c, true);
    if (current.archivedAt) return c.json({ id: current.id, archivedAt: current.archivedAt });
    const [row] = await db.update(valuationAnalyses).set({ archivedAt: new Date(), updatedBy: a.actorId }).where(and(eq(valuationAnalyses.id, current.id), eq(valuationAnalyses.companyId, a.companyId))).returning(summary);
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'archive', entity: 'valuation_analysis', entityId: current.id, after: { name: current.name } });
    return c.json({ ...row, usage: await valuationUsage(db, a.companyId) });
  });
  app.post('/v1/valuation/analyses/:id/restore', async (c) => {
    const a = c.get('actor'), db = getDb();
    await lockValuationCompany(db, a.companyId);
    const current = await analysisOf(c, true);
    if (!current.archivedAt) return c.json({ id: current.id, archivedAt: null });
    // Restaurada e arquivada neste mês: já ocupa a vaga, voltar a activá-la não consome outra.
    const monthStart = new Date(`${luandaDate(new Date()).slice(0, 7)}-01T00:00:00+01:00`);
    const held = !!current.restoredAt && new Date(current.restoredAt) >= monthStart && new Date(current.archivedAt) >= monthStart;
    if (!held) await requireAnalysisCapacity(db, a.companyId);
    const [row] = await db.update(valuationAnalyses).set({ archivedAt: null, restoredAt: new Date(), updatedBy: a.actorId }).where(and(eq(valuationAnalyses.id, current.id), eq(valuationAnalyses.companyId, a.companyId))).returning(summary);
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'restore', entity: 'valuation_analysis', entityId: current.id, after: { name: current.name } });
    return c.json({ ...row, usage: await valuationUsage(db, a.companyId) });
  });

  /**
   * Custos com o pessoal (conta 72) reais do exercício da análise, a partir dos processamentos fechados do RH.
   * Só para a análise da própria empresa. Totais mensais agregados: sem nomes nem remunerações individuais.
   */
  app.post('/v1/valuation/analyses/:id/import-personnel', async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ revision }).parse(await body(c));
    const hr = await moduleLicence(db, a.companyId, 'hr');
    if (!hr.canRead) throw new DomainError('rh_inactivo', 'A ligação requer o módulo RH activo nesta empresa. Pode introduzir os custos com o pessoal manualmente.', 403);
    const current = await analysisOf(c, true);
    if (!current.ownCompany) throw new DomainError('analise_externa', 'Os custos do processamento salarial só podem ser trazidos para a análise da própria empresa.', 409);
    if (current.archivedAt) throw new DomainError('analise_arquivada', 'Restaure a análise antes de a alterar.', 409);
    if (current.revision !== input.revision) return c.json({ error: 'revisao_invalida', message: 'A análise foi alterada noutra sessão. Recarregue para continuar.', revision: current.revision }, 409);
    const analysis = current.data as { years: number[]; ex?: number; real: Record<string, (number | null)[]> };
    const year = analysis.ex ?? analysis.years[analysis.years.length - 1]! + 1;
    const runs = await db.select({ id: payrollRuns.id, period: payrollRuns.period }).from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, a.companyId), eq(payrollRuns.status, 'closed'), gte(payrollRuns.period, `${year}-01`), lte(payrollRuns.period, `${year}-12`)));
    if (!runs.length) throw new DomainError('sem_processamentos', `Não há processamentos salariais fechados em ${year}.`, 409);
    const lines = await db.select({ runId: payrollLines.runId, grossMinor: payrollLines.grossMinor, inssEmployerMinor: payrollLines.inssEmployerMinor, employeeId: payrollLines.employeeId })
      .from(payrollLines).where(inArray(payrollLines.runId, runs.map(r => r.id)));
    const months = Array.from({ length: 12 }, (_, m) => {
      const period = `${year}-${String(m + 1).padStart(2, '0')}`;
      const ids = new Set(runs.filter(r => r.period === period).map(r => r.id));
      if (!ids.size) return null;
      const mine = lines.filter(l => ids.has(l.runId));
      const gross = mine.reduce((s, l) => s + l.grossMinor, 0), employer = mine.reduce((s, l) => s + l.inssEmployerMinor, 0);
      return { month: m, period, mkz: personnelCostMkz(gross, employer), headcount: new Set(mine.map(l => l.employeeId)).size };
    }).filter((m): m is NonNullable<typeof m> => m !== null);
    const c72 = [...(analysis.real.c72 ?? Array.from({ length: 12 }, () => null))];
    for (const m of months) c72[m.month] = m.mkz;
    const next = { ...analysis, real: { ...analysis.real, c72 } };
    const issue = valuationDataIssue(next);
    if (issue) throw new DomainError('analise_invalida', issue, 422);
    await keepVersion(db, current, a.actorId, 'import_personnel');
    const [row] = await db.update(valuationAnalyses).set({ data: next, revision: current.revision + 1, updatedBy: a.actorId, updatedAt: new Date() })
      .where(and(eq(valuationAnalyses.id, current.id), eq(valuationAnalyses.companyId, a.companyId), eq(valuationAnalyses.revision, input.revision))).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'import_personnel', entity: 'valuation_analysis', entityId: current.id,
      before: { revision: current.revision, c72: analysis.real.c72 ?? null }, after: { revision: row!.revision, year, months } });
    return c.json({ analysis: row, year, months });
  });

  app.get('/v1/valuation/members', requireRole(), async (c) => {
    const db = getDb(), companyId = c.get('actor').companyId;
    return c.json(await db.select({ userId: valuationMembers.userId, permission: valuationMembers.permission, enabled: valuationMembers.enabled, name: users.name, role: users.role })
      .from(valuationMembers).innerJoin(users, eq(users.id, valuationMembers.userId)).where(eq(valuationMembers.companyId, companyId)));
  });
  app.put('/v1/valuation/members/:userId', requireRole(), async (c) => {
    const a = c.get('actor'), db = getDb();
    const input = z.object({ enabled: z.boolean(), permission: z.enum(['editor', 'viewer']).default('editor') }).parse(await body(c));
    const userId = c.req.param('userId');
    if (userId === a.actorId && (!input.enabled || input.permission !== 'editor')) throw new DomainError('proprio_acesso', 'Não pode retirar o seu próprio acesso de gestão.', 409);
    await lockValuationCompany(db, a.companyId);
    const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, a.companyId)));
    if (!user || user.disabledAt) throw new DomainError('nao_encontrado', 'Utilizador activo inexistente nesta empresa.', 404);
    const [before] = await db.select().from(valuationMembers).where(and(eq(valuationMembers.companyId, a.companyId), eq(valuationMembers.userId, userId)));
    if (input.enabled && !before?.enabled && !(await valuationUsage(db, a.companyId)).canAddUser) throw new DomainError('limite_utilizadores', 'O plano do Valora inclui cinco utilizadores. Acrescente utilizadores extra em Módulos e licenças.', 409);
    const values = { enabled: input.enabled, permission: input.permission };
    const [member] = await db.insert(valuationMembers).values({ ...values, userId, companyId: a.companyId, addedBy: a.actorId })
      .onConflictDoUpdate({ target: [valuationMembers.companyId, valuationMembers.userId], set: values }).returning();
    await db.insert(auditLogs).values({ companyId: a.companyId, actorId: a.actorId, action: 'change_access', entity: 'valuation_member', entityId: member!.id, before: before ?? null, after: member });
    return c.json(member);
  });
  return app;
}
