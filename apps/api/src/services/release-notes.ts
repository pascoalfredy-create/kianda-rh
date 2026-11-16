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

interface RawNote {
  slug: string;
  title: string;
  body: string;
  url: string | null;
  modules: string[];
  roles: string[];
  publishedAt: string | Date;
  unread: boolean;
}

/** Coluna com as novidades por ver, para entrar na leitura única do arranque (sem pedido extra à base de dados). */
export function unreadReleaseNotesColumn(actor: Actor) {
  return sql<RawNote[]>`(select coalesce(json_agg(json_build_object('slug', n.slug, 'title', n.title, 'body', n.body,
    'url', n.url, 'modules', n.modules, 'roles', n.roles, 'publishedAt', n.published_at, 'unread', true)
    order by n.published_at desc), '[]'::json) from (select * from release_notes
    where published_at > coalesce((select u.release_notes_seen_at from users u where u.id = ${actor.actorId}), now())
    order by published_at desc limit 10) n)`;
}

/** Filtra pelos módulos com acesso e pelo perfil. */
export function visibleReleaseNotes(rows: RawNote[], actor: Actor, modules: CompanyModulesOverview): ReleaseNoteView[] {
  const who = { role: actor.role as ReleaseNoteRole, modules: PLATFORM_MODULES.filter(m => modules[m].canAccess) };
  return rows
    .filter(r => releaseNoteFor({ modules: r.modules as typeof who.modules, roles: r.roles as ReleaseNoteRole[] }, who))
    .map(({ modules: _m, roles: _r, publishedAt, ...r }) => ({
      ...r,
      publishedAt: new Date(publishedAt).toISOString(),
    }));
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
  return visibleReleaseNotes(rows, actor, modules);
}

/** Marca as novidades como vistas (o aviso desaparece até à próxima publicação). */
export async function markReleaseNotesSeen(db: Db, actor: Actor) {
  await db.update(users).set({ releaseNotesSeenAt: new Date() }).where(eq(users.id, actor.actorId));
}
