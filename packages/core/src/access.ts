/**
 * Acesso dos utilizadores: verificação em dois passos (TOTP, RFC 6238 — Google/Microsoft Authenticator),
 * PIN para colaboradores sem email e tokens de convite.
 * Só usa Web Crypto: funciona em Node e nos Workers da Cloudflare.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new RangeError('base32 inválido');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function randomBase32(bytes = 20): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Código TOTP de 6 dígitos para um instante (passo de 30 s). */
export async function totp(secretB32: string, atMs: number = Date.now(), step = 30, digits = 6): Promise<string> {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  new DataView(msg.buffer).setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32) as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Verifica um código aceitando ±1 passo (relógio do telemóvel desacertado até 30 s). */
export async function verifyTotp(secretB32: string, code: string, atMs: number = Date.now()): Promise<boolean> {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  for (const d of [0, -1, 1]) if ((await totp(secretB32, atMs + d * 30_000)) === c) return true;
  return false;
}

/** Endereço otpauth:// para adicionar a conta numa aplicação autenticadora (QR ou ligação). */
export function otpauthUri(secretB32: string, account: string, issuer = 'Kianda RH'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** PIN de 6 dígitos sem sequências óbvias (123456, 111111, 654321…). */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'O PIN tem 6 dígitos';
  if (/^(\d)\1{5}$/.test(pin)) return 'PIN demasiado fácil (todos os dígitos iguais)';
  const asc = '0123456789012';
  const desc = '9876543210987';
  if (asc.includes(pin) || desc.includes(pin)) return 'PIN demasiado fácil (sequência)';
  return null;
}

/** Token aleatório para convites e recuperação (só o hash é guardado). */
export function randomToken(bytes = 24): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Telefone angolano normalizado (9 dígitos, sem indicativo): "+244 923 456 789" → "923456789". */
export function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.startsWith('244') && d.length === 12 ? d.slice(3) : d;
}
