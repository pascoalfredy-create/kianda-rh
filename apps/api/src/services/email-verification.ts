import { luandaDate, randomToken, sha256Hex, trialEndDate, TRIAL_DAYS } from '@kianda/core';
import { and, auditLogs, companyModules, desc, emailVerifications, eq, isNull, subscriptions, users, type Db } from '@kianda/db';
import { appBaseUrl, mailConfig } from './integrations.js';
import { sendMail } from './mail.js';
import { DomainError } from './payroll.js';

export const EMAIL_VERIFICATION_HOURS = 24;
export const maskEmail = (email: string | null) => email?.replace(/^(.{1,2})[^@]*(@.*)$/, '$1…$2') ?? '';
export const emailDeliveryEnabled = () => Boolean(appBaseUrl() && mailConfig());

/** A ligação nunca é devolvida ao navegador nem guardada em claro. */
export async function issueEmailVerification(db: Db, userId: string) {
  if (!emailDeliveryEnabled()) return { sent: false, unavailable: true, retryAfter: 0 };
  const token = randomToken(), now = new Date();
  const target = await db.transaction(async tx => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!u?.email || u.disabledAt || !u.emailVerificationRequired || u.emailVerifiedAt) return null;
    const [last] = await tx.select().from(emailVerifications).where(eq(emailVerifications.userId, u.id)).orderBy(desc(emailVerifications.createdAt)).limit(1);
    if (last && now.getTime() - last.createdAt.getTime() < 120_000) return { retryAfter: Math.ceil((120_000 - (now.getTime() - last.createdAt.getTime())) / 1000) };
    await tx.update(emailVerifications).set({ revokedAt: now }).where(and(eq(emailVerifications.userId, u.id), isNull(emailVerifications.usedAt), isNull(emailVerifications.revokedAt)));
    await tx.insert(emailVerifications).values({ companyId: u.companyId, userId: u.id, email: u.email, tokenHash: await sha256Hex(token), expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_HOURS * 3_600_000) });
    return { user: u };
  });
  if (!target) return { sent: false, unavailable: false, retryAfter: 0 };
  if ('retryAfter' in target) return { sent: false, unavailable: false, retryAfter: target.retryAfter };
  const outcome = await sendMail(db, {
    to: target.user.email, companyId: target.user.companyId, kind: 'confirmacao_email',
    subject: 'Confirme o seu email — Kianda', title: 'Confirme o seu email para começar',
    paragraphs: [`Recebemos o registo da sua conta no Kianda. Confirme este endereço para entrar nos módulos e começar os ${TRIAL_DAYS} dias de experiência gratuita, sem cartão nem cobrança automática.`, `A ligação é pessoal, só pode ser usada uma vez e expira em ${EMAIL_VERIFICATION_HOURS} horas. Se não criou esta conta, ignore esta mensagem.`],
    button: { label: 'Confirmar o meu email', url: `${appBaseUrl()}/confirmar-email?token=${encodeURIComponent(token)}` },
  });
  return { sent: outcome === 'sent', unavailable: outcome !== 'sent', retryAfter: 120 };
}

/** Confirmação explícita, atómica e de uso único; visitar o URL nunca consome a ligação. */
export async function confirmEmail(db: Db, token: string) {
  const hash = await sha256Hex(token), now = new Date();
  return db.transaction(async tx => {
    const [lookup] = await tx.select({ id: emailVerifications.id, userId: emailVerifications.userId }).from(emailVerifications).where(eq(emailVerifications.tokenHash, hash));
    if (!lookup) throw new DomainError('confirmacao_invalida', 'A ligação de confirmação é inválida. Peça uma nova ligação.', 400);
    // A mesma ordem de bloqueio do reenvio (utilizador antes da ligação) evita deadlocks.
    const [u] = await tx.select().from(users).where(eq(users.id, lookup.userId)).for('update');
    const [v] = await tx.select().from(emailVerifications).where(eq(emailVerifications.id, lookup.id)).for('update');
    if (!u || !v || u.disabledAt || u.email !== v.email || u.companyId !== v.companyId) throw new DomainError('confirmacao_invalida', 'A ligação de confirmação é inválida. Peça uma nova ligação.', 400);
    const row = { u, v };
    if (row.v.usedAt || row.v.revokedAt || row.v.expiresAt <= now) throw new DomainError('confirmacao_expirada', 'A ligação já foi usada ou expirou. Inicie sessão e peça uma nova ligação.', 410);
    await tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, row.u.id));
    await tx.update(emailVerifications).set({ usedAt: now }).where(eq(emailVerifications.id, row.v.id));
    await tx.update(emailVerifications).set({ revokedAt: now }).where(and(eq(emailVerifications.userId, row.u.id), isNull(emailVerifications.usedAt), isNull(emailVerifications.revokedAt)));
    // Só a primeira confirmação inicia a experiência: reenvios não renovam licenças, nem períodos pagos.
    const until = trialEndDate(luandaDate(now));
    if (!row.u.emailVerifiedAt && row.u.emailVerificationRequired) {
      await tx.update(subscriptions).set({ trialEndsAt: until }).where(and(eq(subscriptions.companyId, row.u.companyId), eq(subscriptions.status, 'trial'), isNull(subscriptions.paidUntil)));
      await tx.update(companyModules).set({ trialEndsAt: until }).where(and(eq(companyModules.companyId, row.u.companyId), eq(companyModules.status, 'trial'), isNull(companyModules.paidUntil)));
    }
    await tx.insert(auditLogs).values({ companyId: row.u.companyId, actorId: row.u.id, action: 'email_confirmed', entity: 'user', entityId: row.u.id, after: { email: maskEmail(row.u.email) } });
    return { ok: true, message: 'Email confirmado. A sua conta está pronta para começar.' };
  });
}
