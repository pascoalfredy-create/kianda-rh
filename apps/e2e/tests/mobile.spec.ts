import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors } from './support.js';

/** Telemóvel (Pixel 7): navegação do RH e Integra com menu, versões em cartões e acções visíveis. */
test.afterAll(closePool);

test('RH no telemóvel: menu ☰ com grupos recolhíveis leva a Férias & Ausências', async ({ page, context }) => {
  const company = await registerCompany({ name: 'Telemóvel RH E2E' });
  await signIn(context, company.token);
  const errors = watchErrors(page);
  const res = await page.goto('/');
  expect(res!.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(company.name);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.locator('.nav-group-toggle', { hasText: 'Tempo' }).click();
  await page.getByRole('link', { name: /Férias & Ausências/ }).click();
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
