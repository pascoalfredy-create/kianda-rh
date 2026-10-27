import { CYCLES, DEFAULT_TIERS, formatKz, luandaDate, type BillingCycle } from '@kianda/core';
import {
  and, auditLogs, companies, desc, eq, gatewayEvents, inArray, isNull, paymentRequests, platformAdmins, platformSettings, subscriptions, users, type Db,
} from '@kianda/db';
import {
  acknowledgePayment, appBaseUrl, createReference, deleteReference, pendingPayments, proxypayConfig, vendusConfig, vendusIssueInvoice,
  type GatewayPayment, type InvoiceSettings,
} from './integrations.js';
import { platformSettingsGet } from './licence.js';
import { sendMail } from './mail.js';
import { DomainError } from './payroll.js';

type Request = typeof paymentRequests.$inferSelect;
const pt = (d: string) => d.split('-').reverse().join('/');
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
/** Validade da referência Multicaixa. */
export const REFERENCE_DAYS = 10;

const DEFAULT_INVOICE: InvoiceSettings = { taxId: 'NOR', exemptionCode: null, exemptionLaw: null, paymentMethodId: null, registerId: null };
export async function invoiceSettingsGet(db: Pick<Db, 'select'>): Promise<InvoiceSettings & { autoIssue: boolean }> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'invoicing'));
  return { ...DEFAULT_INVOICE, autoIssue: false, ...((row?.value as Partial<InvoiceSettings & { autoIssue: boolean }>) ?? {}) };
}

/** Descrição do que se paga (pró-forma, email e factura). */
export function requestDescription(r: Request) {
  if (r.kind === 'subscription') {
    const tier = DEFAULT_TIERS.find((t) => t.key === r.tierKey)?.label ?? r.tierKey;
    return `Licença Kianda RH — ${tier} — ${CYCLES[r.cycle as BillingCycle]?.label ?? r.cycle} (${pt(r.periodStart!)} a ${pt(r.periodEnd!)})`;
  }
  return `Kianda RH — ${r.seats} colaborador(es) adicional(is), pagamento único`;
}

/** Quem recebe os emails de cobrança da empresa: proprietário e Finanças com email e acesso activo. */
async function billingContacts(db: Pick<Db, 'select'>, companyId: string) {
  const rows = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.companyId, companyId), inArray(users.role, ['owner', 'finance']), isNull(users.disabledAt)));
  return [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
}

/** Gera a referência Multicaixa do pedido (se o ProxyPay estiver configurado). Um erro do gateway não impede o pedido. */
export async function attachGatewayReference(db: Db, r: Request): Promise<Request> {
  const cfg = proxypayConfig();
  if (!cfg) return r;
  const [co] = await db.select({ nif: companies.nif }).from(companies).where(eq(companies.id, r.companyId));
  const until = addDays(luandaDate(new Date()), REFERENCE_DAYS);
  try {
    const ref = await createReference(cfg, r.amountMinor, until, { pedido: r.number, nif: co?.nif ?? '' });
    const [u] = await db.update(paymentRequests).set({ gateway: 'proxypay', gatewayEntity: ref.entity, gatewayReference: ref.reference, gatewayExpiresAt: until, gatewayError: null })
      .where(eq(paymentRequests.id, r.id)).returning();
    return u!;
  } catch (e) {
    const [u] = await db.update(paymentRequests).set({ gatewayError: String((e as Error).message).slice(0, 500) }).where(eq(paymentRequests.id, r.id)).returning();
    return u!;
  }
}

/** Anula a referência no gateway (pedido cancelado ou substituído) — melhor esforço. */
export async function releaseGatewayReference(r: Pick<Request, 'gateway' | 'gatewayReference'>) {
  const cfg = proxypayConfig();
  if (!cfg || r.gateway !== 'proxypay' || !r.gatewayReference) return;
  await deleteReference(cfg, r.gatewayReference).catch(() => undefined);
}

/** Email com as instruções de pagamento (referência Multicaixa e/ou transferência). */
export async function emailPaymentInstructions(db: Db, r: Request) {
  const settings = await platformSettingsGet(db);
  const facts: [string, string][] = [['Pedido', r.number], ['Montante', formatKz(r.amountMinor)]];
  if (r.gatewayReference) {
    if (r.gatewayEntity) facts.push(['Entidade', r.gatewayEntity]);
    facts.push(['Referência', r.gatewayReference.replace(/(\d{3})(?=\d)/g, '$1 ')], ['Válida até', pt(r.gatewayExpiresAt!)]);
  } else if (settings.bank) {
    facts.push(['Titular', settings.bank.holder], ['Banco', settings.bank.bankName], ['IBAN', settings.bank.iban], ['Descritivo', r.number]);
  }
  const base = appBaseUrl();
  for (const to of await billingContacts(db, r.companyId)) {
    await sendMail(db, {
      to, companyId: r.companyId, kind: 'pedido_pagamento', subject: `Kianda RH — pedido de pagamento ${r.number}`, title: 'Pedido de pagamento',
      paragraphs: [requestDescription(r), r.gatewayReference
        ? 'Pague no Multicaixa Express, num ATM ou no homebanking com "Pagamento por referência". A licença é activada automaticamente quando o pagamento for recebido.'
        : 'Faça a transferência com o descritivo indicado e registe a referência na página Licença. A activação é feita quando a Kianda confirmar a recepção.'],
      facts, button: base ? { label: 'Ver licença', url: `${base}/licenca` } : null, replyTo: settings.supportEmail,
    });
  }
}

/**
 * Confirma o pagamento: activa o período pago (ou soma os colaboradores extra). Idempotente pelo estado do pedido.
 * via = manual (consola) | gateway (Multicaixa).
 */
export async function confirmPaymentRequest(db: Db, id: string, o: { actorId: string; via: 'manual' | 'gateway'; invoiceRef?: string | null }) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, id)).for('update');
    if (!r || r.status !== 'pending') throw new DomainError('nao_encontrado', 'Pedido inexistente ou já tratado', 404);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, r.companyId));
    if (r.kind === 'subscription') {
      const values = { status: 'active', tierKey: r.tierKey!, cycle: r.cycle!, paidUntil: r.periodEnd!, updatedAt: new Date() };
      if (sub) await tx.update(subscriptions).set(values).where(eq(subscriptions.companyId, r.companyId));
      else await tx.insert(subscriptions).values({ companyId: r.companyId, ...values });
    } else {
      await tx.update(subscriptions).set({ extraSeats: (sub?.extraSeats ?? 0) + (r.seats ?? 0), updatedAt: new Date() }).where(eq(subscriptions.companyId, r.companyId));
    }
    const [x] = await tx.update(paymentRequests).set({ status: 'paid', paidAt: new Date(), confirmedBy: o.actorId, confirmedVia: o.via, invoiceRef: o.invoiceRef ?? null })
      .where(eq(paymentRequests.id, r.id)).returning();
    await tx.insert(auditLogs).values({ companyId: r.companyId, actorId: o.actorId, action: 'confirm_payment', entity: 'payment_request', entityId: r.id, after: { ...x, via: o.via } });
    return x!;
  });
}

/** Emite a factura certificada no Vendus (se configurado e sem n.º registado). Erros ficam no pedido para nova tentativa. */
export async function issueInvoice(db: Db, id: string, force = false): Promise<Request> {
  const [r] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id));
  if (!r) throw new DomainError('nao_encontrado', 'Pedido inexistente', 404);
  const cfg = vendusConfig();
  const settings = await invoiceSettingsGet(db);
  if (!cfg || r.status !== 'paid' || r.invoiceRef || (!force && !settings.autoIssue)) return r;
  const [co] = await db.select().from(companies).where(eq(companies.id, r.companyId));
  const [owner] = await billingContacts(db, r.companyId);
  try {
    const inv = await vendusIssueInvoice(cfg, settings, {
      number: r.number, client: { nif: co!.nif, name: co!.name, address: co!.address, email: owner ?? null },
      item: { reference: r.kind === 'subscription' ? `KIANDA-${(r.tierKey ?? '').toUpperCase()}` : 'KIANDA-EXTRA', title: requestDescription(r), amountMinor: r.amountMinor },
    });
    const [u] = await db.update(paymentRequests).set({ invoiceProvider: 'vendus', invoiceExternalId: inv.id, invoiceRef: inv.number, invoiceIssuedAt: new Date(), invoiceError: null })
      .where(eq(paymentRequests.id, r.id)).returning();
    return u!;
  } catch (e) {
    const [u] = await db.update(paymentRequests).set({ invoiceError: String((e as Error).message).slice(0, 500) }).where(eq(paymentRequests.id, r.id)).returning();
    return u!;
  }
}

/** Depois de pago: factura (se automática) e recibo por email ao cliente; aviso à administração da plataforma. */
export async function afterPayment(db: Db, id: string) {
  const r = await issueInvoice(db, id);
  const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, r.companyId));
  const settings = await platformSettingsGet(db);
  const base = appBaseUrl();
  const facts: [string, string][] = [['Pedido', r.number], ['Montante', formatKz(r.amountMinor)]];
  if (r.kind === 'subscription') facts.push(['Licença activa até', pt(r.periodEnd!)]);
  if (r.invoiceRef) facts.push(['Factura', r.invoiceRef]);
  for (const to of await billingContacts(db, r.companyId)) {
    await sendMail(db, {
      to, companyId: r.companyId, kind: 'pagamento_confirmado', dedupeKey: `paid:${r.id}:${to}`, subject: `Kianda RH — pagamento ${r.number} recebido`, title: 'Pagamento recebido',
      paragraphs: [`Obrigado. Recebemos o pagamento de ${requestDescription(r).toLowerCase().replace(/^licença/, 'licença')}.`, r.invoiceRef ? 'A factura certificada está disponível na página Licença.' : 'A factura certificada será disponibilizada na página Licença.'],
      facts, button: base ? { label: 'Ver licença', url: `${base}/licenca` } : null, replyTo: settings.supportEmail,
    });
  }
  for (const a of await db.select().from(platformAdmins)) {
    await sendMail(db, {
      to: a.email, kind: 'plataforma_pagamento', dedupeKey: `paid-admin:${r.id}:${a.email}`, subject: `Pagamento recebido — ${co?.name ?? ''} — ${formatKz(r.amountMinor)}`, title: 'Pagamento recebido',
      paragraphs: [`${co?.name ?? 'Empresa'}: ${requestDescription(r)}.`, r.confirmedVia === 'gateway' ? 'Confirmado automaticamente pelo Multicaixa.' : 'Confirmado manualmente na consola.', r.invoiceError ? `A factura não foi emitida: ${r.invoiceError}` : r.invoiceRef ? `Factura ${r.invoiceRef}.` : 'Factura por emitir.'],
      facts, button: base ? { label: 'Abrir consola', url: `${base}/plataforma` } : null,
    });
  }
  return r;
}

/**
 * Pagamento recebido do Multicaixa: regista o evento (uma vez por pagamento) e confirma o pedido da referência
 * se o montante bater certo e o pedido estiver pendente. Casos anómalos ficam na consola para revisão.
 */
export async function applyGatewayPayment(db: Db, p: GatewayPayment) {
  const [seen] = await db.select().from(gatewayEvents).where(and(eq(gatewayEvents.provider, 'proxypay'), eq(gatewayEvents.externalId, p.id)));
  if (seen) return { outcome: 'duplicate' as const, requestId: seen.paymentRequestId };
  // O ProxyPay pode reciclar n.ºs de referência expirados: vale o pedido pendente mais recente com essa referência.
  const candidates = p.reference ? await db.select().from(paymentRequests).where(and(eq(paymentRequests.gateway, 'proxypay'), eq(paymentRequests.gatewayReference, p.reference))).orderBy(desc(paymentRequests.createdAt)) : [];
  const r = candidates.find((x) => x.status === 'pending') ?? candidates[0];
  let outcome: 'applied' | 'unmatched' | 'amount_mismatch' | 'not_pending' = 'applied';
  let message: string | null = null;
  if (!r) { outcome = 'unmatched'; message = `Referência ${p.reference} sem pedido no Kianda`; }
  else if (r.status !== 'pending') { outcome = 'not_pending'; message = `Pedido ${r.number} já estava ${r.status === 'paid' ? 'pago' : 'cancelado'} — verificar e devolver se necessário`; }
  else if (p.amountMinor !== r.amountMinor) { outcome = 'amount_mismatch'; message = `Pago ${formatKz(p.amountMinor)}; o pedido ${r.number} é de ${formatKz(r.amountMinor)}`; }
  const inserted = await db.insert(gatewayEvents).values({
    provider: 'proxypay', externalId: p.id, reference: p.reference, amountMinor: p.amountMinor, payload: p.raw as object, outcome, paymentRequestId: r?.id ?? null, message,
  }).onConflictDoNothing().returning();
  if (!inserted.length) return { outcome: 'duplicate' as const, requestId: r?.id ?? null };
  if (outcome === 'applied') {
    await confirmPaymentRequest(db, r!.id, { actorId: 'gateway:proxypay', via: 'gateway' });
    await afterPayment(db, r!.id);
  }
  return { outcome, requestId: r?.id ?? null, message };
}

/** Rede de segurança do webhook: lê os pagamentos pendentes no ProxyPay, aplica-os e confirma a recepção. */
export async function syncGatewayPayments(db: Db) {
  const cfg = proxypayConfig();
  if (!cfg) return { enabled: false, processed: 0, applied: 0, issues: 0 };
  const list = await pendingPayments(cfg);
  let applied = 0;
  let issues = 0;
  for (const p of list) {
    const r = await applyGatewayPayment(db, p);
    if (r.outcome === 'applied') applied++;
    else if (r.outcome !== 'duplicate') issues++;
    await acknowledgePayment(cfg, p.id).catch(() => undefined);
  }
  return { enabled: true, processed: list.length, applied, issues };
}
