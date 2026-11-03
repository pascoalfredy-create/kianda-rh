import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors, valoraGo } from './support.js';

/** Telemóvel (Pixel 7): navegação do RH e Integra com menu, versões em cartões e acções visíveis. */
test.afterAll(closePool);

test('RH no telemóvel: menu ☰ com grupos recolhíveis leva a Férias e ausências', async ({ page, context }) => {
  const company = await registerCompany({ name: 'Telemóvel RH E2E' });
  await signIn(context, company.token);
  const errors = watchErrors(page);
  const res = await page.goto('/');
  expect(res!.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(company.name);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.locator('.nav-group-toggle', { hasText: 'Tempo' }).click();
  await page.getByRole('link', { name: /Férias e ausências/ }).click();
  await expect(page).toHaveURL(/\/ausencias/);
  await expect(page.locator('body')).not.toContainText(/Application error|Erro interno/);
  expect(errors).toEqual([]);
});

test('Integra no telemóvel: menu, pressupostos e versões em cartões dentro do ecrã', async ({ page, context }) => {
  const company = await registerCompany({ name: 'Telemóvel Integra E2E', modules: ['hr', 'modeling'] });
  await sql(`update company_modules set status='active', paid_until='2099-12-31' where company_id=$1 and module='modeling'`, [company.id]);
  const tpl = (await apiAs(company.token, 'GET', '/v1/modeling/templates/comercio')).body;
  const model = await apiAs(company.token, 'POST', '/v1/modeling/models', { name: 'Distribuidora Huambo', sector: 'comercio', currency: 'Kz', assumptions: tpl.assumptions });
  expect(model.status).toBe(201);
  expect((await apiAs(company.token, 'POST', `/v1/modeling/models/${model.body.id}/versions`, { revision: 1, label: 'Proposta ao banco' })).status).toBe(201);
  await signIn(context, company.token);
  const errors = watchErrors(page);
  await page.goto('/modelagem');
  await page.click('#integra-menu-toggle');
  await expect(page.locator('#integra-side')).toBeVisible();
  await page.click('[data-go="pressupostos"]');
  await expect(page.locator('#integra-side')).toBeHidden();
  await page.click('header [data-act="versions"]');
  const card = page.locator('.versions-table tbody tr').first();
  await expect(card).toContainText('Proposta ao banco');
  const pdf = card.locator('[data-act="versionPdf"]');
  await expect(pdf).toBeVisible();
  const box = (await pdf.boundingBox())!, width = page.viewportSize()!.width;
  expect(box.x + box.width, 'o botão PDF tem de caber no ecrã').toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});

test('Telemóvel: página pública com três módulos sem transbordar e Valora com menu ☰', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Kianda Valora/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Conheça o valor da empresa. Controle o exercício.' })).toBeVisible();
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Ver condições do Kianda Valora' }).click();
  await expect(page.locator('dialog[open]')).toContainText('ATÉ 3 ANÁLISES ACTIVAS');
  await page.screenshot({ path: '/tmp/e2e/publico-03-telemovel-planos.png', fullPage: false });
  await page.keyboard.press('Escape');

  const company = await registerCompany({ name: 'Telemóvel Valora E2E', modules: ['valuation'] });
  await signIn(context, company.token);
  await page.goto('/valora');
  await page.locator('#valoraFirst').click();
  await page.locator('#vName').fill('Análise no telemóvel');
  await page.locator('#vEnt').fill('Empresa Móvel, Lda.');
  await page.locator('#vStart').selectOption('example');
  await page.locator('#vCreate').click();
  await expect(page.locator('#hdrEnt')).toHaveText('Empresa Móvel, Lda.');
  await page.locator('#valoraMenu').click();
  await valoraGo(page, 'orcamento');
  await expect(page.locator('input[data-orc="vendas"]')).toBeVisible();
  // O fundo da barra lateral do computador não fica pintado por trás do conteúdo no telefone.
  expect(await page.evaluate<string>("getComputedStyle(document.querySelector('.app')).backgroundImage")).toBe('none');
  await page.screenshot({ path: '/tmp/e2e/valora-06-telemovel.png', fullPage: false });
  // Sair do Valora no telemóvel: Módulos e Terminar sessão no cabeçalho, sem alargar a página.
  await page.evaluate('window.scrollTo(0, 0)');
  await expect(page.locator('header').getByRole('link', { name: 'Módulos e licenças' })).toBeVisible();
  await expect(page.locator('#valoraLogoutTop')).toBeVisible();
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/e2e/valora-07-telemovel-sair.png', fullPage: false });
  expect(errors).toEqual([]);
});
