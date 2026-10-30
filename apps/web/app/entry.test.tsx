import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ cookie: false, me: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ has: () => state.cookie }) }));
vi.mock('@/lib/api', () => ({ currentUser: state.me, SESSION_COOKIE: 'kianda_session' }));
vi.mock('@/lib/site', () => import('../lib/site'));
vi.mock('@/components/public-home', () => import('../components/public-home'));
vi.mock('./(app)/layout', () => ({ default: () => null }));
vi.mock('./(app)/home', () => ({ default: () => null }));
import EntryPage, { generateMetadata } from './page';
import AppLayout from './(app)/layout';
import Home from './(app)/home';
import { PublicHome } from '../components/public-home';
import robots from './robots';
import sitemap from './sitemap';
import manifest from './manifest';
import { SITE_URL } from '../lib/site';

beforeEach(() => { state.cookie = false; state.me.mockReset(); });
describe('entrada pública, sessão e descoberta do Kianda', () => {
  it('entrega conteúdo indexável dos dois módulos sem depender da API nem de JavaScript no cliente', async () => {
    const page = await EntryPage(), metadata = await generateMetadata();
    expect(page.type).toBe(PublicHome); expect(state.me).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Kianda RH'); expect(html).toContain('Kianda Integra');
    expect(html).toContain('<h1>Recursos Humanos e Modelagem Financeira para empresas em Angola</h1>');
    expect(html).toContain('href="/login"'); expect(html).toContain('href="/registo"');
    expect(html).toContain('application/ld+json');
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(SITE_URL);
  });
  it('mantém o mesmo painel, layout e permissões para quem tem sessão válida', async () => {
    state.cookie = true; state.me.mockResolvedValue({ user: { sub: 'sintetico' } });
    const page = await EntryPage();
    expect(page.type).toBe(AppLayout); expect(page.props.children.type).toBe(Home);
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });
  it('uma sessão expirada mostra apenas a apresentação pública', async () => {
    state.cookie = true; state.me.mockResolvedValue(null);
    expect((await EntryPage()).type).toBe(PublicHome);
    expect((await generateMetadata()).robots).toEqual({ index: true, follow: true });
  });
  it('o sitemap anuncia só a apresentação pública e o manifest permite abrir Integra sem criar novos acessos', () => {
    expect(sitemap().map(page => page.url)).toEqual([SITE_URL]);
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/', disallow: ['/api/'] }, sitemap: `${SITE_URL}/sitemap.xml` });
    expect(manifest().shortcuts?.map(shortcut => shortcut.url)).toContain('/modelagem');
    expect(manifest().scope).toBe('/'); expect(manifest().orientation).toBe('any');
  });
});
