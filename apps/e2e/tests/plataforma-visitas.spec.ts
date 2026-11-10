import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql } from './support.js';

test.afterAll(closePool);

test('visitas ao site: a página inicial conta a visita e a consola mostra-a', async ({ browser, page, context }) => {
  const admin = await registerCompany({ name: 'Consola Visitas' });
  await sql('insert into platform_admins (email) values ($1) on conflict do nothing', [admin.email.toLowerCase()]);
  const before = (await apiAs(admin.token, 'GET', '/v1/platform/visits?days=7')).body.totals.views as number;

  // Visitante anónimo, sem sessão: a página inicial envia a visita, sem cookies.
  const anon = await browser.newContext({ baseURL: test.info().project.use.baseURL, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 e2e-' + Date.now() });
  const visitor = await anon.newPage();
  const sent = visitor.waitForResponse(r => r.url().endsWith('/api/v1/public/visit') && r.status() === 204);
  await visitor.goto('/?utm_source=e2e');
  await sent;
  expect((await anon.cookies()).filter(c => !c.name.startsWith('__cf'))).toEqual([]);
  await anon.close();

  await expect.poll(async () => (await apiAs(admin.token, 'GET', '/v1/platform/visits?days=7')).body.totals.views).toBeGreaterThan(before);
  await signIn(context, admin.token);
  await page.goto('/plataforma');
  const zone = page.locator('#visitas');
  await expect(zone.getByRole('heading', { name: /Visitas ao site/ })).toBeVisible();
  await expect(zone.getByText('Telemóvel')).toBeVisible();
  await expect(zone.getByText('e2e', { exact: true })).toBeVisible();
  if (process.env.KIANDA_SHOT) await zone.screenshot({ path: process.env.KIANDA_SHOT });
});
