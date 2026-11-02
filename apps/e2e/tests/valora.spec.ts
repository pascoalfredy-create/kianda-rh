import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors } from './support.js';

/** Kianda Valora: o protótipo aprovado a funcionar dentro da plataforma, com os dados no servidor. */
test.afterAll(closePool);

test('Valora: cria uma análise, edita o orçamento e os dados ficam no servidor depois de recarregar', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'valuation'] });
  await signIn(context, owner.token);
  const errors = watchErrors(page);

  await page.goto('/modulos');
  const card = page.locator('#valuation');
  await expect(card).toContainText('Kianda Valora');
  await expect(card).toContainText('Essencial · até 10 análise(s) activa(s)');
  await card.getByRole('link', { name: 'Abrir módulo' }).click();

  await expect(page).toHaveURL(/\/valora$/);
  await expect(page.locator('.valora-banner[role="status"]').first()).toContainText('Avaliação gratuita');
  await page.locator('#valoraFirst').click();
  await page.locator('#vName').fill('Orçamento e avaliação E2E');
  await page.locator('#vEnt').fill('Kalunga Distribuição, S.A.');
  await page.locator('#vStart').selectOption('example');
  await page.locator('#vCreate').click();
  await expect(page.locator('#hdrEnt')).toHaveText('Kalunga Distribuição, S.A.');
  await page.screenshot({ path: '/tmp/e2e/valora-01-visao.png', fullPage: false });

  // Orçamento: alterar as vendas anuais recalcula e grava no servidor (com revisão).
  await page.locator('#nav a[data-v="orcamento"]').click();
  const vendas = page.locator('input[data-orc="vendas"]');
  await expect(vendas).toBeVisible();
  const before = await apiAs(owner.token, 'GET', '/v1/valuation/analyses');
  const id = before.body[0].id as string;
  await vendas.fill('12345');
  await vendas.press('Tab');
  await expect(page.locator('#valoraSave')).toHaveText(/Gravad/, { timeout: 15_000 });
  const saved = await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`);
  expect(saved.body.data.orc.vendas).toBe(12345);
  expect(saved.body.revision).toBeGreaterThan(before.body[0].revision);
  await page.screenshot({ path: '/tmp/e2e/valora-02-orcamento.png', fullPage: false });

  await page.reload();
  await page.locator('#nav a[data-v="orcamento"]').click();
  await expect(page.locator('input[data-orc="vendas"]')).toHaveValue('12345');

  // Avaliação e relatórios abrem sem erros; no período experimental não exporta.
  for (const view of ['demonstracoes', 'racios', 'dcf', 'sintese']) {
    const link = page.locator(`#nav a[data-v="${view}"]`);
    if (await link.count()) { await link.click(); await expect(page.locator(`#v-${view}`)).toHaveClass(/on/); }
  }
  await page.screenshot({ path: '/tmp/e2e/valora-03-avaliacao.png', fullPage: false });
  const relatorios = page.locator('#nav a[data-v="relatorios"]');
  if (await relatorios.count()) {
    await relatorios.click();
    const pdf = page.locator('[data-exp="pdf"]').first();
    if (await pdf.count()) { await pdf.click(); await expect(page.locator('#rep-msg')).toContainText('Pré-visualização'); }
  }
  expect(errors).toEqual([]);
});

test('Valora: com licença paga exporta o relatório em PDF descarregado no navegador', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['valuation'] });
  await sql(`update company_modules set status = 'active', paid_until = '2099-12-31' where company_id = $1 and module = 'valuation'`, [owner.id]);
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/valora');
  await page.locator('#valoraFirst').click();
  await page.locator('#vName').fill('Avaliação paga');
  await page.locator('#vEnt').fill('Entidade Paga, Lda.');
  await page.locator('#vStart').selectOption('example');
  await page.locator('#vCreate').click();
  await expect(page.locator('#hdrEnt')).toHaveText('Entidade Paga, Lda.');
  await page.locator('#nav a[data-v="relatorios"]').click();
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('[data-exp="pdf"]').first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Relatorio_de_gestao_mensal_Entidade_\d{4}-\d{2}-\d{2}\.pdf$/);
  await page.screenshot({ path: '/tmp/e2e/valora-04-relatorios.png', fullPage: false });
  for (const [kind, ext] of [['docx', 'docx'], ['xlsx', 'xlsx']] as const) {
    const next = page.waitForEvent('download', { timeout: 30_000 });
    await page.locator(`[data-exp="${kind}"]`).first().click();
    expect((await next).suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
  }
  expect(errors).toEqual([]);
});

test('Valora: sem licença, a entrada leva aos módulos e a API recusa', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr'] });
  await signIn(context, owner.token);
  await page.goto('/valora');
  await expect(page).toHaveURL(/\/modulos#valuation$/);
  await expect(page.locator('#valuation')).toContainText('Não subscrito');
  expect((await apiAs(owner.token, 'GET', '/v1/valuation/bootstrap')).status).toBe(403);
});

test('Valora: na licença, tabela de preços e pedido de pagamento do plano escolhido', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'valuation'] });
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/licenca#valuation');
  const table = page.locator('.card', { hasText: 'Tabela de preços · Kianda Valora' });
  await expect(table).toContainText('Essencial');
  await expect(table).toContainText('10 análises activas');
  await expect(table).toContainText('Grandes Empresas (Ilimitado)');
  await expect(table).toContainText('1\u00a0050\u00a0590,00');
  const form = page.locator('.card', { hasText: 'Valora: subscrever, renovar ou mudar de plano' });
  await form.getByLabel('Plano do Valora').selectOption('corporate');
  await form.getByLabel('Pagamento').selectOption('annual');
  await expect(form).toContainText('743\u00a0580,00');
  await form.getByRole('button', { name: 'Gerar pedido de pagamento do Valora' }).click();
  await expect(page.getByText(/Valora · Corporate · até 30 análises/).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/e2e/valora-05-licenca.png', fullPage: false });
  const pending = await sql<{ amount_minor: string; tier_key: string }>(`select amount_minor, tier_key from payment_requests where company_id = $1 and kind = 'valuation_subscription' and status = 'pending'`, [owner.id]);
  expect(pending).toEqual([{ amount_minor: '74358000', tier_key: 'corporate' }]);
  expect(errors).toEqual([]);
});
