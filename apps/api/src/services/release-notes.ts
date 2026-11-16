import { PLATFORM_MODULES, releaseNoteFor, type CompanyModulesOverview, type ReleaseNoteRole } from '@kianda/core';
import { desc, eq, releaseNotes, sql, users, type Db } from '@kianda/db';
import type { Actor } from '../plugins/tenant.js';

export interface ReleaseNoteView {
  slug: string;
  title: string;
  body: string;
  url: string | null;
  publishedAt: string;
  unread: boolean;
}

/** Novidades para esta pessoa: só módulos a que a empresa tem acesso e só o seu perfil. */
export async function releaseNotesFor(
  db: Db,
  actor: Actor,
  modules: CompanyModulesOverview,
  opts: { unreadOnly?: boolean } = {},
): Promise<ReleaseNoteView[]> {
  const seen = db.select({ at: users.releaseNotesSeenAt }).from(users).where(eq(users.id, actor.actorId));
  const rows = await db
    .select({
      slug: releaseNotes.slug,
      title: releaseNotes.title,
      body: releaseNotes.body,
      url: releaseNotes.url,
      modules: releaseNotes.modules,
      roles: releaseNotes.roles,
      publishedAt: releaseNotes.publishedAt,
      unread: sql<boolean>`${releaseNotes.publishedAt} > coalesce((${seen}), now())`,
    })
    .from(releaseNotes)
    .where(opts.unreadOnly ? sql`${releaseNotes.publishedAt} > coalesce((${seen}), now())` : undefined)
    .orderBy(desc(releaseNotes.publishedAt))
    .limit(opts.unreadOnly ? 10 : 100);
  const who = {
    role: actor.role as ReleaseNoteRole,
    modules: PLATFORM_MODULES.filter(m => modules[m].canAccess),
  };
  return rows
    .filter(r => releaseNoteFor({ modules: r.modules as typeof who.modules, roles: r.roles as ReleaseNoteRole[] }, who))
    .map(({ modules: _m, roles: _r, publishedAt, ...r }) => ({ ...r, publishedAt: publishedAt.toISOString() }));
}

/** Marca as novidades como vistas (o aviso desaparece até à próxima publicação). */
export async function markReleaseNotesSeen(db: Db, actor: Actor) {
  await db.update(users).set({ releaseNotesSeenAt: new Date() }).where(eq(users.id, actor.actorId));
}
