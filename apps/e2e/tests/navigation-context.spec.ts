import { expect, test } from '@playwright/test';
import { blankValuationData, financialTemplate } from '../../../packages/core/src/index.js';
import { apiAs, closePool, openMaps, registerCompany, signIn, valoraGo, watchErrors } from './support.js';

test.afterAll(closePool);

test('ficha salarial e assiduidade regressam à preparação, com rascunho e salários actualizados', async ({ page, context }) => {
  const owner = await registerCompany();
  const person = await apiAs(owner.token, 'POST', '/v1/employees', { number: '1', name: 'Amélia Navegação', jobTitle: 'Técnica', contract: { type: 'indefinite', startDate: '2026-01-01', base: 2856000, currency: 'USD', baseUsd: 3000 } });
  expect(person.status).toBe(201); await signIn(context, owner.token); const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-09');
  await page.getByRole('button', { name: 'Processar salários', exact: true }).click(); await page.getByRole('radio', { name: 'Escolher colaboradores', exact: true }).check();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento', exact: true });
  const search = preparation.getByRole('textbox', { name: 'Pesquisar colaborador do lote', exact: true });
  await search.fill('Amélia');
  await preparation.getByLabel('Câmbio USD→Kz', { exact: true }).fill('952');
  await preparation.getByLabel('Data do câmbio', { exact: true }).fill('2026-09-30');
  await preparation.getByLabel('Fonte do câmbio', { exact: true }).fill('Referência do teste');
  const salaryLink = preparation.getByRole('link', { name: 'Ficha salarial', exact: true });
  await salaryLink.scrollIntoViewIfNeeded();
  const leftAt = await page.evaluate<number>('window.scrollY');
  await salaryLink.click();
  await page.getByRole('link', { name: 'Dados', exact: true }).click();
  expect((await apiAs(owner.token, 'POST', `/v1/employees/${person.body.id}/compensation`, { effectiveDate: '2026-09-01', base: 3046400, currency: 'USD', baseUsd: 3200, reason: 'Ajuste durante a revisão' })).status).toBe(201);
  await page.getByRole('button', { name: 'Voltar à página anterior', exact: true }).click();
  await expect(page).toHaveURL(/\/processamento\?mes=2026-09$/);
  await expect(search).toHaveValue('Amélia');
  await expect(preparation.getByRole('checkbox', { name: 'Processar Amélia Navegação', exact: true })).toBeChecked();
  await expect(preparation.getByLabel('Fonte do câmbio', { exact: true })).toHaveValue('Referência do teste');
  await expect(preparation.getByRole('table', { name: 'Selecção de salários do lote', exact: true })).toContainText(/USD 3[\s.]?200,00/);
  await expect(preparation.getByRole('button', { name: /^Processar seleccionados/ })).toBeEnabled();
  await expect(preparation.getByRole('form', { name: 'Variáveis em lote' })).toHaveCount(0);
  await expect.poll(async () => Math.abs(await page.evaluate<number>('window.scrollY') - leftAt)).toBeLessThan(100);
  await preparation.getByRole('link', { name: 'Rever assiduidade', exact: true }).click();
  await expect(page).toHaveURL(/\/assiduidade\?/); await page.goBack();
  await expect(preparation).toBeVisible(); await page.reload();
  await expect(preparation.getByLabel('Câmbio USD→Kz', { exact: true })).toHaveValue('952');
  await page.goto('/processamento?mes=2026-10'); await expect(preparation).toHaveCount(0);
  await page.goBack(); await expect(preparation).toBeVisible();
  await preparation.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload(); await expect(preparation).toHaveCount(0);
  const opening = (await apiAs(owner.token, 'GET', '/v1/payroll-runs/opening?period=2026-09')).body;
  expect(opening.run).toBeNull(); expect(opening.variables).toEqual([]); expect(errors).toEqual([]);
});

test('simulador e orçamento conservam pressupostos ao visitar documentos', async ({ page, context }) => {
  const owner = await registerCompany(); await signIn(context, owner.token); const errors = watchErrors(page);
  await page.goto('/simulador');
  const target = page.getByLabel('Líquido pretendido (Kz)', { exact: true }); await target.fill('765432');
  await page.goto('/orcamento?ano=2027');
  await page.getByLabel('Aumento salarial (%)', { exact: true }).fill('9');
  await page.getByRole('button', { name: '+ Admissão', exact: true }).click();
  // O mapa só existe depois de o orçamento desenhar a tabela: abrir antes disso deixava-o fechado (teste instável).
  await expect(page.locator('details.map-disclosure').first()).toBeVisible();
  await openMaps(page);
  await expect(page.locator('details.map-disclosure[open]')).not.toHaveCount(0);
  await page.goto('/documentos');
  await page.goBack();
  await expect(page.getByLabel('Aumento salarial (%)', { exact: true })).toHaveValue('9');
  await expect(page.locator('details.map-disclosure[open]')).not.toHaveCount(0);
  await page.goto('/simulador'); await expect(target).toHaveValue('765432');
  expect(errors).toEqual([]);
});

test('copiloto retirado: o endereço antigo leva ao início e não há atalho no menu', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'modeling', 'valuation'] }); await signIn(context, owner.token);
  await page.goto('/copiloto?modulo=valuation');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: /Copiloto/ })).toHaveCount(0);
});
