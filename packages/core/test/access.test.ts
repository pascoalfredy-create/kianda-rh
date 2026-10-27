import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, normalizePhone, otpauthUri, pinProblem, totp, verifyTotp } from '../src/index.js';

// Vector oficial da RFC 6238 (SHA-1, segredo "12345678901234567890").
const SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('verificação em dois passos (TOTP)', () => {
  it('base32 ida e volta', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(base32Decode(SECRET))).toBe('12345678901234567890');
  });
  it('vectores da RFC 6238 (6 dígitos)', async () => {
    expect(await totp(SECRET, 59_000)).toBe('287082');
    expect(await totp(SECRET, 1_111_111_109_000)).toBe('081804');
    expect(await totp(SECRET, 1_234_567_890_000)).toBe('005924');
    expect(await totp(SECRET, 2_000_000_000_000)).toBe('279037');
  });
  it('aceita ±30 s e recusa o resto', async () => {
    const t = 1_234_567_890_000;
    expect(await verifyTotp(SECRET, '005924', t + 29_000)).toBe(true);
    expect(await verifyTotp(SECRET, await totp(SECRET, t - 30_000), t)).toBe(true);
    expect(await verifyTotp(SECRET, await totp(SECRET, t - 90_000), t)).toBe(false);
    expect(await verifyTotp(SECRET, 'abc', t)).toBe(false);
  });
  it('otpauth para a aplicação', () => {
    expect(otpauthUri('ABC', 'ana@x.ao')).toBe('otpauth://totp/Kianda%20RH%3Aana%40x.ao?secret=ABC&issuer=Kianda%20RH&algorithm=SHA1&digits=6&period=30');
  });
});

describe('PIN e telefone', () => {
  it('PIN fraco recusado', () => {
    expect(pinProblem('12345')).toMatch(/6 dígitos/);
    expect(pinProblem('111111')).toMatch(/iguais/);
    expect(pinProblem('345678')).toMatch(/sequência/);
    expect(pinProblem('987654')).toMatch(/sequência/);
    expect(pinProblem('730418')).toBeNull();
  });
  it('telefone normalizado', () => {
    expect(normalizePhone('+244 923 456 789')).toBe('923456789');
    expect(normalizePhone('923-456-789')).toBe('923456789');
  });
});
