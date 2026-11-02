/**
 * Web Push sem bibliotecas (Web Crypto, corre em Node e nos Workers): assinatura VAPID (RFC 8292, ES256)
 * e cifra do conteúdo «aes128gcm» (RFC 8291). O serviço de push do navegador (Google, Mozilla, Apple, Microsoft)
 * só vê o conteúdo cifrado.
 */
import type { webcrypto } from 'node:crypto';

type JsonWebKey = webcrypto.JsonWebKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }

/** Par de chaves VAPID: a pública (65 bytes, não comprimida) vai para o navegador; a privada fica no servidor. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { publicKey: b64url(raw), privateJwk: await subtle().exportKey('jwk', pair.privateKey) };
}

/** Só serviços de push conhecidos (evita usar o servidor para pedidos a endereços arbitrários). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string): boolean {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(r => r.test(u.hostname)); } catch { return false; }
}

async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle().importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Cifra «aes128gcm» de um registo único (RFC 8291). Os parâmetros opcionais servem só para os testes. */
export async function encryptPayload(target: PushTarget, payload: Uint8Array, fixed?: { senderKeys?: CryptoKeyPair; salt?: Uint8Array }) {
  const uaPublic = fromB64url(target.p256dh), authSecret = fromB64url(target.auth);
  const sender = fixed?.senderKeys ?? await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await subtle().exportKey('raw', sender.publicKey));
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length; header.set(asPublic, 21);
  return concat(header, cipher);
}

let pushFetch: typeof fetch = (...a) => fetch(...a);
/** Testes: substitui o envio HTTP para os serviços de push. */
export function setPushFetch(f: typeof fetch) { pushFetch = f; }

/** Envia uma notificação. Devolve o estado HTTP (201/202 = entregue ao serviço; 404/410 = subscrição expirada). */
export async function sendPush(target: PushTarget, payload: object, keys: VapidKeys, subject: string, ttlSeconds = 24 * 3600): Promise<number> {
  if (!isPushEndpoint(target.endpoint)) return 400;
  const body = await encryptPayload(target, enc.encode(JSON.stringify(payload)));
  const res = await pushFetch(target.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuthorization(target.endpoint, keys, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttlSeconds), Urgency: 'normal' },
    body, signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}
