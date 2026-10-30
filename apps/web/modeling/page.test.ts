import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODELING_REFERENCE_HASH, MODELING_SHELL, MODELING_SUFFIX } from '../lib/modeling/generated';
import { modelingHeaders, modelingPage } from '../lib/modeling/page';
import type { ModelingSession } from './store';
const prototype = readFileSync(new URL('./prototype.html', import.meta.url), 'utf8');
describe('interface aprovada e documento autenticado', () => {
  it('preserva byte a byte o CSS e a estrutura HTML anteriores ao JavaScript', () => {
    expect(MODELING_SHELL).toBe(prototype.slice(0, prototype.indexOf('<script>')));
    expect(MODELING_SUFFIX).toBe(prototype.slice(prototype.lastIndexOf('</script>') + 9));
    expect(MODELING_REFERENCE_HASH).toBe(createHash('sha256').update(prototype).digest('hex'));
  });
  it('isola a sessão JSON de qualquer conteúdo HTML executável', () => {
    const session = { user: { name: '</script><script>alert(1)</script>' } } as ModelingSession;
    const html = modelingPage(session, 'a1');
    expect(html).not.toContain(session.user.name); expect(html).toContain('\\u003c/script>');
    expect(html).toContain('id="integra-session" type="application/json" nonce="a1"');
    const json = html.split('nonce="a1">')[1]!.split('</script>')[0]!; expect(JSON.parse(json)).toEqual(session);
  });
  it('recusa uma página executável sem sessão e escapa o erro de acesso', () => {
    const html = modelingPage(null, 'nonce', '<img onerror="bad">'); expect(html).toContain('&lt;img'); expect(html).not.toContain('/modeling-runtime.js');
    expect(modelingHeaders('nonce')).toMatchObject({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    expect(modelingHeaders('nonce')['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(modelingHeaders('nonce')['content-security-policy']).toContain("worker-src 'self'");
    expect(html).toContain('id="integra-space"');
    expect(modelingHeaders('nonce')['x-robots-tag']).toBe('noindex, nofollow');
  });
  it('liga o documento independente ao Kianda instalável e preserva o zoom no telefone', () => {
    const html = modelingPage({ canWrite: true } as ModelingSession, 'nonce');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(html).not.toContain('user-scalable=no');
    expect(html).toContain('id="integra-install" hidden');
    expect(html).toContain('class="menu-close btn"');
    expect(html).toContain('<label for="mSel"');
    expect(html).toContain('id="integra-network-status"');
  });
  it('o runtime distribuído não persiste dados ou exporta CSV/clipboard', () => {
    const js = readFileSync(new URL('../public/modeling-runtime.js', import.meta.url), 'utf8');
    expect(js).not.toMatch(/localStorage|sessionStorage|clipboard|copyFS|repCopy/);
    expect(js).toContain('/api/v1/modeling');
  });
});
