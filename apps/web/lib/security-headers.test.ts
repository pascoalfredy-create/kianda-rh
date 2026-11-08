import { describe, expect, it } from 'vitest';
import config from '../next.config';

describe('cabeçalhos de segurança em todas as páginas', () => {
  it('aplica CSP, nosniff, Referrer-Policy, frame-ancestors e HSTS fora do desenvolvimento', async () => {
    const rules = await config.headers!();
    const all = rules.find(r => r.source === '/:path*')!;
    const h = Object.fromEntries(all.headers.map(x => [x.key, x.value]));
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'self'");
    expect(h['Content-Security-Policy']).toContain("object-src 'none'");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(h['Permissions-Policy']).toContain('geolocation=(self)');
  });
});
