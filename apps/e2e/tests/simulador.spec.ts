import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

/** Simulador (líquido → base e base → líquido, com USD) e salário indexado ao dólar no processamento. */
test.afterAll(closePool);

test('Simulador: do líquido pretendido ao salário base e de USD ao líquido', async ({ page, context }) => {
  const owner = await registerCompany();
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/simulador');
  await expect(page.getByRole('heading', { name: 'Simulador salarial', level: 1 })).toBeVisible();
  await page.getByLabel('Mês').fill('2026-11');
  await page.getByLabel('Líquido pretendido (Kz)').fill('500000');
  await page.getByLabel('Subsídio de alimentação (Kz)').fill('0');
  await page.getByLabel('Subsídio de transporte (Kz)').fill('0');
  // 0,776 × base + 12 750 = 500 000 → 627 899,48 Kz (mesma folha do Excel).
  await expect(page.locator('.kpi', { hasText: 'Salário base necessário' })).toContainText(/627.899,4[89] Kz/);
  await expect(page.getByRole('row', { name: /Salário líquido calculado/ })).toContainText(/500.000,0\d Kz/);
  await page.getByLabel('Subsídio de alimentação (Kz)').fill('40000');
  await page.getByLabel('Alimentação e transporte incidem INSS').check();
  await expect(page.getByRole('row', { name: /Base de incidência do INSS/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/e2e/simulador-01-inverso.png', fullPage: true });

  await page.getByLabel('Contrato em USD, pago em Kz ao câmbio do dia').check();
  await expect(page.locator('.alert')).toContainText('Indique o câmbio');
  await page.getByLabel('Contrato em USD, pago em Kz ao câmbio do dia').uncheck();

  await page.getByRole('tab', { name: 'Salário base → líquido' }).click();
  await page.getByLabel('Contrato em USD, pago em Kz ao câmbio do dia').check();
  await page.getByLabel('Salário base (USD)').fill('1500');
  await page.getByLabel('Câmbio USD→Kz do dia').fill('912,50');
  await expect(page.locator('.kpi', { hasText: 'Salário base' }).first()).toContainText(/1.368.750,00 Kz/);
  await expect(page.getByRole('row', { name: /Vencimento base \(USD 1.500,00 × 912,50 Kz\)/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/e2e/simulador-02-usd.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Salário indexado: o processamento pede o câmbio do dia e o recibo mostra a conversão', async ({ page, context }) => {
  const owner = await registerCompany();
  const r = await apiAs(owner.token, 'POST', '/v1/employees', { number: '51', name: 'Paulo Indexado', gender: 'M', jobTitle: 'Engenheiro', province: 'Luanda', nif: '0000005151', contract: { type: 'indefinite', startDate: '2026-01-05', base: 1_350_000, currency: 'USD', baseUsd: 1500, meal: 30000, transport: 25000 } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto(`/colaboradores/${r.body.id}`);
  await expect(page.locator('.facts')).toContainText(/USD 1.500,00/);
  await page.goto('/processamento?mes=2026-10');
  await expect(page.getByText('1 colaborador(es) com salário indexado ao dólar')).toBeVisible();
  await page.getByRole('button', { name: 'Preparar processamento' }).click();
  await expect(page.getByRole('button', { name: 'Calcular folha', exact: true })).toBeDisabled();
  await page.getByLabel('Câmbio USD→Kz').fill('912,50');
  await page.getByLabel('Data do câmbio').fill('2026-10-30');
  await page.getByRole('button', { name: 'Calcular folha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recalcular' })).toBeVisible();
  await expect(page.locator('body')).toContainText(/câmbio 912,50 Kz\/USD de 30\/10\/2026/);
  await page.screenshot({ path: '/tmp/e2e/indexado-01-processamento.png', fullPage: false });
  expect(errors).toEqual([]);
});
