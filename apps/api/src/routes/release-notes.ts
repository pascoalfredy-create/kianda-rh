import { Hono } from 'hono';
import { getDb } from '@kianda/db';
import { requireAccount, type AppEnv } from '../plugins/tenant.js';
import { companyModulesOverview } from '../services/modules.js';
import { markReleaseNotesSeen, releaseNotesFor } from '../services/release-notes.js';

/** Novidades do Kianda: histórico visível para a pessoa e «já vi». */
export function releaseNoteRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/release-notes', requireAccount, async c => {
    const actor = c.get('actor');
    if (actor.platformAdmin) return c.json([]);
    const db = getDb();
    return c.json(
      await releaseNotesFor(db, actor, await companyModulesOverview(db, actor.companyId, actor.actorId, actor.role)),
    );
  });
  app.post('/v1/release-notes/seen', requireAccount, async c => {
    const actor = c.get('actor');
    if (!actor.platformAdmin) await markReleaseNotesSeen(getDb(), actor);
    return c.body(null, 204);
  });
  return app;
}
