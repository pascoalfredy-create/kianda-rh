/**
 * Notificações no telemóvel (Web Push): os eventos gravam a notificação na caixa de saída, na mesma transacção
 * do pedido; o envio corre depois da resposta (e, de reserva, no ciclo agendado). Sem dados sensíveis no aviso:
 * só o tipo de evento e a ligação; o conteúdo vê-se dentro do Kianda, com sessão.
 */
import { and, asc, eq, inArray, isNull, lt, platformSettings, pushOutbox, pushSubscriptions, sql, users, type Db } from '@kianda/db';
import { generateVapidKeys, sendPush, type VapidKeys } from './webpush.js';

export interface PushMessage { title: string; body: string; url: string; tag?: string }

let flagged = false;
type Runner = (work: (db: Db) => Promise<unknown>) => Promise<unknown>;
/** Como correr o envio fora do pedido: em Node, a ligação da plataforma; nos Workers, uma ligação própria (worker.ts). */
let runner: Runner | null = null;
export function setPushRunner(r: Runner | null) { runner = r; }
export function runPushInBackground(waitUntil?: (p: Promise<unknown>) => void) {
  if (!runner) return;
  const p = runner(db => dispatchPush(db)).catch(e => console.error('push', e));
  if (waitUntil) waitUntil(p);
}
/** Há notificações por enviar desde o último envio (o middleware da app lança o envio depois da resposta). */
export const takePushFlag = () => { const f = flagged; flagged = false; return f; };

/** Grava a notificação para os utilizadores activos indicados (sem utilizadores, nada acontece). */
export async function notifyUsers(db: Db, companyId: string, userIds: string[], message: PushMessage) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return 0;
  const active = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, ids), isNull(users.disabledAt)));
  if (!active.length) return 0;
  await db.insert(pushOutbox).values(active.map(u => ({ companyId, userId: u.id, payload: message })));
  flagged = true;
  return active.length;
}

/** Utilizadores ligados às fichas dos colaboradores (o colaborador recebe no seu telemóvel). */
export async function notifyEmployees(db: Db, companyId: string, employeeIds: string[], message: PushMessage) {
  if (!employeeIds.length) return 0;
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), inArray(users.employeeId, [...new Set(employeeIds)])));
  return notifyUsers(db, companyId, rows.map(r => r.id), message);
}

/** Quem decide um pedido do colaborador: a chefia directa; sem chefia com acesso, o RH e o proprietário. */
export async function notifyDeciders(db: Db, companyId: string, emp: { id: string; managerId: string | null }, message: PushMessage) {
  if (emp.managerId) {
    const managers = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.employeeId, emp.managerId), isNull(users.disabledAt)));
    if (managers.length) return notifyUsers(db, companyId, managers.map(m => m.id), message);
  }
  const hr = await db.select({ id: users.id, employeeId: users.employeeId }).from(users).where(and(eq(users.companyId, companyId), inArray(users.role, ['owner', 'hr_admin']), isNull(users.disabledAt)));
  return notifyUsers(db, companyId, hr.filter(u => u.employeeId !== emp.id).map(u => u.id), message);
}

/** Chaves VAPID da plataforma: criadas na primeira utilização e guardadas nas definições (a privada nunca sai do servidor). */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'webpush'));
  if (row) return row.value as VapidKeys;
  const keys = await generateVapidKeys();
  await db.insert(platformSettings).values({ key: 'webpush', value: keys }).onConflictDoNothing();
  const [saved] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'webpush'));
  return saved!.value as VapidKeys;
}

const subject = () => process.env.APP_BASE_URL?.startsWith('https://') ? process.env.APP_BASE_URL : 'https://kianda.yelaperformance.com';

/**
 * Envia as notificações pendentes (fora da transacção do pedido, com a ligação da plataforma).
 * Subscrições expiradas (404/410) são apagadas; falhas temporárias repetem-se até 3 vezes; avisos com mais
 * de 2 dias deixam de ser enviados (já não são úteis).
 */
export async function dispatchPush(db: Db, limit = 200) {
  const pending = await db.select().from(pushOutbox).where(isNull(pushOutbox.sentAt)).orderBy(asc(pushOutbox.createdAt)).limit(limit).for('update', { skipLocked: true });
  if (!pending.length) return { sent: 0, failed: 0, expired: 0, dropped: 0 };
  const keys = await vapidKeys(db);
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(pending.map(p => p.userId))]));
  const stats = { sent: 0, failed: 0, expired: 0, dropped: 0 };
  const stale = new Date(Date.now() - 2 * 86_400_000);
  for (const item of pending) {
    if (item.createdAt < stale) { await db.update(pushOutbox).set({ sentAt: new Date(), error: 'expirado' }).where(eq(pushOutbox.id, item.id)); stats.dropped++; continue; }
    const targets = subs.filter(s => s.userId === item.userId);
    let ok = 0, temporary = 0;
    for (const s of targets) {
      let status = 0;
      try { status = await sendPush(s, item.payload, keys, subject()); } catch { status = 0; }
      if (status >= 200 && status < 300) { ok++; await db.update(pushSubscriptions).set({ lastSuccessAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, s.id)); }
      else if (status === 404 || status === 410 || status === 400) { stats.expired++; await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)); }
      else { temporary++; await db.update(pushSubscriptions).set({ failures: sql`${pushSubscriptions.failures} + 1` }).where(eq(pushSubscriptions.id, s.id)); }
    }
    if (temporary && item.attempts < 2) { await db.update(pushOutbox).set({ attempts: item.attempts + 1, error: 'serviço de push indisponível' }).where(eq(pushOutbox.id, item.id)); stats.failed++; }
    else { await db.update(pushOutbox).set({ sentAt: new Date(), attempts: item.attempts + 1, error: ok ? null : targets.length ? 'sem entrega' : 'sem dispositivos' }).where(eq(pushOutbox.id, item.id)); if (ok) stats.sent++; }
  }
  // Limpeza: avisos enviados há mais de 30 dias.
  await db.delete(pushOutbox).where(and(lt(pushOutbox.createdAt, new Date(Date.now() - 30 * 86_400_000))));
  return stats;
}
