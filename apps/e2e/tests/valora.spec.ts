import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors, valoraGo } from './support.js';

/** Kianda Valora: o protótipo aprovado a funcionar dentro da plataforma, com os dados no servidor. */
test.afterAll(closePool);

test('Valora: cria uma análise, edita o orçamento e os dados ficam no servidor depois de recarregar', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'valuation'] });
  await signIn(context, owner.token);
  const errors = watchErrors(page);

  await page.goto('/modulos');
  const card = page.locator('#valuation');
  await expect(card).toContainText('Kianda Valora');
  await expect(card).toContainText('Essencial · até 3 análise(s) activa(s)');
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
  // Menu recolhível: só o grupo do ecrã actual está aberto.
  await expect(page.locator('#nav .nav-group-toggle[aria-expanded="true"]')).toHaveCount(1);
  await expect(page.locator('#nav a[data-v="orcamento"]')).toBeHidden();
  await valoraGo(page, 'orcamento');
  await expect(page.locator('#nav .nav-group-toggle[aria-expanded="true"]')).toHaveText(/Planeamento/);
  await expect(page.locator('#nav a[data-v="visao"]')).toBeHidden();
  const vendas = page.locator('input[data-orc="vendas"]');
  await expect(vendas).toBeVisible();
  const before = await apiAs(owner.token, 'GET', '/v1/valuation/analyses');
  const id = before.body[0].id as string;
  // Montantes escritos em Kz com cêntimos; o modelo guarda milhões de Kz.
  await vendas.fill('12 345 000 000,50');
  await vendas.press('Tab');
  await expect(page.locator('#valoraSave')).toHaveText(/Gravad/, { timeout: 15_000 });
  const saved = await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`);
  expect(saved.body.data.orc.vendas).toBeCloseTo(12345.0000005, 9);
  expect(saved.body.revision).toBeGreaterThan(before.body[0].revision);
  await page.screenshot({ path: '/tmp/e2e/valora-02-orcamento.png', fullPage: false });

  await page.reload();
  await valoraGo(page, 'orcamento');
  await expect(page.locator('input[data-orc="vendas"]')).toHaveValue(/^12\s345\s000\s000,50$/);

  // Balancete mensal: unidade obrigatória, valores ao cêntimo, controlo antes de aplicar e desfazer.
  await valoraGo(page, 'dados');
  await page.locator('#paste').fill('conta;descricao;Jan\n61;Vendas;-1 000 000,25\n72;Pessoal;400 000,00\n43;Bancos;1 600 000,25\n51;Capital;-1 000 000,00');
  await page.locator('#btnParse').click();
  await expect(page.locator('#imp-prev')).toContainText('Indique a unidade');
  await page.locator('#impUnit').selectOption('kz');
  await expect(page.locator('#imp-prev')).toContainText('4 contas mapeadas');
  await expect(page.locator('#imp-prev')).toContainText(/1\s000\s000,25/);
  await page.locator('#btnApply').click();
  await expect(page.locator('#imp-prev')).toContainText('ao cêntimo');
  await expect.poll(async () => (await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`)).body.data.real.v61[0], { timeout: 15_000 }).toBeCloseTo(1.00000025, 10);
  expect((await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`)).body.data.fecho).toBe(1);
  await page.locator('#btnUndoImp').click();
  await expect(page.locator('#imp-prev')).toContainText('Importação desfeita');

  // Activos reais: editar um valor em Kz guarda o mesmo valor (sem multiplicar por um milhão).
  await valoraGo(page, 'ativos');
  const vc = page.locator('input[data-arr="imo"][data-i="0"][data-k="vc"]');
  await vc.fill('2 500 000,00');
  await vc.press('Tab');
  await expect.poll(async () => (await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`)).body.data.imo[0].vc, { timeout: 15_000 }).toBeCloseTo(2.5, 10);
  await expect(page.locator('input[data-arr="imo"][data-i="0"][data-k="vc"]')).toHaveValue(/^2\s500\s000,00$/);
  // A análise aberta fica identificada no cabeçalho mesmo em ecrãs de portátil.
  await expect(page.locator('#hdrEnt')).toBeVisible();

  // Versões anteriores: a primeira gravação guardou o estado de criação; repor pede confirmação e guarda o estado actual.
  await page.locator('#btnAnalyses').click();
  await page.locator('#vVersions').click();
  await expect(page.locator('#valoraDialogTitle')).toHaveText('Versões anteriores');
  const oldest = page.locator('[data-vversion]').last();
  await expect(page.locator('#valoraDialogBox')).toContainText('Antes de alterações');
  await oldest.click();
  await expect(oldest).toHaveText('Confirmar reposição');
  await oldest.click();
  await expect(page.locator('#valoraDialogBox')).toContainText('Versão reposta');
  const reverted = await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}`);
  expect(reverted.body.data.orc.vendas).not.toBeCloseTo(12345.0000005, 3);
  expect((await apiAs(owner.token, 'GET', `/v1/valuation/analyses/${id}/versions`)).body[0].reason).toBe('before_restore');
  await page.screenshot({ path: '/tmp/e2e/valora-05-versoes.png', fullPage: false });
  await page.locator('#valoraClose').click();

  // Avaliação e relatórios abrem sem erros; no período experimental não exporta.
  for (const view of ['demonstracoes', 'racios', 'dcf', 'sintese']) {
    if (await page.locator(`#nav a[data-v="${view}"]`).count()) { await valoraGo(page, view); await expect(page.locator(`#v-${view}`)).toHaveClass(/on/); }
  }
  await page.screenshot({ path: '/tmp/e2e/valora-03-avaliacao.png', fullPage: false });
  const relatorios = page.locator('#nav a[data-v="relatorios"]');
  if (await relatorios.count()) {
    await valoraGo(page, 'relatorios');
    const pdf = page.locator('[data-exp="pdf"]').first();
    if (await pdf.count()) { await pdf.click(); await expect(page.locator('#rep-msg')).toContainText('Pré-visualização'); }
  }
  // Sair para os outros módulos a partir do cabeçalho; o rodapé do menu fica sempre ao alcance (menu com scroll próprio).
  await page.setViewportSize({ width: 1366, height: 640 });
  await page.locator('aside .side-foot').scrollIntoViewIfNeeded();
  await expect(page.locator('aside .side-foot').getByRole('link', { name: 'Módulos e licenças' })).toBeInViewport();
  await expect(page.locator('aside .side-foot').getByRole('button', { name: 'Terminar sessão' })).toBeInViewport();
  await page.screenshot({ path: '/tmp/e2e/valora-04-sair.png', fullPage: false });
  await page.locator('header').getByRole('link', { name: 'Módulos e licenças' }).click();
  await expect(page).toHaveURL(/\/modulos$/);
  await expect(page.locator('#hr')).toContainText('Kianda RH');
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
  await valoraGo(page, 'relatorios');
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
  await expect(table).toContainText('3 análises activas');
  await expect(table).toContainText('Profissional');
  await expect(table).toContainText('1\u00a0324\u00a0980,00');
  const form = page.locator('.card', { hasText: 'Valora: subscrever, renovar ou mudar de plano' });
  await form.getByLabel('Plano do Valora').selectOption('corporate');
  await form.getByLabel('Pagamento').selectOption('annual');
  await expect(form).toContainText('743\u00a0580,00');
  await form.getByRole('button', { name: 'Gerar pedido de pagamento do Valora' }).click();
  await expect(page.getByText(/Valora · Corporate · até 20 análises/).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/e2e/valora-05-licenca.png', fullPage: false });
  const pending = await sql<{ amount_minor: string; tier_key: string }>(`select amount_minor, tier_key from payment_requests where company_id = $1 and kind = 'valuation_subscription' and status = 'pending'`, [owner.id]);
  expect(pending).toEqual([{ amount_minor: '74358000', tier_key: 'corporate' }]);
  expect(errors).toEqual([]);
});
