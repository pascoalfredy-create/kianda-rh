import { eq, getDb, users } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, rateLimit, requireCompany, type AppEnv } from '../plugins/tenant.js';
import { confirmEmail, emailDeliveryEnabled, issueEmailVerification, maskEmail } from '../services/email-verification.js';

export function emailVerificationRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/auth/email-verification', requireCompany, async c => {
    const [u] = await getDb().select().from(users).where(eq(users.id, c.get('actor').actorId));
    return c.json({ required: Boolean(u?.emailVerificationRequired && !u.emailVerifiedAt), verified: Boolean(u?.emailVerifiedAt), email: maskEmail(u?.email ?? null), deliveryEnabled: emailDeliveryEnabled() });
  });
  app.post('/v1/auth/email-verification/resend', requireCompany, rateLimit('verify-email-resend', 5, 3_600_000), async c => {
    const result = await issueEmailVerification(getDb(), c.get('actor').actorId);
    if (result.unavailable) return c.json({ ...result, message: 'A confirmação por email está temporariamente indisponível. Tente mais tarde ou contacte o suporte.' }, 503);
    if (!result.sent && result.retryAfter) return c.json({ ...result, message: `Aguarde ${result.retryAfter} segundos antes de pedir outra ligação.` }, 429);
    return c.json({ ...result, message: result.sent ? 'Enviámos uma nova ligação. Verifique também a pasta de spam.' : 'Esta conta não tem uma confirmação pendente.' });
  });
  app.post('/v1/public/email-verification', rateLimit('verify-email', 10, 900_000), async c => {
    const b = z.object({ token: z.string().min(24).max(200) }).parse(await body(c));
    return c.json(await confirmEmail(getDb(), b.token));
  });
  return app;
}
