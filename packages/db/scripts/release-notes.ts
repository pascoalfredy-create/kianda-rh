import 'dotenv/config';
import { RELEASE_NOTES } from '@kianda/core';
import { sql } from 'drizzle-orm';
import { closeDb, getDb, releaseNotes } from '../src/index.js';

/**
 * Último passo da publicação, depois de a produção estar verificada: grava as novidades novas com a data de agora.
 * As já publicadas mantêm a data (não voltam a aparecer a ninguém); só o texto pode ser corrigido.
 */
try {
  if (!RELEASE_NOTES.length) console.log('Sem novidades para anunciar.');
  else {
    const rows = await getDb()
      .insert(releaseNotes)
      .values(RELEASE_NOTES.map(n => ({ ...n })))
      .onConflictDoUpdate({
        target: releaseNotes.slug,
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          modules: sql`excluded.modules`,
          roles: sql`excluded.roles`,
          url: sql`excluded.url`,
        },
      })
      .returning({ slug: releaseNotes.slug, fresh: sql<boolean>`(xmax = 0)` });
    const fresh = rows.filter(r => r.fresh).map(r => r.slug);
    console.log(
      fresh.length ? `Novidades anunciadas: ${fresh.join(', ')}` : 'Nenhuma novidade nova (textos actualizados).',
    );
  }
} finally {
  await closeDb();
}
