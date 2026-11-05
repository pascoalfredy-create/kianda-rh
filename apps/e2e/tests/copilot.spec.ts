import { expect, test } from '@playwright/test';
import { blankValuationData, financialTemplate } from '../../../packages/core/src/index.js';
import { apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

test.afterAll(closePool);
test('copiloto RH abre os guias com INSS correcto e distingue a conversa que aguarda activação', async ({ page, context }) => {
  const owner = await registerCompany(); await signIn(context, owner.token); const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/copiloto?modulo=hr');
  await expect(page.getByRole('heading', { name: 'Copiloto Kianda RH', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Pesquisar orientação do copiloto', exact: true }).fill('INSS do trabalhador');
  await page.getByText('INSS do trabalhador e da empresa', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Guias especializados', exact: true })).toContainText('a empresa 8%');
  await expect(page.getByRole('region', { name: 'Conversa com o copiloto', exact: true })).toContainText('aguarda activação');
  await expect(page.getByRole('button', { name: 'Perguntar ao copiloto', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Kianda Integra', exact: true })).toHaveCount(0);
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('Integra e Valora abrem o seu especialista, sem enviar o resumo financeiro por omissão', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'modeling', 'valuation'] }); await signIn(context, owner.token); const errors = watchErrors(page);
  const t = financialTemplate('servicos');
  const model = await apiAs(owner.token, 'POST', '/v1/modeling/models', { name: 'Projecto do copiloto', sector: 'servicos', currency: t.currency, assumptions: t.assumptions }); expect(model.status).toBe(201);
  const analysis = await apiAs(owner.token, 'POST', '/v1/valuation/analyses', { name: 'Análise do copiloto', data: blankValuationData({ entity: 'Empresa reservada', lastClosedYear: 2025 }) }); expect(analysis.status).toBe(201);
  let calls = 0; page.on('request', r => { if (/\/api\/v1\/copilots\/[^/]+\/ask/.test(r.url())) calls++; });
  await page.goto('/modelagem');
  await expect(page.getByRole('link', { name: 'Copiloto', exact: true })).toHaveAttribute('href', new RegExp(`projecto=${model.body.id}`));
  await page.getByRole('link', { name: 'Copiloto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copiloto Kianda Integra', exact: true })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Contexto financeiro do copiloto', exact: true });
  await expect(summary.getByRole('checkbox', { name: 'Autorizar resumo financeiro na IA', exact: true })).not.toBeChecked();
  await summary.getByText(/Ver resumo · revisão/).click();
  await expect(summary).toContainText('VAL do projecto'); expect(calls).toBe(0);
  await page.goto('/valora');
  await expect(page.locator('#kpis26')).toContainText('Sem meses reais encerrados');
  await page.getByRole('link', { name: 'Copiloto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copiloto Kianda Valora', exact: true })).toBeVisible();
  await expect(summary.getByRole('combobox', { name: 'Contexto financeiro', exact: true })).toHaveValue(analysis.body.id);
  await expect(summary).toContainText('Milhões de Kz'); expect(calls).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
