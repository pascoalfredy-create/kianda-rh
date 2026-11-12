import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, closePool, PASSWORD, registerCompany, signIn, sql } from './support.js';

test.afterAll(closePool);

async function platformAccount() {
  const customer = await registerCompany({ name: 'Empresa de teste da consola' });
  await sql("insert into companies (id, name, nif) values ($1, 'Administração Kianda', 'PLATAFORMA') on conflict (nif) do nothing", [randomUUID()]);
  await sql(`insert into users (id, company_id, name, email, role, password_hash)
    select $1, c.id, 'Administrador de teste', u.email, u.role, u.password_hash from companies c
    join users u on u.company_id = $2 and u.email = $3 where c.nif = 'PLATAFORMA'`, [randomUUID(), customer.id, customer.email]);
  await sql('insert into platform_admins (email) values ($1) on conflict do nothing', [customer.email]);
  return customer;
}

test('visitas ao site: a página inicial conta a visita e a consola mostra-a', async ({ browser, page, context }) => {
  const customer = await platformAccount();
  const login = await apiAs<{ token: string }>('', 'POST', '/v1/auth/login', { email: customer.email, password: PASSWORD, area: 'plataforma' });
  expect(login.status).toBe(200);
  const admin = login.body;
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

test('administração entra directamente na consola e mantém a conta de empresa separada', async ({ page, context }) => {
  const customer = await platformAccount();
  await page.goto('/plataforma');
  await expect(page).toHaveURL(/\/login\?area=plataforma$/);
  await expect(page.getByRole('heading', { name: 'Entrar na administração' })).toBeVisible();
  await page.evaluate("caches.open('kianda-pages-v1').then(cache => cache.put('/recibos', new Response('Recibo da sessão anterior')))");
  await page.getByLabel('Email', { exact: true }).fill(customer.email);
  await page.getByLabel('Palavra-passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma$/);
  const nav = page.getByRole('navigation', { name: 'Administração da plataforma' });
  await expect(nav.getByRole('link')).toHaveText(['Plataforma', 'A minha conta']);
  await expect(page.getByRole('heading', { name: 'Plataforma Kianda' })).toBeVisible();
  await expect.poll(() => page.evaluate<boolean>("caches.match('/recibos').then(Boolean)")).toBe(false);
  await expect(page.getByRole('link', { name: 'Módulos e licenças' })).toHaveCount(0);
  for (const route of ['/', '/colaboradores', '/licenca', '/modelagem', '/valora']) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/plataforma$/);
  }
  await nav.getByRole('link', { name: 'A minha conta' }).click();
  await expect(page.getByRole('heading', { name: 'A minha conta' })).toBeVisible();
  await nav.getByRole('button', { name: 'Terminar sessão' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/plataforma');
  await expect(page).toHaveURL(/\/login\?area=plataforma$/);

  await signIn(context, customer.token);
  await page.goto('/plataforma');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('complementary', { name: 'Navegação principal' })).toBeVisible();
  await expect(nav).toHaveCount(0);
});
