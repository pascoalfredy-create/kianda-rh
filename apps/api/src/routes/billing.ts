import { modelingUsage, requireModelingPlanUsage, validateModelingSectors } from '../services/modeling-policy.js';
import { storageMode } from '../services/storage.js';
import { CYCLES, cyclePrice, DEFAULT_TIERS, FINANCIAL_SECTORS, MODELING_PLANS, MODELING_EXTRA_USER_MONTHLY_MINOR, defaultModelingSector, modelingPlanPrice, luandaDate, periodEnd, SECTORS, type BillingCycle, type FinancialSector } from '@kianda/core';
import {
  and, auditLogs, companyModules, companies, desc, employees, eq, ne, files, gatewayEvents, getDb, like, outboundEmails, paymentRequests, platformAdmins, platformSettings, sql, subscriptions, users, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { isPlatformAdmin, licenceOf, platformSettingsGet, priceTable, tierOf, type PlatformSettings } from '../services/licence.js';
import {
  afterPayment, applyGatewayPayment, attachGatewayReference, confirmPaymentRequest, emailPaymentInstructions, invoiceSettingsGet, issueInvoice,
  releaseGatewayReference, syncGatewayPayments,
} from '../services/billing.js';
import {
  acknowledgePayment, integrationStatus, mockPayment, parseWebhookPayment, proxypayConfig, vendusConfig, vendusInvoicePdf, verifyWebhookSignature,
} from '../services/integrations.js';
import { dailyReminders } from '../services/jobs.js';
import { exportCompany, purgeCompany } from '../services/privacy.js';
import { companyModulesOverview } from '../services/modules.js';

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

async function nextNumber(db: Db) {
  // Contagem global (função SECURITY DEFINER): o RLS só deixa a empresa ver os seus pedidos.
  const year = luandaDate(new Date()).slice(0, 4);
  const r = await db.execute(sql`select kianda_next_payment_number(${year}) as n`);
  return String((r.rows[0] as { n: string }).n);
}

/** Licença da empresa (proprietário e Finanças): estado, escalões, pedidos de pagamento e logotipo. */
export function billingRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/billing', '/v1/billing/*', '/v1/company/branding', '/v1/company/logo']) app.use(p, requireCompany);

  app.get('/v1/billing', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const l = await licenceOf(db, actor.companyId);
    const settings = await platformSettingsGet(db);
    const modules = await companyModulesOverview(db, actor.companyId, actor.actorId, actor.role);
    const requests = await db.select().from(paymentRequests).where(eq(paymentRequests.companyId, actor.companyId)).orderBy(desc(paymentRequests.createdAt)).limit(50);
    return c.json({
      status: l.status, statusLabel: l.statusLabel, canWrite: l.canWrite, tier: l.tier, cycle: l.cycle, limit: l.limit, activeEmployees: l.activeEmployees,
      trialEndsAt: l.sub?.trialEndsAt ?? null, paidUntil: l.sub?.paidUntil ?? null,
      prices: [...priceTable(), ...(l.tier.key === 'custom' ? [{ ...l.tier, prices: Object.fromEntries((Object.keys(CYCLES) as BillingCycle[]).map(cycle => [cycle, cyclePrice(l.tier, cycle)])) }] : [])], cycles: CYCLES, bank: settings.bank, supportEmail: settings.supportEmail, supportPhone: settings.supportPhone, requests,
      modules, modelingPlans: MODELING_PLANS, modelingExtraUserMinor: MODELING_EXTRA_USER_MONTHLY_MINOR, modelingUsage: await modelingUsage(db, actor.companyId),
      multicaixa: !!proxypayConfig(), invoicesOnline: !!vendusConfig(),
    });
  });

  /** Pedido de pagamento (pró-forma): plano RH ou Modelagem, com preço calculado no servidor. */
  app.post('/v1/billing/requests', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('subscription'), tierKey: z.string(), cycle: z.enum(['monthly', 'semiannual', 'annual']) }),
      z.object({ kind: z.literal('modeling_subscription'), planKey: z.enum(MODELING_PLANS.map(p => p.key) as [string, ...string[]]), cycle: z.enum(['monthly', 'semiannual', 'annual']), extraUsers: z.number().int().min(0).max(100_000).default(0), sectors: z.array(z.enum(FINANCIAL_SECTORS)).min(1).max(8) }),
    ]).parse(await body(c));
    const db = getDb();
    await db.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const l = await licenceOf(db, actor.companyId);
    const today = luandaDate(new Date());
    let values: Partial<typeof paymentRequests.$inferInsert>;
    if (b.kind === 'modeling_subscription') {
      const plan = MODELING_PLANS.find(p => p.key === b.planKey)!;
      const price = modelingPlanPrice(plan.key, b.cycle, b.extraUsers);
      if (!price) throw new DomainError('ciclo_indisponivel', 'O plano ilimitado só está disponível com pagamento semestral ou anual.', 400);
      const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, actor.companyId), eq(companyModules.module, 'modeling')));
      const [company] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, actor.companyId));
      const primarySector = grant?.primarySector as FinancialSector || defaultModelingSector(company?.sector);
      const sectors = validateModelingSectors(plan.key, primarySector, b.sectors);
      await requireModelingPlanUsage(db, actor.companyId, { projectLimit: plan.projectLimit, extraUsers: b.extraUsers, sectors });
      const after = [grant?.paidUntil, grant?.status === 'trial' ? grant.trialEndsAt : null].filter((d): d is string => !!d && d >= today).sort().at(-1);
      const start = after ? addDays(after, 1) : today;
      values = { kind: b.kind, tierKey: plan.key, cycle: b.cycle, projectLimit: plan.projectLimit, extraUsers: b.extraUsers, primarySector, modelingSectors: sectors, periodStart: start, periodEnd: periodEnd(start, CYCLES[b.cycle].months), grossMinor: price.grossMinor, discountMinor: price.discountMinor, amountMinor: price.totalMinor };
    } else {
      const tier = b.tierKey === l.sub?.tierKey ? l.tier : DEFAULT_TIERS.find((t) => t.key === b.tierKey);
      if (!tier) throw new DomainError('escalao_invalido', 'Escalão inexistente', 400);
      if (tier.maxEmployees !== null && l.activeEmployees > tier.maxEmployees) throw new DomainError('escalao_pequeno', `Tem ${l.activeEmployees} colaboradores activos: escolha um escalão maior`, 400);
      const price = cyclePrice(tier, b.cycle as BillingCycle);
      if (!price) throw new DomainError('sob_consulta', 'Este escalão é sob consulta: contacte o suporte Kianda para uma proposta', 400);
      // O período pago começa depois do que já está pago — ou do fim do experimental (o cliente não perde dias grátis).
      const after = [l.sub?.paidUntil, l.status === 'trial' ? l.sub?.trialEndsAt : null].filter((d): d is string => Boolean(d) && d! >= today).sort().at(-1);
      const start = after ? addDays(after, 1) : today;
      values = { kind: 'subscription', tierKey: tier.key, cycle: b.cycle, periodStart: start, periodEnd: periodEnd(start, CYCLES[b.cycle as BillingCycle].months), grossMinor: price.grossMinor, discountMinor: price.discountMinor, amountMinor: price.totalMinor };
    }
    const replaced = await db.select().from(paymentRequests).where(and(eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.kind, values.kind!), eq(paymentRequests.status, 'pending')));
    const created = await db.transaction(async (tx) => {
      await tx.update(paymentRequests).set({ status: 'cancelled' }).where(and(eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.kind, values.kind!), eq(paymentRequests.status, 'pending')));
      const [x] = await tx.insert(paymentRequests).values({ ...values, companyId: actor.companyId, number: await nextNumber(tx), createdBy: actor.actorId } as typeof paymentRequests.$inferInsert).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'payment_request', entityId: x!.id, after: x });
      return x!;
    });
    // Referência Multicaixa (se configurado) e instruções por email; o pedido anterior deixa de poder ser pago.
    for (const old of replaced) await releaseGatewayReference(old);
    const r = await attachGatewayReference(db, created);
    await emailPaymentInstructions(db, r);
    return c.json(r, 201);
  });

  /** Nova referência Multicaixa para um pedido pendente (expirada ou com erro do gateway). */
  app.post('/v1/billing/requests/:id/multicaixa', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    if (!proxypayConfig()) throw new DomainError('sem_multicaixa', 'O pagamento por referência Multicaixa ainda não está disponível', 400);
    const [r] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.status, 'pending'), ne(paymentRequests.kind, 'extra_seats')));
    if (!r) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    await releaseGatewayReference(r);
    const u = await attachGatewayReference(db, r);
    if (!u.gatewayReference || u.gatewayError) throw new DomainError('gateway_indisponivel', 'Não foi possível gerar a referência agora. Tente mais tarde ou pague por transferência.', 502);
    await emailPaymentInstructions(db, u);
    return c.json(u);
  });

  /** PDF da factura certificada (Vendus), pela API do Kianda. */
  app.get('/v1/billing/requests/:id/invoice', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const [r] = await getDb().select().from(paymentRequests).where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId)));
    const cfg = vendusConfig();
    if (!r?.invoiceExternalId || r.invoiceProvider !== 'vendus' || !cfg) throw new DomainError('sem_pdf', 'A factura deste pedido não está disponível em PDF no Kianda', 404);
    const pdf = await vendusInvoicePdf(cfg, r.invoiceExternalId);
    return new Response(pdf.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Factura-${(r.invoiceRef ?? r.number).replace(/[^\w.-]+/g, '_')}.pdf"` } });
  });

  /** O cliente indica a referência da transferência (a validação é feita pela Kianda). */
  app.post('/v1/billing/requests/:id/reference', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ payerReference: z.string().trim().min(3, 'Indique a referência da transferência').max(80), payerNote: z.string().trim().max(500).optional().nullable() }).parse(await body(c));
    const [u] = await getDb().update(paymentRequests).set({ payerReference: b.payerReference, payerNote: b.payerNote ?? null })
      .where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.status, 'pending'), ne(paymentRequests.kind, 'extra_seats'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  app.post('/v1/billing/requests/:id/cancel', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const [u] = await getDb().update(paymentRequests).set({ status: 'cancelled' })
      .where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    await releaseGatewayReference(u);
    return c.json(u);
  });

  /** Papel timbrado: nome, NIF, morada e logotipo (todos os perfis, para recibos e documentos). */
  app.get('/v1/company/branding', async (c) => {
    const [co] = await getDb().select({ name: companies.name, nif: companies.nif, address: companies.address, logo: companies.logoDataUrl }).from(companies).where(eq(companies.id, c.get('actor').companyId));
    return c.json(co ?? null);
  });

  app.put('/v1/company/logo', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const { dataUrl } = z.object({ dataUrl: z.string().max(420_000, 'Logotipo demasiado grande (máx. 300 KB)') }).parse(await body(c));
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new DomainError('formato_invalido', 'Use uma imagem PNG ou JPEG', 400);
    if (m[2]!.length * 0.75 > 300_000) throw new DomainError('demasiado_grande', 'Logotipo demasiado grande (máx. 300 KB)', 400);
    await getDb().update(companies).set({ logoDataUrl: dataUrl }).where(eq(companies.id, actor.companyId));
    await getDb().insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'company_logo', entityId: actor.companyId });
    return c.json({ ok: true });
  });

  app.delete('/v1/company/logo', requireRole('hr_admin'), async (c) => {
    await getDb().update(companies).set({ logoDataUrl: null }).where(eq(companies.id, c.get('actor').companyId));
    return c.json({ ok: true });
  });

  return app;
}

/** Consola da plataforma (administradores Kianda): empresas, licenças, pagamentos e parâmetros comerciais. */
export function platformRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/platform/*', requireCompany);
  app.use('/v1/platform/*', async (c, next) => {
    if (!(await isPlatformAdmin(getDb(), c.get('actor').actorId))) return c.json({ error: 'sem_permissao', message: 'Reservado à administração da plataforma Kianda.' }, 403);
    await next();
  });

  app.put('/v1/platform/companies/:id/modules/:module', async (c) => {
    const module = z.enum(['hr', 'modeling']).parse(c.req.param('module'));
    const input = z.object({ enabled: z.boolean(), status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).default('trial'), trialEndsAt: z.iso.date().nullable().default(null), paidUntil: z.iso.date().nullable().default(null), projectLimit: z.number().int().min(1).max(100000).nullable().optional(), extraUsers: z.number().int().min(0).max(100000).optional(), planKey: z.enum(MODELING_PLANS.map(p => p.key) as [string, ...string[]]).nullable().optional(), cycle: z.enum(['monthly', 'semiannual', 'annual']).nullable().optional(), primarySector: z.enum(FINANCIAL_SECTORS).nullable().optional(), modelingSectors: z.array(z.enum(FINANCIAL_SECTORS)).min(1).max(8).optional() }).parse(await body(c));
    if (module === 'modeling' && input.enabled && ['active', 'past_due'].includes(input.status) && !input.paidUntil) throw new DomainError('periodo_obrigatorio', 'Indique o fim do período pago.', 400);
    if (module === 'modeling' && input.enabled && input.status === 'trial' && !input.trialEndsAt) throw new DomainError('periodo_obrigatorio', 'Indique o fim do período experimental.', 400);
    const companyId = c.req.param('id');
    return getDb().transaction(async (db) => {
    const [company] = await db.select({ id: companies.id, sector: companies.sector }).from(companies).where(eq(companies.id, companyId)).for('update');
    if (!company) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
    const [before] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, module)));
    let values: Partial<typeof companyModules.$inferInsert> = module === 'hr' ? { enabled: input.enabled, status: 'trial', trialEndsAt: null, paidUntil: null } : input;
    // A activação de acessos extra e da quota é uma decisão comercial explícita da plataforma.
    if (module === 'modeling') {
      const projectLimit = input.projectLimit === undefined ? before ? before.projectLimit : 1 : input.projectLimit;
      const primarySector = input.primarySector ?? before?.primarySector as FinancialSector ?? defaultModelingSector(company.sector);
      const planKey = input.planKey === undefined ? before?.planKey : input.planKey;
      const sectors = input.modelingSectors ?? (before?.modelingSectors.length ? before.modelingSectors : [...FINANCIAL_SECTORS]);
      if (planKey) validateModelingSectors(planKey, primarySector, sectors);
      await requireModelingPlanUsage(db, companyId, { projectLimit, extraUsers: input.extraUsers ?? before?.extraUsers ?? 0, sectors });
      values = { ...input, primarySector, modelingSectors: sectors };
    }
    const [grant] = await db.insert(companyModules).values({ companyId, module, ...values }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { ...values, updatedAt: new Date() } }).returning();
    await db.insert(auditLogs).values({ companyId, actorId: c.get('actor').actorId, action: 'module_subscription', entity: 'company_module', entityId: grant!.id, before: before ?? null, after: grant });
    return c.json(grant);
    });
  });

  app.get('/v1/platform/companies', async (c) => {
    const db = getDb();
    const cos = (await db.select().from(companies).orderBy(desc(companies.createdAt))).filter((co) => co.nif !== 'PLATAFORMA');
    const subs = await db.select().from(subscriptions);
    const counts = await db.select({ companyId: employees.companyId, n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.status, 'active')).groupBy(employees.companyId);
    const owners = await db.select({ id: users.id, companyId: users.companyId, email: users.email, name: users.name }).from(users).where(eq(users.role, 'owner'));
    const pending = await db.select({ companyId: paymentRequests.companyId, n: sql<number>`count(*)::int` }).from(paymentRequests).where(eq(paymentRequests.status, 'pending')).groupBy(paymentRequests.companyId);
    const out = [];
    for (const co of cos) {
      const l = await licenceOf(db, co.id);
      const sub = subs.find((s) => s.companyId === co.id);
      const monthly = sub ? tierOf(sub).monthlyMinor : null;
      const owner = owners.find(o => o.companyId === co.id);
      const modules = await companyModulesOverview(db, co.id, owner?.id ?? '', 'owner');
      const modelingPrice = modules.modeling.planKey && modules.modeling.cycle ? modelingPlanPrice(modules.modeling.planKey, modules.modeling.cycle as BillingCycle, modules.modeling.extraUsers) : null;
      const modelingMrr = modules.modeling.canWrite && ['active', 'past_due'].includes(modules.modeling.status) && modules.modeling.paidUntil && modules.modeling.paidUntil < '2099-01-01' && modelingPrice ? Math.round(modelingPrice.totalMinor / CYCLES[modules.modeling.cycle as BillingCycle].months) : 0;
      out.push({
        id: co.id, name: co.name, nif: co.nif, sector: co.sector, sectorLabel: co.sector ? SECTORS[co.sector as keyof typeof SECTORS] ?? co.sector : null, code: co.code, createdAt: co.createdAt,
        owner: owner ?? null, activeEmployees: counts.find((x) => x.companyId === co.id)?.n ?? 0, modules, modelingMrr,
        status: l.status, statusLabel: l.statusLabel, tierKey: sub?.tierKey ?? null, tierLabel: l.tier.label, cycle: sub?.cycle ?? null, limit: l.limit,
        trialEndsAt: sub?.trialEndsAt ?? null, paidUntil: sub?.paidUntil ?? null, notes: sub?.notes ?? null,
        monthlyMinor: modules.hr.subscribed && (l.status === 'active' || l.status === 'past_due') ? monthly : null, pendingPayments: pending.find((p) => p.companyId === co.id)?.n ?? 0,
      });
    }
    const mrr = out.reduce((s, x) => s + (x.paidUntil && x.paidUntil < '2099-01-01' ? x.monthlyMinor ?? 0 : 0) + x.modelingMrr, 0);
    return c.json({ companies: out, summary: { total: out.length, trial: out.filter((x) => x.status === 'trial').length, active: out.filter((x) => x.status === 'active').length, pastDue: out.filter((x) => x.status === 'past_due').length, suspended: out.filter((x) => x.status === 'suspended').length, mrrMinor: mrr } });
  });

  app.get('/v1/platform/payment-requests', async (c) => {
    const status = z.enum(['pending', 'paid', 'cancelled', 'all']).default('pending').parse(c.req.query('status') ?? undefined);
    const db = getDb();
    const rows = await db.select({ r: paymentRequests, company: companies.name, nif: companies.nif }).from(paymentRequests).innerJoin(companies, eq(companies.id, paymentRequests.companyId))
      .where(status === 'all' ? undefined : eq(paymentRequests.status, status)).orderBy(desc(paymentRequests.createdAt)).limit(300);
    return c.json(rows.map(({ r, company, nif }) => ({ ...r, company, nif })));
  });

  /** Confirmar o pagamento: activa o período do módulo contratado. */
  app.post('/v1/platform/payment-requests/:id/confirm', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ invoiceRef: z.string().trim().max(80).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const r = await confirmPaymentRequest(db, c.req.param('id'), { actorId: actor.actorId, via: 'manual', invoiceRef: b.invoiceRef ?? null });
    await releaseGatewayReference(r);
    return c.json(await afterPayment(db, r.id));
  });

  /** Emitir (ou voltar a tentar) a factura certificada no Vendus. */
  app.post('/v1/platform/payment-requests/:id/invoice', async (c) => {
    if (!vendusConfig()) throw new DomainError('sem_vendus', 'O Vendus não está configurado (VENDUS_API_KEY)', 400);
    const r = await issueInvoice(getDb(), c.req.param('id'), true);
    if (r.invoiceError && !r.invoiceRef) throw new DomainError('factura_falhou', r.invoiceError, 502);
    return c.json(r);
  });

  /** Integrações: estado (sem segredos), parâmetros de facturação, eventos do gateway e emails recentes. */
  app.get('/v1/platform/integrations', async (c) => {
    const db = getDb();
    const events = await db.select().from(gatewayEvents).orderBy(desc(gatewayEvents.createdAt)).limit(30);
    const emails = await db.select().from(outboundEmails).orderBy(desc(outboundEmails.createdAt)).limit(30);
    const invoiceIssues = await db.select({ id: paymentRequests.id, number: paymentRequests.number, error: paymentRequests.invoiceError, company: companies.name })
      .from(paymentRequests).innerJoin(companies, eq(companies.id, paymentRequests.companyId))
      .where(and(eq(paymentRequests.status, 'paid'), sql`${paymentRequests.invoiceRef} is null`)).orderBy(desc(paymentRequests.paidAt)).limit(50);
    const [used] = await db.select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` }).from(files);
    return c.json({ status: { ...integrationStatus(), files: { mode: storageMode(), count: used?.n ?? 0, bytes: Number(used?.bytes ?? 0) } }, invoicing: await invoiceSettingsGet(db), events, emails, invoiceIssues });
  });

  app.put('/v1/platform/invoicing', async (c) => {
    const b = z.object({
      autoIssue: z.boolean(), taxId: z.enum(['NOR', 'ISE']),
      exemptionCode: z.string().trim().max(10).nullable(), exemptionLaw: z.string().trim().max(200).nullable(),
      paymentMethodId: z.number().int().positive().nullable(), registerId: z.number().int().positive().nullable(),
    }).refine((x) => x.taxId !== 'ISE' || (x.exemptionCode && x.exemptionLaw), { message: 'Isenção: indique o código e o fundamento legal', path: ['exemptionCode'] }).parse(await body(c));
    await getDb().insert(platformSettings).values({ key: 'invoicing', value: b }).onConflictDoUpdate({ target: platformSettings.key, set: { value: b, updatedAt: new Date() } });
    return c.json(b);
  });

  app.post('/v1/platform/gateway/sync', async (c) => c.json(await syncGatewayPayments(getDb())));

  /** Ambiente de testes do ProxyPay: simula o pagamento da referência de um pedido. */
  app.post('/v1/platform/gateway/mock', async (c) => {
    const cfg = proxypayConfig();
    if (!cfg || cfg.environment !== 'sandbox') throw new DomainError('so_testes', 'Só disponível com o ProxyPay em ambiente de testes (sandbox)', 400);
    const { requestId } = z.object({ requestId: z.string() }).parse(await body(c));
    const [r] = await getDb().select().from(paymentRequests).where(eq(paymentRequests.id, requestId));
    if (!r?.gatewayReference) throw new DomainError('sem_referencia', 'O pedido não tem referência Multicaixa', 400);
    await mockPayment(cfg, r.gatewayReference, r.amountMinor);
    return c.json({ ok: true });
  });

  app.post('/v1/platform/jobs/reminders', async (c) => c.json(await dailyReminders(getDb(), luandaDate(new Date()))));

  app.post('/v1/platform/payment-requests/:id/cancel', async (c) => {
    const [u] = await getDb().update(paymentRequests).set({ status: 'cancelled' }).where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    await releaseGatewayReference(u);
    return c.json(u);
  });

  /** Ajustes manuais à licença (suspender, prolongar experimental, contratos anteriores à medida). */
  app.patch('/v1/platform/companies/:id/subscription', async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(), tierKey: z.enum(['custom', ...DEFAULT_TIERS.map((t) => t.key)]).optional(),
      cycle: z.enum(['monthly', 'semiannual', 'annual']).optional(), trialEndsAt: z.iso.date().nullable().optional(), paidUntil: z.iso.date().nullable().optional(),
      extraSeats: z.never().optional(), customMaxEmployees: z.number().int().min(1).nullable().optional(),
      customMonthlyMinor: z.number().int().min(0).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(),
    }).parse(await body(c));
    const db = getDb();
    const id = c.req.param('id');
    const [before] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, id));
    const [u] = before
      ? await db.update(subscriptions).set({ ...b, updatedAt: new Date() }).where(eq(subscriptions.companyId, id)).returning()
      : await db.insert(subscriptions).values({ companyId: id, ...b }).returning();
    await db.insert(auditLogs).values({ companyId: id, actorId: actor.actorId, action: 'platform_update', entity: 'subscription', entityId: id, before: before ?? null, after: u });
    return c.json(u);
  });

  /** Exportação dos dados de uma empresa (ex.: entregar ao cliente antes de eliminar a conta). */
  app.get('/v1/platform/companies/:id/export', async (c) => {
    const data = await exportCompany(getDb(), c.req.param('id'));
    if (!data.company) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
    return new Response(JSON.stringify(data, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="kianda-export-${String((data.company as { nif: string }).nif)}.json"` } });
  });

  /** Eliminação definitiva de uma empresa (Lei 22/11 / fim de contrato): só com a licença cancelada e o NIF confirmado. */
  app.post('/v1/platform/companies/:id/purge', async (c) => {
    const actor = c.get('actor');
    const { confirmNif } = z.object({ confirmNif: z.string().trim() }).parse(await body(c));
    const db = getDb();
    const id = c.req.param('id');
    const [co] = await db.select().from(companies).where(eq(companies.id, id));
    if (!co) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
    if (co.nif === 'PLATAFORMA' || co.id === actor.companyId) throw new DomainError('protegida', 'Esta empresa não pode ser eliminada');
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, id));
    if (sub?.status !== 'cancelled') throw new DomainError('nao_cancelada', 'Cancele primeiro a licença da empresa (e entregue a exportação dos dados ao cliente)');
    const [modeling] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, id), eq(companyModules.module, 'modeling')));
    if (modeling?.enabled && modeling.status !== 'cancelled') throw new DomainError('nao_cancelada', 'Cancele também a licença de Modelagem antes de eliminar a empresa.');
    if (confirmNif !== co.nif) throw new DomainError('confirmacao', 'Para confirmar, escreva o NIF da empresa', 422);
    const deleted = await purgeCompany(db, id);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'purge_company', entity: 'company', entityId: id, after: { name: co.name, nif: co.nif, deleted } });
    return c.json({ ok: true, deleted });
  });

  app.get('/v1/platform/settings', async (c) => c.json({ ...(await platformSettingsGet(getDb())), admins: (await getDb().select().from(platformAdmins)).map((a) => a.email) }));

  app.put('/v1/platform/settings', async (c) => {
    const b = z.object({
      extraSeatMinor: z.never().optional(),
      bank: z.object({ holder: z.string().trim().min(2), bankName: z.string().trim().min(2), iban: z.string().trim().min(10) }).nullable(),
      supportEmail: z.email('Email de suporte inválido').nullable().or(z.literal('').transform(() => null)),
      supportPhone: z.string().trim().max(30).nullable().or(z.literal('').transform(() => null)),
    }).parse(await body(c)) satisfies PlatformSettings;
    await getDb().insert(platformSettings).values({ key: 'commercial', value: b }).onConflictDoUpdate({ target: platformSettings.key, set: { value: b, updatedAt: new Date() } });
    return c.json(b);
  });

  return app;
}

/** Webhook do ProxyPay (público, via /api da web): assinatura HMAC obrigatória; responde 200 a duplicados. */
export function gatewayWebhookRoutes() {
  const app = new Hono<AppEnv>();
  app.post('/v1/public/gateway/proxypay', async (c) => {
    const cfg = proxypayConfig();
    if (!cfg) return c.json({ error: 'nao_configurado' }, 404);
    const raw = await c.req.text();
    if (!(await verifyWebhookSignature(cfg, raw, c.req.header('x-signature')))) return c.json({ error: 'assinatura_invalida' }, 401);
    let payment;
    try { payment = parseWebhookPayment(raw); } catch { return c.json({ error: 'corpo_invalido' }, 400); }
    const r = await applyGatewayPayment(getDb(), payment);
    // Reconhece o pagamento no ProxyPay (a sincronização também o faria; aqui evita trabalho repetido).
    await acknowledgePayment(cfg, payment.id).catch(() => undefined);
    return c.json({ ok: true, outcome: r.outcome });
  });
  return app;
}
