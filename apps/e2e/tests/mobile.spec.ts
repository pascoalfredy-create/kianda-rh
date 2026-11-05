import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors, valoraGo } from './support.js';
import { fixtureWord } from '../../../packages/core/test/fixtures/document-import.js';

/** Telemóvel (Pixel 7): navegação do RH e Integra com menu, versões em cartões e acções visíveis. */
test.afterAll(closePool);

test('portal de candidatura no telefone: abre o link sem conta e recebe CV Word sem alargar o ecrã', async ({ page }) => {
  const owner = await registerCompany();
  const o = await apiAs(owner.token, 'POST', '/v1/openings', { title: 'Técnico de recrutamento móvel', status: 'open', isPublic: true });
  expect(o.status).toBe(201); await page.goto(o.body.publicPath);
  await expect(page.getByRole('heading', { name: 'Técnico de recrutamento móvel', exact: true })).toBeVisible();
  await page.getByLabel('Nome completo', { exact: true }).fill('Candidata Telemóvel');
  await page.getByLabel('Email', { exact: true }).fill(`mobile.${Date.now()}@e2e.kianda.test`);
  await page.getByLabel('Telefone', { exact: true }).fill('923000444');
  await page.getByLabel('Currículo (CV)', { exact: true }).setInputFiles({ name: 'curriculo-telemovel.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(fixtureWord([['CV sintético no telefone']])) });
  await page.getByText('Dados profissionais (opcional)', { exact: true }).click();
  await page.getByLabel('Função actual', { exact: true }).fill('Técnica');
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await page.getByLabel('Autorizo o tratamento dos meus dados para este processo de recrutamento.', { exact: true }).check();
  await page.getByRole('button', { name: 'Enviar candidatura', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Candidatura recebida');
  expect((await apiAs(owner.token, 'GET', `/v1/openings/${o.body.id}`)).body.candidates).toHaveLength(1);
});

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

test('RH no telemóvel: preparar mostra os campos e calcula sem alargar o ecrã', async ({ page, context }) => {
  const company = await registerCompany({ name: 'Preparação no telemóvel' });
  const employee = await apiAs(company.token, 'POST', '/v1/employees', { number: '1', name: 'Pessoa Mobile', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 } });
  expect(employee.status, JSON.stringify(employee.body)).toBe(201);
  await signIn(context, company.token);
  const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-10');
  await page.getByRole('button', { name: 'Preparar processamento' }).click();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento' });
  await expect(preparation.getByRole('region', { name: 'Remunerações habituais do mês' })).toBeVisible();
  await expect(preparation.getByLabel('Valor (Kz)')).toHaveCount(0);
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeEnabled();
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/e2e/rh-preparar-telemovel.png', fullPage: true });
  await preparation.getByRole('button', { name: 'Calcular folha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('RH no telemóvel: lote de variáveis mantém os campos utilizáveis e grava a selecção', async ({ page, context }) => {
  const owner = await registerCompany();
  const employee = await apiAs(owner.token, 'POST', '/v1/employees', { number: '1', name: 'Pessoa do lote móvel', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 100000 } });
  expect(employee.status).toBe(201); await signIn(context, owner.token);
  await page.goto('/processamento?mes=2026-10');
  await page.getByRole('button', { name: 'Preparar processamento', exact: true }).click();
  await page.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const form = page.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await form.getByLabel('Descrição do lote', { exact: true }).fill('Prémio no telefone');
  await form.getByRole('checkbox', { name: 'Seleccionar Pessoa do lote móvel', exact: true }).check();
  await form.getByLabel('Valor comum (Kz)', { exact: true }).fill('10000');
  await form.getByRole('button', { name: 'Aplicar valor aos seleccionados', exact: true }).click();
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await form.getByRole('button', { name: 'Guardar lote', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lote guardado: 1');
  await page.getByRole('button', { name: 'Calcular folha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeVisible();
});

test('RH no telemóvel: corrigir a remuneração mostra os campos e actualiza a ficha', async ({ page, context }) => {
  const company = await registerCompany();
  const employee = await apiAs(company.token, 'POST', '/v1/employees', { number: '1', name: 'Correcção no telefone', jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-11-01', base: 285600000, currency: 'USD', baseUsd: 300000 } });
  expect(employee.status).toBe(201);
  await signIn(context, company.token);
  await page.goto(`/colaboradores/${employee.body.id}?s=contrato`);
  await page.getByRole('button', { name: 'Corrigir erro de registo', exact: true }).click();
  const form = page.getByRole('form', { name: 'Correcção de remuneração', exact: true });
  await expect(form.getByLabel('Registo a corrigir')).toBeVisible();
  await form.getByLabel('Salário base (USD)', { exact: true }).fill('3000');
  await form.getByLabel('Justificação da correcção', { exact: true }).fill('Zeros a mais no registo');
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await form.getByRole('button', { name: 'Guardar correcção', exact: true }).click();
  await expect(page.locator('.hero .facts')).toContainText(/USD 3[\s.]000,00/);
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
