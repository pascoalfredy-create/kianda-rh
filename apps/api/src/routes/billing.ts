import { CYCLES, cyclePrice, DEFAULT_TIERS, luandaDate, periodEnd, SECTORS, type BillingCycle } from '@kianda/core';
import {
  and, auditLogs, companies, desc, employees, eq, getDb, like, paymentRequests, platformAdmins, platformSettings, sql, subscriptions, users, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { isPlatformAdmin, licenceOf, platformSettingsGet, priceTable, tierOf, type PlatformSettings } from '../services/licence.js';

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

async function nextNumber(db: Db) {
  const year = luandaDate(new Date()).slice(0, 4);
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(paymentRequests).where(like(paymentRequests.number, `PF-${year}-%`));
  return `PF-${year}-${String((n?.n ?? 0) + 1).padStart(4, '0')}`;
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
    const requests = await db.select().from(paymentRequests).where(eq(paymentRequests.companyId, actor.companyId)).orderBy(desc(paymentRequests.createdAt)).limit(50);
    return c.json({
      status: l.status, statusLabel: l.statusLabel, canWrite: l.canWrite, tier: l.tier, cycle: l.cycle, limit: l.limit, activeEmployees: l.activeEmployees,
      trialEndsAt: l.sub?.trialEndsAt ?? null, paidUntil: l.sub?.paidUntil ?? null, extraSeats: l.sub?.extraSeats ?? 0,
      prices: priceTable(), cycles: CYCLES, extraSeatMinor: settings.extraSeatMinor, bank: settings.bank, supportEmail: settings.supportEmail, supportPhone: settings.supportPhone, requests,
    });
  });

  /** Pedido de pagamento (pró-forma): renovação/mudança de escalão, ou colaboradores extra (pagamento único). */
  app.post('/v1/billing/requests', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('subscription'), tierKey: z.string(), cycle: z.enum(['monthly', 'semiannual', 'annual']) }),
      z.object({ kind: z.literal('extra_seats'), seats: z.number().int().min(1).max(5000) }),
    ]).parse(await body(c));
    const db = getDb();
    const l = await licenceOf(db, actor.companyId);
    const today = luandaDate(new Date());
    let values: Partial<typeof paymentRequests.$inferInsert>;
    if (b.kind === 'subscription') {
      const tier = b.tierKey === l.sub?.tierKey ? l.tier : DEFAULT_TIERS.find((t) => t.key === b.tierKey);
      if (!tier) throw new DomainError('escalao_invalido', 'Escalão inexistente', 400);
      if (tier.maxEmployees !== null && l.activeEmployees > tier.maxEmployees + (l.sub?.extraSeats ?? 0)) throw new DomainError('escalao_pequeno', `Tem ${l.activeEmployees} colaboradores activos: escolha um escalão maior`, 400);
      const price = cyclePrice(tier, b.cycle as BillingCycle);
      if (!price) throw new DomainError('sob_consulta', 'Este escalão é sob consulta: contacte o suporte Kianda para uma proposta', 400);
      // O período pago começa depois do que já está pago — ou do fim do experimental (o cliente não perde dias grátis).
      const after = [l.sub?.paidUntil, l.status === 'trial' ? l.sub?.trialEndsAt : null].filter((d): d is string => Boolean(d) && d! >= today).sort().at(-1);
      const start = after ? addDays(after, 1) : today;
      values = { kind: 'subscription', tierKey: tier.key, cycle: b.cycle, periodStart: start, periodEnd: periodEnd(start, CYCLES[b.cycle as BillingCycle].months), grossMinor: price.grossMinor, discountMinor: price.discountMinor, amountMinor: price.totalMinor };
    } else {
      const settings = await platformSettingsGet(db);
      if (!settings.extraSeatMinor) throw new DomainError('preco_por_definir', 'O valor por colaborador extra ainda não está definido: contacte o suporte Kianda', 400);
      if (l.tier.maxEmployees === null) throw new DomainError('sem_limite', 'O seu escalão não tem limite de colaboradores', 400);
      const amount = settings.extraSeatMinor * b.seats;
      values = { kind: 'extra_seats', seats: b.seats, grossMinor: amount, discountMinor: 0, amountMinor: amount };
    }
    const r = await db.transaction(async (tx) => {
      await tx.update(paymentRequests).set({ status: 'cancelled' }).where(and(eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.kind, values.kind!), eq(paymentRequests.status, 'pending')));
      const [x] = await tx.insert(paymentRequests).values({ ...values, companyId: actor.companyId, number: await nextNumber(db), createdBy: actor.actorId } as typeof paymentRequests.$inferInsert).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'payment_request', entityId: x!.id, after: x });
      return x!;
    });
    return c.json(r, 201);
  });

  /** O cliente indica a referência da transferência (a validação é feita pela Kianda). */
  app.post('/v1/billing/requests/:id/reference', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ payerReference: z.string().trim().min(3, 'Indique a referência da transferência').max(80), payerNote: z.string().trim().max(500).optional().nullable() }).parse(await body(c));
    const [u] = await getDb().update(paymentRequests).set({ payerReference: b.payerReference, payerNote: b.payerNote ?? null })
      .where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  app.post('/v1/billing/requests/:id/cancel', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const [u] = await getDb().update(paymentRequests).set({ status: 'cancelled' })
      .where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.companyId, actor.companyId), eq(paymentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
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

  app.get('/v1/platform/companies', async (c) => {
    const db = getDb();
    const cos = (await db.select().from(companies).orderBy(desc(companies.createdAt))).filter((co) => co.nif !== 'PLATAFORMA');
    const subs = await db.select().from(subscriptions);
    const counts = await db.select({ companyId: employees.companyId, n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.status, 'active')).groupBy(employees.companyId);
    const owners = await db.select({ companyId: users.companyId, email: users.email, name: users.name }).from(users).where(eq(users.role, 'owner'));
    const pending = await db.select({ companyId: paymentRequests.companyId, n: sql<number>`count(*)::int` }).from(paymentRequests).where(eq(paymentRequests.status, 'pending')).groupBy(paymentRequests.companyId);
    const out = [];
    for (const co of cos) {
      const l = await licenceOf(db, co.id);
      const sub = subs.find((s) => s.companyId === co.id);
      const monthly = sub ? tierOf(sub).monthlyMinor : null;
      out.push({
        id: co.id, name: co.name, nif: co.nif, sector: co.sector, sectorLabel: co.sector ? SECTORS[co.sector as keyof typeof SECTORS] ?? co.sector : null, code: co.code, createdAt: co.createdAt,
        owner: owners.find((o) => o.companyId === co.id) ?? null, activeEmployees: counts.find((x) => x.companyId === co.id)?.n ?? 0,
        status: l.status, statusLabel: l.statusLabel, tierKey: sub?.tierKey ?? null, tierLabel: l.tier.label, cycle: sub?.cycle ?? null, limit: l.limit,
        trialEndsAt: sub?.trialEndsAt ?? null, paidUntil: sub?.paidUntil ?? null, extraSeats: sub?.extraSeats ?? 0, notes: sub?.notes ?? null,
        monthlyMinor: l.status === 'active' || l.status === 'past_due' ? monthly : null, pendingPayments: pending.find((p) => p.companyId === co.id)?.n ?? 0,
      });
    }
    const mrr = out.filter((x) => x.paidUntil && x.paidUntil < '2099-01-01').reduce((s, x) => s + (x.monthlyMinor ?? 0), 0);
    return c.json({ companies: out, summary: { total: out.length, trial: out.filter((x) => x.status === 'trial').length, active: out.filter((x) => x.status === 'active').length, pastDue: out.filter((x) => x.status === 'past_due').length, suspended: out.filter((x) => x.status === 'suspended').length, mrrMinor: mrr } });
  });

  app.get('/v1/platform/payment-requests', async (c) => {
    const status = z.enum(['pending', 'paid', 'cancelled', 'all']).default('pending').parse(c.req.query('status') ?? undefined);
    const db = getDb();
    const rows = await db.select({ r: paymentRequests, company: companies.name, nif: companies.nif }).from(paymentRequests).innerJoin(companies, eq(companies.id, paymentRequests.companyId))
      .where(status === 'all' ? undefined : eq(paymentRequests.status, status)).orderBy(desc(paymentRequests.createdAt)).limit(300);
    return c.json(rows.map(({ r, company, nif }) => ({ ...r, company, nif })));
  });

  /** Confirmar o pagamento: activa o período (ou acrescenta os colaboradores extra). */
  app.post('/v1/platform/payment-requests/:id/confirm', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ invoiceRef: z.string().trim().max(80).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const [r] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, c.req.param('id')));
    if (!r || r.status !== 'pending') throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    const u = await db.transaction(async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, r.companyId));
      if (r.kind === 'subscription') {
        const values = { status: 'active', tierKey: r.tierKey!, cycle: r.cycle!, paidUntil: r.periodEnd!, updatedAt: new Date() };
        if (sub) await tx.update(subscriptions).set(values).where(eq(subscriptions.companyId, r.companyId));
        else await tx.insert(subscriptions).values({ companyId: r.companyId, ...values });
      } else {
        await tx.update(subscriptions).set({ extraSeats: (sub?.extraSeats ?? 0) + (r.seats ?? 0), updatedAt: new Date() }).where(eq(subscriptions.companyId, r.companyId));
      }
      const [x] = await tx.update(paymentRequests).set({ status: 'paid', paidAt: new Date(), confirmedBy: actor.actorId, invoiceRef: b.invoiceRef ?? null }).where(eq(paymentRequests.id, r.id)).returning();
      await tx.insert(auditLogs).values({ companyId: r.companyId, actorId: actor.actorId, action: 'confirm_payment', entity: 'payment_request', entityId: r.id, after: x });
      return x!;
    });
    return c.json(u);
  });

  app.post('/v1/platform/payment-requests/:id/cancel', async (c) => {
    const [u] = await getDb().update(paymentRequests).set({ status: 'cancelled' }).where(and(eq(paymentRequests.id, c.req.param('id')), eq(paymentRequests.status, 'pending'))).returning();
    if (!u) throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    return c.json(u);
  });

  /** Ajustes manuais à licença (suspender, prolongar experimental, escalão à medida, extras oferecidos). */
  app.patch('/v1/platform/companies/:id/subscription', async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(), tierKey: z.enum(DEFAULT_TIERS.map((t) => t.key) as [string, ...string[]]).optional(),
      cycle: z.enum(['monthly', 'semiannual', 'annual']).optional(), trialEndsAt: z.iso.date().nullable().optional(), paidUntil: z.iso.date().nullable().optional(),
      extraSeats: z.number().int().min(0).max(100_000).optional(), customMaxEmployees: z.number().int().min(1).nullable().optional(),
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

  app.get('/v1/platform/settings', async (c) => c.json({ ...(await platformSettingsGet(getDb())), admins: (await getDb().select().from(platformAdmins)).map((a) => a.email) }));

  app.put('/v1/platform/settings', async (c) => {
    const b = z.object({
      extraSeatMinor: z.number().int().min(0).nullable(),
      bank: z.object({ holder: z.string().trim().min(2), bankName: z.string().trim().min(2), iban: z.string().trim().min(10) }).nullable(),
      supportEmail: z.email('Email de suporte inválido').nullable().or(z.literal('').transform(() => null)),
      supportPhone: z.string().trim().max(30).nullable().or(z.literal('').transform(() => null)),
    }).parse(await body(c)) satisfies PlatformSettings;
    await getDb().insert(platformSettings).values({ key: 'commercial', value: b }).onConflictDoUpdate({ target: platformSettings.key, set: { value: b, updatedAt: new Date() } });
    return c.json(b);
  });

  return app;
}
