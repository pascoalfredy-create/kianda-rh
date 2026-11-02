/** Notificações no telemóvel: chave pública VAPID, subscrição por dispositivo e aviso de teste. */
import { and, eq, getDb, pushSubscriptions } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { notifyUsers, vapidKeys } from '../services/push.js';
import { isPushEndpoint } from '../services/webpush.js';

const b64 = z.string().regex(/^[A-Za-z0-9_-]+=*$/);
const subscription = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: b64.min(80).max(100), auth: b64.min(16).max(32) }) });

export function pushRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/push/subscriptions', '/v1/push/status', '/v1/push/test']) app.use(p, requireCompany);

  /** Pública (é a chave que o navegador usa para criar a subscrição); criada na primeira utilização. */
  app.get('/v1/public/push-key', async (c) => c.json({ publicKey: (await vapidKeys(getDb())).publicKey }, 200, { 'cache-control': 'public, max-age=3600' }));

  app.post('/v1/push/subscriptions', async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = subscription.parse(await body(c));
    if (!isPushEndpoint(b.endpoint)) throw new DomainError('servico_push', 'Serviço de notificações não reconhecido neste navegador.', 400);
    // O mesmo dispositivo passa a pertencer ao utilizador com sessão (ex.: telemóvel partilhado depois de mudar de conta).
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, b.endpoint));
    const [row] = await db.insert(pushSubscriptions).values({ companyId: actor.companyId, userId: actor.actorId, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: (c.req.header('user-agent') ?? '').slice(0, 300) })
      .onConflictDoNothing().returning({ id: pushSubscriptions.id });
    if (!row) throw new DomainError('dispositivo_noutra_empresa', 'Este dispositivo recebe notificações de outra empresa. Desactive-as nessa conta primeiro.', 409);
    return c.json({ ok: true }, 201);
  });

  app.delete('/v1/push/subscriptions', async (c) => {
    const actor = c.get('actor');
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await body(c));
    await getDb().delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, actor.actorId)));
    return c.json({ ok: true });
  });

  app.get('/v1/push/status', async (c) => {
    const actor = c.get('actor');
    const endpoint = c.req.query('endpoint') ?? '';
    const [row] = endpoint ? await getDb().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, actor.actorId))) : [];
    const devices = await getDb().select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, actor.actorId));
    return c.json({ subscribed: !!row, devices: devices.length });
  });

  app.post('/v1/push/test', async (c) => {
    const actor = c.get('actor');
    const n = await notifyUsers(getDb(), actor.companyId, [actor.actorId], { title: 'Kianda', body: 'As notificações estão activas neste dispositivo.', url: '/conta', tag: 'teste' });
    return c.json({ queued: n });
  });

  return app;
}
