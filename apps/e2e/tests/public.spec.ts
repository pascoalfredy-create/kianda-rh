import { expect, test } from '@playwright/test';
import { closePool, PASSWORD, registerCompany, watchErrors } from './support.js';

test.afterAll(closePool);

test('o registo incompleto permite regressar ao início sem criar uma conta', async ({ page }) => {
  let registrations = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/v1/auth/register')) registrations++; });
  await page.goto('/registo?modulo=valuation&plano=corporate&ciclo=annual');
  await page.getByLabel('Denominação social').fill('Empresa em preparação');
  await page.getByRole('link', { name: '← Página inicial', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Cuide da sua equipa/ })).toBeVisible();
  expect(registrations).toBe(0);
  for (const path of ['/login', '/recuperar', '/termos']) {
    await page.goto(path);
    await page.getByRole('link', { name: '← Página inicial', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
});

test('uma falha de rede no login apresenta um erro e permite tentar novamente', async ({ page }) => {
  await page.goto('/login');
  await page.route('**/api/v1/auth/login', route => route.abort());
  await page.getByLabel('Email', { exact: true }).fill('rede@e2e.kianda.test');
  await page.getByLabel('Palavra-passe', { exact: true }).fill('RedeDeTeste2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('Verifique a ligação');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '← Página inicial', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('a página pública abre e leva ao início de sessão', async ({ page }) => {
  const errors = watchErrors(page);
  const res = await page.goto('/');
  expect(res!.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText('Kianda');
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sessão' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('página pública: o Valora aparece como terceiro módulo e os planos levam ao registo com a escolha', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByText('Uma conta. Três caminhos para gerir.')).toBeVisible();
  await page.getByRole('button', { name: /Kianda Valora/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Conheça o valor da empresa. Controle o exercício.' })).toBeVisible();
  await page.screenshot({ path: '/tmp/e2e/publico-01-valora.png', fullPage: false });
  await page.getByRole('button', { name: 'Ver condições do Kianda Valora' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('button', { name: 'Kianda Valora' })).toHaveAttribute('aria-pressed', 'true');
  for (const text of ['ATÉ 3 ANÁLISES ACTIVAS', 'PME / Grupo', 'Profissional', 'SEM LIMITE DE ANÁLISES', '10.000 Kz/mês']) await expect(dialog).toContainText(text);
  await expect(dialog).toContainText(/129\s900,00/);
  await dialog.getByLabel('Pagamento').selectOption('annual');
  await expect(dialog).toContainText(/1\s324\s980,00/);
  await page.screenshot({ path: '/tmp/e2e/publico-02-planos-valora.png', fullPage: false });
  await dialog.locator('article', { hasText: 'Corporate' }).getByRole('link', { name: /Escolher Valora/ }).click();
  await expect(page).toHaveURL(/\/registo\?modulo=valuation&plano=corporate&ciclo=annual/);
  await expect(page.getByLabel('Plano do Valora')).toHaveValue('corporate');
  await expect(page.getByLabel('Pagamento do Valora')).toHaveValue('annual');
  expect(errors).toEqual([]);
});

test('login: palavra-passe errada é recusada e a certa entra na conta', async ({ page }) => {
  const company = await registerCompany();
  const errors = watchErrors(page);
  await page.goto('/login');
  await page.fill('input[type=email]', company.email);
  await page.fill('input[type=password]', 'PalavraErrada2026xyz');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('form [role="alert"]')).toBeVisible();
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
