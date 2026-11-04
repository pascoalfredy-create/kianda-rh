import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, eq, getDb, pushSubscriptions } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { dispatchPush } from '../src/services/push.js';
import { b64url, encryptPayload, fromB64url, isPushEndpoint, setPushFetch } from '../src/services/webpush.js';
import { testClient, type InjectResponse } from './inject.js';

const subtle = webcrypto.subtle;
const dec = new TextDecoder();

/** O telemóvel: par de chaves ECDH e segredo de autenticação, como o navegador cria ao subscrever. */
async function device() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh: b64url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey))), auth: b64url(auth) };
}

/** Decifra como o navegador (RFC 8291), para provar que a cifra está certa. */
async function decrypt(body: Uint8Array, d: Awaited<ReturnType<typeof device>>) {
  const salt = body.slice(0, 16), idlen = body[20]!, asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const uaPublic = fromB64url(d.p256dh), authSecret = fromB64url(d.auth);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, d.pair.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder(), cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  const ikm = await hk(authSecret, shared, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  expect(plain.at(-1)).toBe(2);
  expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
  return JSON.parse(dec.decode(plain.slice(0, -1)));
}

describe('Web Push: cifra e serviços aceites', () => {
  it('o conteúdo cifrado só se lê com as chaves do dispositivo', async () => {
    const d = await device();
    const body = await encryptPayload({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: d.p256dh, auth: d.auth }, new TextEncoder().encode('{"title":"Olá"}'));
    expect(await decrypt(body, d)).toEqual({ title: 'Olá' });
    const other = await device();
    await expect(decrypt(body, other)).rejects.toThrow();
  });
  it('só envia para serviços de push conhecidos (nunca para endereços arbitrários)', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=1']) expect(isPushEndpoint(ok)).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest', 'nada']) expect(isPushEndpoint(bad)).toBe(false);
  });
});

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => { setPushFetch(fetch); await app.close(); if (process.env.DATABASE_URL) await closeDb(); });
const password = 'NotificaTelemovel2026';
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cookieOf = (r: InjectResponse) => `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;

describe.skipIf(!process.env.DATABASE_URL)('notificações no telemóvel', () => {
  let owner = '', chief = '', worker = '', workerId = '', chiefDevice: Awaited<ReturnType<typeof device>>, workerDevice: Awaited<ReturnType<typeof device>>;
  const req = (session: string, method: string, url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: session }, ...(payload === undefined ? {} : { payload }) });
  const employee = (number: string, name: string) => ({ number, name, gender: 'M', jobTitle: 'Técnico', province: 'Luanda', nif: `00000${number.padStart(5, '0')}`, contract: { type: 'indefinite', startDate: '2025-01-06', base: 300000, meal: 30000, transport: 25000 } });
  const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  let reply = 201;

  beforeAll(async () => {
    setPushFetch(async (input, init) => { sent.push({ url: String(input), headers: init!.headers as Record<string, string>, body: init!.body as Uint8Array }); return new Response(null, { status: reply }); });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { acceptTerms: true, company: { name: 'Push 0', sector: 'services', nif: String(Number(stamp.slice(-9)) * 10).padStart(10, '0').slice(-10) }, name: 'Dona', email: `${stamp}.0@push.test`, password, modules: ['hr'] } });
    owner = cookieOf(r);
    const chiefId = (await req(owner, 'POST', '/v1/employees', employee('51', 'Chefe Ngunza'))).json().id;
    workerId = (await req(owner, 'POST', '/v1/employees', employee('52', 'Luís Tchivinda'))).json().id;
    await req(owner, 'PATCH', `/v1/employees/${workerId}`, { managerId: chiefId });
    for (const [name, role, id] of [['chefe', 'manager', chiefId], ['luis', 'employee', workerId]] as const) {
      expect((await req(owner, 'POST', '/v1/users', { name, email: `${stamp}.${name}@push.test`, password, role, employeeId: id })).statusCode).toBe(201);
    }
    chief = cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `${stamp}.chefe@push.test`, password } }));
    worker = cookieOf(await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: `${stamp}.luis@push.test`, password } }));
    chiefDevice = await device(); workerDevice = await device();
  });

  it('a chave pública VAPID é criada uma vez e servida sem sessão', async () => {
    const a = (await app.inject({ method: 'GET', url: '/v1/public/push-key' })).json().publicKey;
    expect(fromB64url(a)).toHaveLength(65);
    expect((await app.inject({ method: 'GET', url: '/v1/public/push-key' })).json().publicKey).toBe(a);
  });

  it('cada utilizador regista o seu dispositivo; serviços desconhecidos são recusados', async () => {
    expect((await req(chief, 'POST', '/v1/push/subscriptions', { endpoint: 'https://evil.example/x', keys: { p256dh: chiefDevice.p256dh, auth: chiefDevice.auth } })).json().error).toBe('servico_push');
    expect((await req(chief, 'POST', '/v1/push/subscriptions', { endpoint: `https://fcm.googleapis.com/fcm/send/chefe-${stamp}`, keys: { p256dh: chiefDevice.p256dh, auth: chiefDevice.auth } })).statusCode).toBe(201);
    expect((await req(worker, 'POST', '/v1/push/subscriptions', { endpoint: `https://fcm.googleapis.com/fcm/send/luis-${stamp}`, keys: { p256dh: workerDevice.p256dh, auth: workerDevice.auth } })).statusCode).toBe(201);
    expect((await req(chief, 'GET', `/v1/push/status?endpoint=${encodeURIComponent(`https://fcm.googleapis.com/fcm/send/chefe-${stamp}`)}`)).json()).toEqual({ subscribed: true, devices: 1 });
  });

  it('um pedido de ausência avisa a chefia; a decisão avisa o colaborador — conteúdo cifrado e assinado (VAPID)', async () => {
    sent.length = 0;
    const a = await req(owner, 'POST', '/v1/absences', { employeeId: workerId, type: 'justified', startDate: '2026-12-14', endDate: '2026-12-15', reason: 'Consulta médica' });
    expect(a.statusCode).toBe(201);
    await dispatchPush(getDb());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`https://fcm.googleapis.com/fcm/send/chefe-${stamp}`);
    expect(sent[0]!.headers['Content-Encoding']).toBe('aes128gcm');
    expect(sent[0]!.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const msg = await decrypt(sent[0]!.body, chiefDevice);
    expect(msg).toMatchObject({ title: 'Novo pedido de ausência', url: '/ausencias' });
    expect(msg.body).toContain('Luís Tchivinda');
    expect(JSON.stringify(msg)).not.toContain('Consulta médica'); // o motivo não sai no aviso
    sent.length = 0;
    expect((await req(chief, 'POST', `/v1/absences/${a.json().id}/approve`, {})).statusCode).toBe(200);
    await dispatchPush(getDb());
    expect(await decrypt(sent[0]!.body, workerDevice)).toMatchObject({ title: expect.stringContaining('pedido aprovado'), body: 'De 14/12/2026 a 15/12/2026' });
  });

  it('subscrição expirada no serviço (410) é apagada; o teste do próprio funciona', async () => {
    reply = 410; sent.length = 0;
    expect((await req(worker, 'POST', '/v1/push/test')).json()).toEqual({ queued: 1 });
    const stats = await dispatchPush(getDb());
    expect(stats.expired).toBe(1);
    expect(await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, `https://fcm.googleapis.com/fcm/send/luis-${stamp}`))).toEqual([]);
    reply = 201;
  });

  it('o dispositivo deixa de receber ao desactivar (ou ao terminar sessão)', async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/chefe-${stamp}`;
    expect((await req(chief, 'DELETE', '/v1/push/subscriptions', { endpoint })).statusCode).toBe(200);
    expect((await req(chief, 'GET', `/v1/push/status?endpoint=${encodeURIComponent(endpoint)}`)).json()).toEqual({ subscribed: false, devices: 0 });
  });
});
