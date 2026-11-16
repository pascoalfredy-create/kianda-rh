import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, inArray, releaseNotes, sql } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';

const app = testClient(buildApp({ rateLimit: false }));
const tag = `t${Date.now()}`;
afterAll(async () => {
  await app.close();
  if (process.env.DATABASE_URL) {
    await getDb()
      .delete(releaseNotes)
      .where(inArray(releaseNotes.slug, [`${tag}-rh`, `${tag}-valora`, `${tag}-todos`]));
    await closeDb();
  }
});

describe.skipIf(!process.env.DATABASE_URL)('novidades do Kianda', () => {
  it('só as publicadas depois da conta, filtradas por módulo e perfil; «fechar» marca como vistas', async () => {
    const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        acceptTerms: true,
        company: { name: 'Novidades, Lda', nif },
        name: 'Dona',
        email: `novidades.${tag}@kianda.test`,
        password: 'NovidadesKianda2026',
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
    const call = (method: string, url: string) => app.inject({ method, url, headers: { cookie } });
    const slugs = (list: { slug: string }[]) => list.map(n => n.slug).filter(s => s.startsWith(tag));

    // Uma nota anterior à conta nunca aparece como nova.
    await getDb()
      .insert(releaseNotes)
      .values({ slug: `${tag}-todos`, title: 'Antiga', body: 'x', publishedAt: new Date(Date.now() - 86_400_000) });
    expect(slugs((await call('GET', '/v1/auth/me')).json().news)).toEqual([]);

    await new Promise(res => setTimeout(res, 20));
    await getDb()
      .insert(releaseNotes)
      .values([
        { slug: `${tag}-rh`, title: 'Novo no RH', body: 'x', modules: ['hr'], roles: ['owner', 'hr_admin'], url: '/x' },
        { slug: `${tag}-valora`, title: 'Novo no Valora', body: 'x', modules: ['valuation'] },
      ]);
    const me = (await call('GET', '/v1/auth/me')).json();
    expect(slugs(me.news)).toEqual([`${tag}-rh`]);
    expect(me.news[0]).toMatchObject({ title: 'Novo no RH', url: '/x', unread: true });

    expect((await call('POST', '/v1/release-notes/seen')).statusCode).toBe(204);
    expect(slugs((await call('GET', '/v1/auth/me')).json().news)).toEqual([]);
    const all = (await call('GET', '/v1/release-notes')).json();
    expect(slugs(all)).toEqual([`${tag}-rh`, `${tag}-todos`]);
    expect(all.every((n: { unread: boolean }) => !n.unread)).toBe(true);
  });

  it('a aplicação só lê as novidades: gravar é reservado à publicação', async () => {
    const res = await getDb().execute(
      sql`select has_table_privilege('kianda_app', 'release_notes', 'INSERT') as ins, has_table_privilege('kianda_app', 'release_notes', 'SELECT') as sel`,
    );
    expect(res.rows[0]).toEqual({ ins: false, sel: true });
  });
});
