'use client';

/** Notificações no telemóvel: activar ou desactivar neste dispositivo (a subscrição pertence ao navegador). */
export type PushSupport = 'ok' | 'unsupported' | 'ios-install' | 'denied';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  // No iPhone, as notificações só existem com o Kianda adicionado ao ecrã principal (iOS 16.4 ou mais recente).
  if (isIos() && !standalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  return (await registration()).pushManager.getSubscription();
}

const toBytes = (b64: string) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('As notificações foram bloqueadas neste navegador. Autorize-as nas definições do site.');
  const keyRes = await fetch('/api/v1/public/push-key', { cache: 'no-store' });
  if (!keyRes.ok) throw new Error('Serviço de notificações indisponível. Tente mais tarde.');
  const { publicKey } = await keyRes.json() as { publicKey: string };
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
  const res = await fetch('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Não foi possível activar as notificações.');
}

/** Desactiva neste dispositivo (também chamado ao terminar sessão: um telemóvel partilhado deixa de receber). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await fetch('/api/v1/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
