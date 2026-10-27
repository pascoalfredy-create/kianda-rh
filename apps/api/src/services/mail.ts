import { eq, outboundEmails, type Db } from '@kianda/db';
import { mailConfig, resendSend } from './integrations.js';

export interface MailMessage {
  to: string | null | undefined;
  subject: string;
  /** Tipo (convite, recuperação, pedido_pagamento, pagamento_confirmado, aviso_experimental…). */
  kind: string;
  companyId?: string | null;
  /** Evita repetir o mesmo aviso (ex.: "trial-2d:<empresa>:<data>"). */
  dedupeKey?: string;
  title: string;
  paragraphs: string[];
  /** Linhas de destaque (ex.: entidade, referência e montante). */
  facts?: [string, string][];
  button?: { label: string; url: string } | null;
  replyTo?: string | null;
}

export type MailOutcome = 'sent' | 'skipped' | 'failed' | 'duplicate' | 'no_address';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderMail(m: MailMessage) {
  const facts = m.facts?.length
    ? `<table style="border-collapse:collapse;margin:14px 0;width:100%">${m.facts.map(([k, v]) => `<tr><td style="padding:6px 10px;color:#5b6472;border-bottom:1px solid #eef0f3">${esc(k)}</td><td style="padding:6px 10px;font-weight:700;border-bottom:1px solid #eef0f3;font-size:16px">${esc(v)}</td></tr>`).join('')}</table>`
    : '';
  const button = m.button ? `<p style="margin:22px 0"><a href="${esc(m.button.url)}" style="background:#0f5c4d;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:600">${esc(m.button.label)}</a></p><p style="color:#8a93a0;font-size:12px">Se o botão não funcionar, copie esta ligação: ${esc(m.button.url)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1b2430">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;border:1px solid #e6e9ee;overflow:hidden">
<div style="background:#0d1f1b;color:#fff;padding:16px 22px;font-weight:700">Kianda RH</div>
<div style="padding:22px">
<h1 style="font-size:19px;margin:0 0 12px">${esc(m.title)}</h1>
${m.paragraphs.map((p) => `<p style="line-height:1.5;margin:0 0 10px">${esc(p)}</p>`).join('')}
${facts}${button}
</div>
<div style="padding:12px 22px;background:#fafbfc;color:#8a93a0;font-size:12px">Mensagem automática do Kianda RH. Não responda a este email${m.replyTo ? ` — escreva para ${esc(m.replyTo)}` : ''}.</div>
</div></body></html>`;
  const text = [m.title, '', ...m.paragraphs, ...(m.facts ?? []).map(([k, v]) => `${k}: ${v}`), ...(m.button ? ['', `${m.button.label}: ${m.button.url}`] : [])].join('\n');
  return { html, text };
}

/**
 * Envia (se o email estiver configurado) e regista sempre. Nunca lança: um email que falha não pode
 * desfazer um pagamento confirmado ou um convite criado.
 */
export async function sendMail(db: Pick<Db, 'select' | 'insert'>, m: MailMessage): Promise<MailOutcome> {
  const to = m.to?.trim();
  if (!to) return 'no_address';
  if (m.dedupeKey) {
    const [dup] = await db.select({ id: outboundEmails.id }).from(outboundEmails).where(eq(outboundEmails.dedupeKey, m.dedupeKey));
    if (dup) return 'duplicate';
  }
  const cfg = mailConfig();
  const base = { companyId: m.companyId ?? null, toAddress: to, subject: m.subject, kind: m.kind, dedupeKey: m.dedupeKey ?? null };
  if (!cfg) {
    await db.insert(outboundEmails).values({ ...base, status: 'skipped', error: 'Email não configurado (RESEND_API_KEY / MAIL_FROM)' }).onConflictDoNothing();
    return 'skipped';
  }
  try {
    const { html, text } = renderMail(m);
    const providerId = await resendSend(cfg, { to, subject: m.subject, html, text, replyTo: m.replyTo });
    await db.insert(outboundEmails).values({ ...base, status: 'sent', provider: 'resend', providerId }).onConflictDoNothing();
    return 'sent';
  } catch (e) {
    // Falhou: sem chave de repetição, para o próximo ciclo voltar a tentar.
    await db.insert(outboundEmails).values({ ...base, dedupeKey: null, status: 'failed', provider: 'resend', error: String((e as Error).message).slice(0, 500) }).onConflictDoNothing();
    return 'failed';
  }
}
