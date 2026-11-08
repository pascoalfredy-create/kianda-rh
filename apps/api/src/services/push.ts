/**
 * Notificações no telemóvel (Web Push): os eventos gravam a notificação na caixa de saída, na mesma transacção
 * do pedido; o envio corre depois da resposta (e, de reserva, no ciclo agendado). Sem dados sensíveis no aviso:
 * só o tipo de evento e a ligação; o conteúdo vê-se dentro do Kianda, com sessão.
 */
import { and, asc, eq, inArray, isNull, lt, platformSettings, pushOutbox, pushSubscriptions, sql, users, type Db } from '@kianda/db';
import { b64url, fromB64url, generateVapidKeys, sendPush, type VapidKeys } from './webpush.js';
import { jwtSecret } from '../plugins/tenant.js';

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

/**
 * Chave privada VAPID cifrada em repouso (AES-GCM, chave derivada por HKDF do segredo da API): quem lê a tabela
 * platform_settings (cópia de segurança, consola da base de dados) não obtém a chave que assina os avisos.
 * Se VAPID_PUBLIC_KEY e VAPID_PRIVATE_JWK estiverem definidas no ambiente, são essas que se usam.
 */
interface StoredVapid { publicKey: string; privateJwk?: VapidKeys['privateJwk']; sealed?: { iv: string; data: string } }
const vapidCipherKey = async () => {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret()), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('kianda-vapid'), info: new TextEncoder().encode('platform_settings.webpush') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};
export async function sealVapid(keys: VapidKeys): Promise<StoredVapid> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vapidCipherKey(), new TextEncoder().encode(JSON.stringify(keys.privateJwk))));
  return { publicKey: keys.publicKey, sealed: { iv: b64url(iv), data: b64url(data) } };
}
export async function openVapid(stored: StoredVapid): Promise<VapidKeys | null> {
  if (stored.privateJwk) return { publicKey: stored.publicKey, privateJwk: stored.privateJwk };
  if (!stored.sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(stored.sealed.iv) }, await vapidCipherKey(), fromB64url(stored.sealed.data));
    return { publicKey: stored.publicKey, privateJwk: JSON.parse(new TextDecoder().decode(plain)) };
  } catch { return null; }
}

/** Chaves VAPID da plataforma: do ambiente, ou criadas na primeira utilização e guardadas cifradas nas definições. */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_JWK) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(process.env.VAPID_PRIVATE_JWK) };
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'webpush'));
  if (row) {
    const stored = row.value as StoredVapid, keys = await openVapid(stored);
    // Chave antiga em claro: passa a cifrada sem mudar o par (as subscrições existentes continuam válidas).
    if (keys && stored.privateJwk) await db.update(platformSettings).set({ value: await sealVapid(keys) }).where(eq(platformSettings.key, 'webpush'));
    if (keys) return keys;
    // Segredo da API mudou: a chave guardada já não abre. Gera-se um par novo (os dispositivos voltam a activar avisos).
    const fresh = await generateVapidKeys();
    await db.update(platformSettings).set({ value: await sealVapid(fresh) }).where(eq(platformSettings.key, 'webpush'));
    return fresh;
  }
  const keys = await generateVapidKeys();
  await db.insert(platformSettings).values({ key: 'webpush', value: await sealVapid(keys) }).onConflictDoNothing();
  const [saved] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'webpush'));
  return (await openVapid(saved!.value as StoredVapid)) ?? keys;
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
