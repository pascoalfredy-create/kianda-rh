import { expect, test } from '@playwright/test';

test('telemóvel: pode abandonar o registo a meio pela navegação da própria aplicação', async ({ page }) => {
  await page.goto('/registo');
  await page.getByLabel('Denominação social').fill('Empresa no telemóvel');
  await page.getByLabel('Nome', { exact: true }).scrollIntoViewIfNeeded();
  const home = page.getByRole('link', { name: '← Página inicial', exact: true });
  await expect(home).toBeInViewport();
  await home.click();
  await expect(page).toHaveURL(/\/$/);
});
