import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, getDb, outboundEmails, platformAdmins } from '@kianda/db';
import { alertServerError, ERROR_ALERTS_PER_HOUR, errorSignature, normalisedRoute } from '../src/services/error-alerts.js';

afterAll(async () => { if (process.env.DATABASE_URL) await closeDb(); });

describe('alertas de erro interno', () => {
  it('agrupa pela rota sem identificadores e pelo tipo de erro', () => {
    expect(normalisedRoute('/v1/employees/123e4567-e89b-12d3-a456-426614174000/contracts/42')).toBe('/v1/employees/:id/contracts/:n');
    expect(normalisedRoute('/v1/public/documents/ABCD-EFGH-IJKL?info=teste')).toBe('/v1/public/documents/:id');
    const a = errorSignature({ method: 'GET', path: '/v1/x/123e4567-e89b-12d3-a456-426614174000', error: new TypeError('falhou\nlinha 2') });
    const b = errorSignature({ method: 'GET', path: '/v1/x/223e4567-e89b-12d3-a456-426614174000', error: new TypeError('outra mensagem') });
    expect(a.fingerprint).toBe(b.fingerprint); expect(a).not.toHaveProperty('first');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('envio limitado aos administradores da plataforma', () => {
  it('um email por erro e por hora, com teto global por hora', async () => {
    const db = getDb(), admin = `alertas.${Date.now()}@kianda.test`;
    await db.insert(platformAdmins).values({ email: admin }).onConflictDoNothing();
    // Instantes únicos por execução (a tabela de emails não é limpa entre execuções).
    const base = Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 1e6) * 3 * 3600_000;
    const at = new Date(base), err = new RangeError('limite');
    expect(await alertServerError({ method: 'POST', path: '/v1/teste', error: err, at })).toBe('sent');
    expect(await alertServerError({ method: 'POST', path: '/v1/teste', error: err, at })).toBe('duplicate');
    // Outros testes em paralelo podem gerar alertas reais para o mesmo administrador: procurar este em concreto.
    const mails = await db.select().from(outboundEmails).where(eq(outboundEmails.toAddress, admin));
    expect(mails.filter((m) => m.kind === 'alerta_erro' && m.subject === 'Kianda · erro interno em POST /v1/teste')).toHaveLength(1);
    const later = new Date(base + 24 * 3600_000 * 400);
    await db.insert(outboundEmails).values(Array.from({ length: ERROR_ALERTS_PER_HOUR }, (_, i) => ({ toAddress: 'x@kianda.test', subject: 's', kind: 'alerta_erro', status: 'skipped', dedupeKey: `teto-${later.getTime()}-${i}-${admin}`, createdAt: new Date(later.getTime() - 60_000) })));
    expect(await alertServerError({ method: 'GET', path: '/v1/outro', error: err, at: later })).toBe('limited');
    await db.delete(platformAdmins).where(eq(platformAdmins.email, admin));
  }, 20_000);
});
