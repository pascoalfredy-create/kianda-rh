import { expect, test } from '@playwright/test';
import { closePool, PASSWORD, registerCompany, watchErrors } from './support.js';

test.afterAll(closePool);

test('a página pública abre e leva ao início de sessão', async ({ page }) => {
  const errors = watchErrors(page);
  const res = await page.goto('/');
  expect(res!.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText('Kianda');
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sessão' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('login: palavra-passe errada é recusada e a certa entra na conta', async ({ page }) => {
  const company = await registerCompany();
  const errors = watchErrors(page);
  await page.goto('/login');
  await page.fill('input[type=email]', company.email);
  await page.fill('input[type=password]', 'PalavraErrada2026xyz');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await page.fill('input[type=password]', PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page.locator('body')).toContainText(company.name);
  // O 401 da tentativa errada é a resposta esperada da API (o navegador regista-o na consola).
  expect(errors.filter((e) => !/status of 401/.test(e))).toEqual([]);
});

test('sem sessão, a área privada e a Modelagem pedem início de sessão', async ({ page }) => {
  await page.goto('/colaboradores');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/modelagem');
  await expect(page).toHaveURL(/\/login\?voltar=%2Fmodelagem|\/login\?voltar=\/modelagem/);
});
