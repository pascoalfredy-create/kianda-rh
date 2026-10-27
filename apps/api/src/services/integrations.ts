/**
 * Integrações externas: Multicaixa (ProxyPay), email transaccional (Resend) e facturação certificada AGT (Cegid Vendus).
 *
 * Cada integração só fica activa quando a respectiva chave existe no ambiente (secrets do Worker). Sem chave, o Kianda
 * continua a funcionar como antes: transferência bancária com confirmação manual, ligações partilhadas à mão e
 * n.º da factura registado na consola.
 */

const env = (k: string) => (process.env[k] ?? '').trim() || null;

// ───────────────────────── Configuração ─────────────────────────

export function integrationStatus() {
  const pp = proxypayConfig();
  const mail = mailConfig();
  const vendus = vendusConfig();
  return {
    proxypay: { enabled: !!pp, environment: pp?.environment ?? null, entity: pp?.entity ?? null },
    email: { enabled: !!mail, from: mail?.from ?? null },
    vendus: { enabled: !!vendus, mode: vendus?.mode ?? null },
    baseUrl: appBaseUrl(),
  };
}

/** Endereço público da aplicação (para as ligações nos emails). */
export function appBaseUrl(): string | null {
  const explicit = env('APP_BASE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const host = env('KIANDA_HOSTNAME');
  return host ? `https://${host}` : null;
}

// ───────────────────────── ProxyPay (Multicaixa) ─────────────────────────

export interface ProxypayConfig { apiKey: string; environment: 'sandbox' | 'production'; entity: string | null; baseUrl: string }

export function proxypayConfig(): ProxypayConfig | null {
  const apiKey = env('PROXYPAY_API_KEY');
  if (!apiKey) return null;
  const environment = env('PROXYPAY_ENV') === 'production' ? 'production' : 'sandbox';
  return {
    apiKey, environment, entity: env('PROXYPAY_ENTITY'),
    baseUrl: env('PROXYPAY_BASE_URL') ?? (environment === 'production' ? 'https://api.proxypay.co.ao' : 'https://api.sandbox.proxypay.co.ao'),
  };
}

export class IntegrationError extends Error {
  constructor(public readonly provider: string, message: string, public readonly status?: number) { super(message); }
}

async function proxypay(cfg: ProxypayConfig, method: string, path: string, body?: unknown) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Token ${cfg.apiKey}`, Accept: 'application/vnd.proxypay.v2+json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new IntegrationError('proxypay', `ProxyPay respondeu ${res.status} em ${method} ${path}: ${(await res.text()).slice(0, 200)}`, res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const kzString = (minor: number) => (minor / 100).toFixed(2);
export const parseKzString = (v: string | number) => Math.round(Number(String(v).replace(',', '.')) * 100);

/** Gera uma referência Multicaixa para o montante, válida até à data indicada. */
export async function createReference(cfg: ProxypayConfig, amountMinor: number, endDate: string, customFields: Record<string, string>) {
  const id = String(await proxypay(cfg, 'POST', '/reference_ids'));
  if (!/^\d{6,15}$/.test(id)) throw new IntegrationError('proxypay', `Referência inválida devolvida pelo ProxyPay: ${id.slice(0, 40)}`);
  await proxypay(cfg, 'PUT', `/references/${id}`, { amount: kzString(amountMinor), end_datetime: endDate, custom_fields: customFields });
  return { reference: id, entity: cfg.entity };
}

export const deleteReference = (cfg: ProxypayConfig, reference: string) => proxypay(cfg, 'DELETE', `/references/${reference}`);

export interface GatewayPayment { id: string; reference: string; amountMinor: number; datetime: string | null; raw: unknown }

const toPayment = (p: Record<string, unknown>): GatewayPayment => ({
  id: String(p.id), reference: String(p.reference_id ?? p.reference ?? ''), amountMinor: parseKzString(p.amount as string), datetime: (p.datetime as string) ?? null, raw: p,
});

/** Pagamentos ainda não confirmados (reconhecidos) no ProxyPay. */
export async function pendingPayments(cfg: ProxypayConfig): Promise<GatewayPayment[]> {
  const list = (await proxypay(cfg, 'GET', '/payments')) as Record<string, unknown>[] | null;
  return (list ?? []).map(toPayment);
}

export const acknowledgePayment = (cfg: ProxypayConfig, id: string) => proxypay(cfg, 'DELETE', `/payments/${id}`);

/** Só no ambiente de testes: simula um pagamento como se viesse do Multicaixa. */
export const mockPayment = (cfg: ProxypayConfig, reference: string, amountMinor: number) =>
  proxypay(cfg, 'POST', '/payments', { amount: kzString(amountMinor), reference_id: Number(reference) });

export const parseWebhookPayment = (body: string): GatewayPayment => toPayment(JSON.parse(body) as Record<string, unknown>);

/** Assinatura do webhook: HMAC-SHA256 (hex) do corpo com a chave da API, no cabeçalho X-Signature. */
export async function verifyWebhookSignature(cfg: ProxypayConfig, body: string, signature: string | null | undefined): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacHex(cfg.apiKey, body);
  const a = signature.trim().toLowerCase();
  if (a.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(key: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────── Email (Resend) ─────────────────────────

export interface MailConfig { apiKey: string; from: string; baseUrl: string }

export function mailConfig(): MailConfig | null {
  const apiKey = env('RESEND_API_KEY');
  const from = env('MAIL_FROM');
  if (!apiKey || !from) return null;
  return { apiKey, from, baseUrl: env('RESEND_BASE_URL') ?? 'https://api.resend.com' };
}

export async function resendSend(cfg: MailConfig, m: { to: string; subject: string; html: string; text: string; replyTo?: string | null }) {
  const res = await fetch(`${cfg.baseUrl}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  if (!res.ok) throw new IntegrationError('resend', `Resend respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return j.id ?? null;
}

// ───────────────────────── Cegid Vendus (facturação certificada AGT) ─────────────────────────

export interface VendusConfig { apiKey: string; mode: 'tests' | 'normal'; baseUrl: string }

export function vendusConfig(): VendusConfig | null {
  const apiKey = env('VENDUS_API_KEY');
  if (!apiKey) return null;
  return { apiKey, mode: env('VENDUS_MODE') === 'normal' ? 'normal' : 'tests', baseUrl: env('VENDUS_BASE_URL') ?? 'https://www.vendus.co.ao/ws/v1.1' };
}

const vendusAuth = (cfg: VendusConfig) => `Basic ${btoa(`${cfg.apiKey}:`)}`;

export interface InvoiceSettings {
  /** Imposto da linha no Vendus: NOR (taxa normal) ou ISE (isento, com motivo). */
  taxId: 'NOR' | 'ISE';
  exemptionCode: string | null;
  exemptionLaw: string | null;
  /** Id do meio de pagamento no Vendus (ex.: "Multicaixa"/"Transferência"). */
  paymentMethodId: number | null;
  /** Id da caixa/POS no Vendus (opcional). */
  registerId: number | null;
}

export interface InvoiceInput {
  number: string;
  client: { nif: string; name: string; address: string | null; email: string | null };
  item: { reference: string; title: string; amountMinor: number };
}

/** Emite uma factura-recibo (FR) certificada. tx_id = n.º do pedido: repetir não duplica a factura. */
export async function vendusIssueInvoice(cfg: VendusConfig, settings: InvoiceSettings, i: InvoiceInput) {
  const body = {
    type: 'FR', mode: cfg.mode, tx_id: i.number, external_reference: i.number, ...(settings.registerId ? { register_id: settings.registerId } : {}),
    client: { fiscal_id: i.client.nif, name: i.client.name, address: i.client.address ?? '', country: 'AO', ...(i.client.email ? { email: i.client.email, send_email: 'yes' } : {}) },
    items: [{
      reference: i.item.reference, title: i.item.title, qty: 1, gross_price: (i.item.amountMinor / 100).toFixed(2), type_id: 'S', tax_id: settings.taxId,
      ...(settings.taxId === 'ISE' ? { tax_exemption: settings.exemptionCode ?? '', tax_exemption_law: settings.exemptionLaw ?? '' } : {}),
    }],
    ...(settings.paymentMethodId ? { payments: [{ id: settings.paymentMethodId, amount: (i.item.amountMinor / 100).toFixed(2) }] } : {}),
    notes: `Pedido ${i.number}`,
  };
  const res = await fetch(`${cfg.baseUrl}/documents/`, { method: 'POST', headers: { Authorization: vendusAuth(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { id?: number | string; number?: string; errors?: { message?: string }[] };
  if (!res.ok || !j.id) throw new IntegrationError('vendus', `Vendus respondeu ${res.status}: ${j.errors?.map((e) => e.message).join('; ') || JSON.stringify(j).slice(0, 200)}`, res.status);
  return { id: String(j.id), number: j.number ?? String(j.id) };
}

/** PDF da factura (passa pelo Kianda: a chave do Vendus nunca chega ao navegador). */
export async function vendusInvoicePdf(cfg: VendusConfig, id: string): Promise<Response> {
  const res = await fetch(`${cfg.baseUrl}/documents/${encodeURIComponent(id)}.pdf`, { headers: { Authorization: vendusAuth(cfg) } });
  if (!res.ok) throw new IntegrationError('vendus', `Vendus respondeu ${res.status} ao pedir o PDF`, res.status);
  return res;
}
