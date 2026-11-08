import { formatKz, GRACE_DAYS } from '@kianda/core';
import { and, companies, companyModules, eq, inArray, isNull, ne, paymentRequests, subscriptions, users, type Db } from '@kianda/db';
import { appBaseUrl } from './integrations.js';
import { platformSettingsGet } from './licence.js';
import { sendMail } from './mail.js';

const diff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
const pt = (d: string) => d.split('-').reverse().join('/');

type Reminder = { kind: string; subject: string; title: string; text: string };

/** Que aviso cabe hoje a esta licença (um por dia, no máximo). */
export function reminderFor(sub: { status: string; trialEndsAt: string | null; paidUntil: string | null }, today: string, product = 'Kianda RH', prefix = ''): Reminder | null {
  if (sub.status === 'suspended' || sub.status === 'cancelled') return null;
  const paid = sub.paidUntil && sub.paidUntil < '2099-01-01' && (!sub.trialEndsAt || sub.paidUntil > sub.trialEndsAt) ? sub.paidUntil : null;
  if (paid) {
    const d = diff(paid, today);
    if (d === 7) return { kind: prefix + 'renovacao_7d', subject: `A sua licença ${product} termina dentro de 7 dias`, title: 'Renovação da licença', text: `A licença está paga até ${pt(paid)}. Gere o pedido de renovação na página Licença para não perder o acesso.` };
    if (d === 0) return { kind: prefix + 'renovacao_hoje', subject: `A sua licença ${product} termina hoje`, title: 'A licença termina hoje', text: `Depois de hoje tem ${GRACE_DAYS} dias de tolerância; a seguir a conta passa a modo de consulta (sem perda de dados).` };
    if (d === -1) return { kind: prefix + 'em_atraso', subject: `Licença ${product} em atraso`, title: 'Pagamento em atraso', text: `A licença terminou a ${pt(paid)}. Tem ${GRACE_DAYS} dias para regularizar antes de a conta passar a modo de consulta.` };
    if (d === -(GRACE_DAYS + 1)) return { kind: prefix + 'modo_consulta', subject: `Conta ${product} em modo de consulta`, title: 'Conta em modo de consulta', text: 'Pode consultar os dados guardados e pré-visualizar os documentos. Regularize o pagamento na página Licença para voltar a gravar, exportar e imprimir.' };
    return null;
  }
  if (sub.trialEndsAt) {
    const d = diff(sub.trialEndsAt, today);
    if (d === 2) return { kind: prefix + 'experimental_2d', subject: `O período experimental do ${product} termina dentro de 2 dias`, title: 'O experimental está a terminar', text: `O período experimental termina a ${pt(sub.trialEndsAt)}. Escolha ${prefix ? 'o plano' : 'o escalão'} e gere o pedido de pagamento na página Licença — os dias que faltam não se perdem.` };
    if (d === 0) return { kind: prefix + 'experimental_hoje', subject: `O período experimental do ${product} termina hoje`, title: 'Último dia do experimental', text: 'A partir de amanhã a conta passa a modo de consulta até o pagamento ser recebido. Os dados ficam guardados e os documentos em pré-visualização. Active uma subscrição paga para exportar e imprimir.' };
    if (d === -1) return { kind: prefix + 'experimental_fim', subject: `Período experimental do ${product} terminado`, title: 'O experimental terminou', text: 'A conta está em modo de consulta, com documentos apenas em pré-visualização. Gere o pedido de pagamento na página Licença para voltar a gravar e exportar.' };
  }
  return null;
}

/** Avisos diários de licença (proprietário e Finanças), do RH e também do Integra e do Valora. Repetir no mesmo dia não duplica. */
export async function dailyReminders(db: Db, today: string) {
  const rows = await db.select({ s: subscriptions, name: companies.name, nif: companies.nif }).from(subscriptions).innerJoin(companies, eq(companies.id, subscriptions.companyId))
    .where(ne(companies.nif, 'PLATAFORMA'));
  const grants = await db.select({ g: companyModules, name: companies.name }).from(companyModules).innerJoin(companies, eq(companies.id, companyModules.companyId))
    .where(and(ne(companies.nif, 'PLATAFORMA'), inArray(companyModules.module, ['modeling', 'valuation']), eq(companyModules.enabled, true)));
  const settings = await platformSettingsGet(db);
  const base = appBaseUrl();
  let sent = 0;
  const notify = async (companyId: string, name: string, r: Reminder, kind: 'subscription' | 'modeling_subscription' | 'valuation_subscription', anchor: string) => {
    const [pending] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.companyId, companyId), eq(paymentRequests.status, 'pending'), eq(paymentRequests.kind, kind)));
    const contacts = await db.select({ email: users.email }).from(users).where(and(eq(users.companyId, companyId), inArray(users.role, ['owner', 'finance']), isNull(users.disabledAt)));
    for (const { email } of contacts) {
      if (!email) continue;
      const out = await sendMail(db, {
        to: email, companyId, kind: r.kind, dedupeKey: `${r.kind}:${companyId}:${today}:${email}`, subject: r.subject, title: r.title,
        paragraphs: [`${name}: ${r.text}`, ...(pending ? [`Já existe o pedido ${pending.number} de ${formatKz(pending.amountMinor)} por pagar${pending.gatewayReference ? ` (referência Multicaixa ${pending.gatewayReference})` : ''}.`] : [])],
        button: base ? { label: 'Abrir a página Licença', url: `${base}/licenca${anchor}` } : null, replyTo: settings.supportEmail,
      });
      if (out === 'sent') sent++;
    }
  };
  for (const { s, name } of rows) {
    const r = reminderFor(s, today);
    if (r) await notify(s.companyId, name, r, 'subscription', '');
  }
  for (const { g, name } of grants) {
    const product = g.module === 'modeling' ? 'Kianda Integra' : 'Kianda Valora';
    const r = reminderFor({ status: g.status, trialEndsAt: g.trialEndsAt, paidUntil: g.paidUntil }, today, product, g.module + '_');
    if (r) await notify(g.companyId, name, r, g.module === 'modeling' ? 'modeling_subscription' : 'valuation_subscription', '#' + g.module);
  }
  return { checked: rows.length + grants.length, sent };
}
