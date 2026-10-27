import { formatKz, GRACE_DAYS } from '@kianda/core';
import { and, companies, eq, inArray, isNull, ne, paymentRequests, subscriptions, users, type Db } from '@kianda/db';
import { appBaseUrl } from './integrations.js';
import { platformSettingsGet } from './licence.js';
import { sendMail } from './mail.js';

const diff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const pt = (d: string) => d.split('-').reverse().join('/');

type Reminder = { kind: string; subject: string; title: string; text: string };

/** Que aviso cabe hoje a esta licença (um por dia, no máximo). */
export function reminderFor(sub: { status: string; trialEndsAt: string | null; paidUntil: string | null }, today: string): Reminder | null {
  if (sub.status === 'suspended' || sub.status === 'cancelled') return null;
  const paid = sub.paidUntil && sub.paidUntil < '2099-01-01' && (!sub.trialEndsAt || sub.paidUntil > sub.trialEndsAt) ? sub.paidUntil : null;
  if (paid) {
    const d = diff(paid, today);
    if (d === 7) return { kind: 'renovacao_7d', subject: 'A sua licença Kianda RH termina dentro de 7 dias', title: 'Renovação da licença', text: `A licença está paga até ${pt(paid)}. Gere o pedido de renovação na página Licença para não perder o acesso.` };
    if (d === 0) return { kind: 'renovacao_hoje', subject: 'A sua licença Kianda RH termina hoje', title: 'A licença termina hoje', text: `Depois de hoje tem ${GRACE_DAYS} dias de tolerância; a seguir a conta passa a modo de consulta (sem perda de dados).` };
    if (d === -1) return { kind: 'em_atraso', subject: 'Licença Kianda RH em atraso', title: 'Pagamento em atraso', text: `A licença terminou a ${pt(paid)}. Tem ${GRACE_DAYS} dias para regularizar antes de a conta passar a modo de consulta.` };
    if (d === -(GRACE_DAYS + 1)) return { kind: 'modo_consulta', subject: 'Conta Kianda RH em modo de consulta', title: 'Conta em modo de consulta', text: 'Pode consultar e exportar todos os dados, mas não gravar alterações. Regularize o pagamento na página Licença para voltar a usar tudo.' };
    return null;
  }
  if (sub.trialEndsAt) {
    const d = diff(sub.trialEndsAt, today);
    if (d === 2) return { kind: 'experimental_2d', subject: 'O período experimental do Kianda RH termina dentro de 2 dias', title: 'O experimental está a terminar', text: `O período experimental termina a ${pt(sub.trialEndsAt)}. Escolha o escalão e gere o pedido de pagamento na página Licença — os dias que faltam não se perdem.` };
    if (d === 0) return { kind: 'experimental_hoje', subject: 'O período experimental do Kianda RH termina hoje', title: 'Último dia do experimental', text: 'A partir de amanhã a conta passa a modo de consulta até o pagamento ser recebido. Os seus dados ficam guardados.' };
    if (d === -1) return { kind: 'experimental_fim', subject: 'Período experimental do Kianda RH terminado', title: 'O experimental terminou', text: 'A conta está em modo de consulta. Gere o pedido de pagamento na página Licença: com Multicaixa a activação é imediata.' };
  }
  return null;
}

/** Avisos diários de licença (proprietário e Finanças). Repetir no mesmo dia não duplica. */
export async function dailyReminders(db: Db, today: string) {
  const rows = await db.select({ s: subscriptions, name: companies.name, nif: companies.nif }).from(subscriptions).innerJoin(companies, eq(companies.id, subscriptions.companyId))
    .where(ne(companies.nif, 'PLATAFORMA'));
  const settings = await platformSettingsGet(db);
  const base = appBaseUrl();
  let sent = 0;
  for (const { s, name } of rows) {
    const r = reminderFor(s, today);
    if (!r) continue;
    const [pending] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.companyId, s.companyId), eq(paymentRequests.status, 'pending'), eq(paymentRequests.kind, 'subscription')));
    const contacts = await db.select({ email: users.email }).from(users).where(and(eq(users.companyId, s.companyId), inArray(users.role, ['owner', 'finance']), isNull(users.disabledAt)));
    for (const { email } of contacts) {
      if (!email) continue;
      const out = await sendMail(db, {
        to: email, companyId: s.companyId, kind: r.kind, dedupeKey: `${r.kind}:${s.companyId}:${today}:${email}`, subject: r.subject, title: r.title,
        paragraphs: [`${name}: ${r.text}`, ...(pending ? [`Já existe o pedido ${pending.number} de ${formatKz(pending.amountMinor)} por pagar${pending.gatewayReference ? ` (referência Multicaixa ${pending.gatewayReference})` : ''}.`] : [])],
        button: base ? { label: 'Abrir a página Licença', url: `${base}/licenca` } : null, replyTo: settings.supportEmail,
      });
      if (out === 'sent') sent++;
    }
  }
  return { checked: rows.length, sent };
}
