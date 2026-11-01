import { expect, test, type Page } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, sql, watchErrors, type Company } from './support.js';

/**
 * Integra: importação dos custos com pessoal do RH, aprovação e consulta de versões, PDF da versão
 * e participante restrito a um projecto. Empresa com RH e Modelagem; Modelagem paga (para exportar PDF).
 */
test.describe.configure({ mode: 'serial' });
let owner: Company, consultant: { id: string; token: string };
let modelA = '', modelB = '';
const BUDGET_YEAR = 2027, MONTHLY_COST_MINOR = 48_600_000_00; // 48,6 M Kz/mês → 583,2 M Kz/ano

test.beforeAll(async () => {
  owner = await registerCompany({ name: 'Consultoria Benguela E2E', modules: ['hr', 'modeling'] });
  await sql(`update company_modules set status='active', paid_until='2099-12-31' where company_id=$1 and module='modeling'`, [owner.id]);
  const tpl = (await apiAs(owner.token, 'GET', '/v1/modeling/templates/servicos')).body;
  // Ano base 2026 ⇒ ano 1 = 2027, o ano do orçamento.
  const assumptions = { ...tpl.assumptions, anoBase: 2026 };
  for (const [name, set] of [['Consultoria Luanda', (id: string) => { modelA = id; }], ['Expansão Benguela', (id: string) => { modelB = id; }]] as const) {
    const r = await apiAs(owner.token, 'POST', '/v1/modeling/models', { name, sector: 'servicos', currency: 'Kz', assumptions });
    expect(r.status, JSON.stringify(r.body)).toBe(201); set(r.body.id);
  }
  consultant = await addUser(owner, 'Consultor Externo');
  const [b] = await sql<{ id: string }>(`insert into personnel_budgets(company_id,year,created_by,status,approved_at) values ($1,$2,'e2e','approved',now()) returning id`, [owner.id, BUDGET_YEAR]);
  await sql(`insert into personnel_budget_lines(company_id,budget_id,period,headcount,gross_minor,cost_minor)
    select $1,$2,$3||'-'||lpad(m::text,2,'0'),42,4500000000,$4 from generate_series(1,12) m`, [owner.id, b!.id, String(BUDGET_YEAR), MONTHLY_COST_MINOR]);
});
test.afterAll(closePool);

async function openIntegra(page: Page, project = 'Expansão Benguela') {
  await page.goto('/modelagem');
  await page.waitForSelector('#mSel option', { state: 'attached' });
  if ((await page.locator('#mSel option:checked').textContent()) !== project) {
    await page.selectOption('#mSel', { label: project });
  }
  await expect(page.locator('#mSel option:checked')).toHaveText(project);
}
async function openCosts(page: Page) {
  await page.click('[data-go="pressupostos"]');
  await page.click('.tabs a:has-text("Custos")');
  await expect(page.locator('#assumption-pessoal')).toBeVisible();
}

test('importar do RH: orçamento aprovado substitui 72 · Custos com o pessoal do ano 1, com histórico', async ({ page, context }) => {
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await openIntegra(page); await openCosts(page);
  await expect(page.locator('#hrImportHint')).toContainText('manualmente');
  await page.click('[data-act="hrImport"]');
  await expect(page.locator('#hrBudget')).toContainText('2027 · 583 200 000 Kz');
  await expect(page.locator('#hrPreview')).toContainText('583 200 000,00 Kz');
  await expect(page.locator('#hrActualBox')).toBeHidden();
  await expect(page.locator('#hrPreview')).not.toContainText('O orçamento é de');
  await page.click('[data-act="hrImportApply"]');
  await expect(page.locator('#ov')).not.toHaveClass(/on/);
  await expect(page.locator('#assumption-pessoal')).toHaveValue('583200000');
  await expect(page.locator('#hrImportHint')).toContainText('Importado do RH: Orçamento de pessoal 2027');
  const detail = (await apiAs(owner.token, 'GET', `/v1/modeling/models/${modelB}`)).body;
  expect(detail.assumptions.pessoal).toBe(583_200_000);
  expect(detail.imports).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('versões: aprovar, descarregar o PDF aprovado, consultar em só leitura e voltar ao rascunho', async ({ page, context }) => {
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await openIntegra(page);
  await page.click('header [data-act="versions"]');
  await page.fill('#versionLabel', 'Comité de investimento');
  await page.click('[data-act="approveVersion"]');
  await expect(page.locator('#modal')).toContainText('Esta revisão já foi aprovada como v1 (Comité de investimento)');
  await expect(page.locator('#modal tbody tr').first()).toContainText('Dona E2E');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="versionPdf"]')]);
  expect(download.suggestedFilename()).toMatch(/-v1-sumario\.pdf$/);
  await page.click('#modal [data-act="close"]');

  // O rascunho muda depois da aprovação; a versão continua igual.
  await openCosts(page);
  await page.fill('#assumption-pessoal', '999000000'); await page.press('#assumption-pessoal', 'Tab');
  await expect.poll(async () => (await apiAs(owner.token, 'GET', `/v1/modeling/models/${modelB}`)).body.assumptions.pessoal).toBe(999_000_000);

  await page.click('header [data-act="versions"]');
  await expect(page.locator('#modal')).toContainText('O rascunho tem alterações posteriores');
  await page.click('[data-act="openVersion"]');
  const banner = page.locator('.alert:has-text("Versão aprovada v1")');
  await expect(banner).toContainText('aprovada por Dona E2E');
  await expect(banner).toContainText('reproduzem o cálculo aprovado');
  await expect(page.locator('#mSel option:checked')).toHaveText('Versão v1 · Expansão Benguela');
  await openCosts(page);
  await expect(page.locator('#assumption-pessoal')).toHaveValue('583200000');
  await expect(page.locator('#assumption-pessoal')).toBeDisabled();
  await expect(page.locator('[data-act="hrImport"]')).toHaveCount(0);

  await page.click('.alert [data-act="leaveVersion"]');
  await openCosts(page);
  await expect(page.locator('#assumption-pessoal')).toHaveValue('999000000');
  await expect(page.locator('#assumption-pessoal')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('participante restrito: o proprietário atribui um projecto em consulta e o consultor só vê esse', async ({ page, context, browser }) => {
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/licenca');
  await page.locator('form select').first().selectOption({ label: 'Consultor Externo' });
  await page.locator('label:has-text("Projectos") select').selectOption('selected');
  await page.check('input[aria-label="Atribuir Expansão Benguela"]');
  await page.selectOption('select[aria-label="Permissão em Expansão Benguela"]', 'viewer');
  await page.getByRole('button', { name: 'Gravar acesso à Modelagem' }).click();
  await expect(page.locator('table.dense tr', { hasText: 'Consultor Externo' })).toContainText('Expansão Benguela (Consulta)');

  const other = await browser.newContext();
  await signIn(other, consultant.token);
  const p2 = await other.newPage();
  const errors2 = watchErrors(p2);
  await p2.goto('/modelagem');
  await p2.waitForSelector('#mSel option', { state: 'attached' });
  expect(await p2.$$eval('#mSel option', (os) => os.map((o) => o.textContent))).toEqual(['Expansão Benguela', 'Gerir projectos…']);
  await openCosts(p2);
  await expect(p2.locator('#assumption-pessoal')).toBeDisabled();
  const beforeProbe = [...errors2];
  // Prova directa: o projecto não atribuído responde 404 (o navegador regista esse 404 na consola, como esperado).
  expect(await p2.evaluate(async (id) => (await fetch(`/api/v1/modeling/models/${id}`)).status, modelA)).toBe(404);
  await other.close();
  expect([...errors, ...beforeProbe]).toEqual([]);
});
