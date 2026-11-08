import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, eq, getDb, outboundEmails, platformAdmins } from '@kianda/db';
import { alertServerError, ERROR_ALERTS_PER_HOUR, errorSignature, normalisedRoute } from '../src/services/error-alerts.js';

afterAll(async () => { if (process.env.DATABASE_URL) await closeDb(); });

describe('alertas de erro interno', () => {
  it('agrupa pela rota sem identificadores e pelo tipo de erro', () => {
    expect(normalisedRoute('/v1/employees/123e4567-e89b-12d3-a456-426614174000/contracts/42')).toBe('/v1/employees/:id/contracts/:n');
    const a = errorSignature({ method: 'GET', path: '/v1/x/123e4567-e89b-12d3-a456-426614174000', error: new TypeError('falhou\nlinha 2') });
    const b = errorSignature({ method: 'GET', path: '/v1/x/223e4567-e89b-12d3-a456-426614174000', error: new TypeError('outra mensagem') });
    expect(a.fingerprint).toBe(b.fingerprint); expect(a.first).toBe('falhou');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('envio limitado aos administradores da plataforma', () => {
  it('um email por erro e por hora, com teto global por hora', async () => {
    const db = getDb(), admin = `alertas.${Date.now()}@kianda.test`;
    await db.insert(platformAdmins).values({ email: admin }).onConflictDoNothing();
    const at = new Date(Date.UTC(2099, 0, 1, 10, 30)), err = new RangeError('limite');
    expect(await alertServerError({ method: 'POST', path: '/v1/teste', error: err, at })).toBe('sent');
    expect(await alertServerError({ method: 'POST', path: '/v1/teste', error: err, at })).toBe('duplicate');
    const [mail] = await db.select().from(outboundEmails).where(eq(outboundEmails.toAddress, admin));
    expect(mail).toMatchObject({ kind: 'alerta_erro', subject: 'Kianda · erro interno em POST /v1/teste' });
    const later = new Date(Date.UTC(2099, 0, 2, 10, 30));
    await db.insert(outboundEmails).values(Array.from({ length: ERROR_ALERTS_PER_HOUR }, (_, i) => ({ toAddress: 'x@kianda.test', subject: 's', kind: 'alerta_erro', status: 'skipped', dedupeKey: `teto-${later.getTime()}-${i}-${admin}`, createdAt: new Date(later.getTime() - 60_000) })));
    expect(await alertServerError({ method: 'GET', path: '/v1/outro', error: err, at: later })).toBe('limited');
    await db.delete(platformAdmins).where(eq(platformAdmins.email, admin));
  });
});
