import { expect, test } from '@playwright/test';
import { fixtureWord } from '../../../packages/core/test/fixtures/document-import.js';
import { fixturePdf } from '../../web/test-fixtures/pdf.js';
import { apiAs, closePool, registerCompany, signIn, sql } from './support.js';

test.afterAll(closePool);

test('cadastro sem planos: NIF obrigatório, palavra-passe visível e confirmação antes dos módulos', async ({ page }) => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 10000)}`, email = `cadastro.${unique}@e2e.kianda.test`;
  await page.goto('/login');
  const password = page.getByLabel('Palavra-passe', { exact: true });
  await password.fill('PalavraSegura2026');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar palavra-passe', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('PalavraSegura2026');
  await page.getByRole('button', { name: 'Ocultar palavra-passe', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await page.goto('/registo?modulo=modeling&plano=unlimited&ciclo=annual');
  for (const label of ['Plano RH', 'Plano de Modelagem', 'Plano do Valora', 'Pagamento RH', 'Pagamento da Modelagem', 'Pagamento do Valora']) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  const nif = page.getByLabel('NIF da empresa *', { exact: true });
  await expect(nif).toHaveAttribute('required', '');
  await page.getByLabel('Denominação social').fill('Empresa cadastro E2E');
  await nif.fill('123');
  await page.getByLabel('Sector de actividade').selectOption('services');
  await page.getByLabel('Nome', { exact: true }).fill('Responsável E2E');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Palavra-passe', { exact: true }).fill('PalavraSegura2026');
  await page.getByLabel('Confirmar palavra-passe', { exact: true }).fill('PalavraSegura2026');
  await page.locator('input[name="terms"]').check();
  await page.getByRole('button', { name: 'Criar conta e experimentar', exact: true }).click();
  await expect(page).toHaveURL(/\/registo/);
  await nif.fill(unique.slice(-10));
  await page.getByRole('button', { name: 'Criar conta e experimentar', exact: true }).click();
  await expect(page).toHaveURL(/\/confirmar-email$/);
  await expect(page.getByRole('heading', { name: 'Confirme o seu email' })).toBeVisible();
  await expect(page.locator('body')).toContainText('30 dias');
  await page.getByRole('link', { name: '← Página inicial', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Cuide da sua equipa/ })).toBeVisible();
  await page.goto('/modelagem');
  await expect(page).toHaveURL(/\/confirmar-email$/);
  // Confirmação sintética para exercitar a passagem à escolha dos módulos; o token real tem testes API.
  await sql('update users set email_verified_at=now() where email=$1', [email]);
  await page.getByRole('button', { name: 'Já confirmei o email' }).click();
  await expect(page).toHaveURL(/\/modulos$/);
  for (const id of ['hr', 'modeling', 'valuation']) await expect(page.locator(`#${id}`)).toBeVisible();
});

test('modelos RH: importa Word e PDF, remove um ficheiro errado e emite segundo as cláusulas da empresa', async ({ page, context }) => {
  const owner = await registerCompany(); await signIn(context, owner.token);
  const employee = await apiAs(owner.token, 'POST', '/v1/employees', { number: '201', name: 'Amélia Modelo', jobTitle: 'Técnica', contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 } });
  expect(employee.status).toBe(201);
  await page.goto('/documentos/modelos/contrato_indeterminado');
  const editor = page.getByLabel('Texto do modelo', { exact: true }), original = await editor.inputValue();
  const input = page.getByLabel('Importar modelo da empresa', { exact: true });
  const clauses = [['# CONTRATO DA EMPRESA'], ['Entre {{empresa.nome}} e {{colaborador.nome}}.'], ['Clausula singular da empresa: transporte conforme acordo interno.']];
  const word = Buffer.from(fixtureWord(clauses));
  await input.setInputFiles({ name: 'modelo-empresa.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word });
  await expect(editor).toHaveValue(/Clausula singular da empresa/);
  await page.getByRole('button', { name: 'Remover importação', exact: true }).click();
  await expect(editor).toHaveValue(original);
  const pdf = fixturePdf([[{ str: 'Modelo PDF da empresa para {{colaborador.nome}}.', transform: [10, 0, 0, 10, 40, 760], width: 300, height: 10 }]]);
  await input.setInputFiles({ name: 'modelo-empresa.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await expect(editor).toHaveValue(/Modelo PDF da empresa/);
  await page.getByRole('button', { name: 'Remover importação', exact: true }).click();
  await expect(editor).toHaveValue(original);
  await input.setInputFiles({ name: 'modelo-empresa.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word });
  await expect(editor).toHaveValue(/Clausula singular da empresa/);
  await page.getByRole('button', { name: 'Gravar nova versão', exact: true }).click();
  await expect(page.getByText('Nova versão gravada e em uso na empresa.', { exact: true })).toBeVisible();
  const preview = await apiAs(owner.token, 'POST', '/v1/documents/preview', { employeeId: employee.body.id, templateKey: 'contrato_indeterminado', inputs: {} });
  expect(preview.status).toBe(200); expect(preview.body.missing).toEqual([]);
  expect(preview.body.text).toContain('Amélia Modelo'); expect(preview.body.text).toContain('Clausula singular da empresa');
  expect(preview.body.version).toBe('Empresa v1');
  // Uma segunda empresa continua a usar o modelo Kianda.
  const other = await registerCompany();
  const templates = await apiAs(other.token, 'GET', '/v1/document-templates');
  expect(templates.body.templates.find((t: { key: string }) => t.key === 'contrato_indeterminado').source).toBe('kianda');
});

test('mapas começam recolhidos e Ver abre a tabela no RH, Integra e Valora', async ({ page, context }) => {
  const owner = await registerCompany({ modules: ['hr', 'modeling', 'valuation'] }); await signIn(context, owner.token);
  expect((await apiAs(owner.token, 'POST', '/v1/employees', { number: '301', name: 'Pessoa do mapa', contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 } })).status).toBe(201);
  await page.goto('/processamento?mes=2026-10');
  await page.getByRole('button', { name: 'Preparar processamento' }).click();
  await expect(page.getByRole('button', { name: 'Recalcular' })).toBeVisible();
  let map = page.locator('details.map-disclosure').first();
  await expect(map).toBeVisible(); await expect(map).not.toHaveAttribute('open', '');
  await expect(map.locator('table')).toBeHidden();
  await map.locator('summary').click(); await expect(map.locator('table')).toBeVisible();
  await map.locator('summary').click(); await expect(map.locator('table')).toBeHidden();

  const tpl = (await apiAs(owner.token, 'GET', '/v1/modeling/templates/servicos')).body;
  expect((await apiAs(owner.token, 'POST', '/v1/modeling/models', { name: 'Mapas recolhidos', sector: 'servicos', currency: 'Kz', assumptions: tpl.assumptions })).status).toBe(201);
  await page.goto('/modelagem');
  const link = page.locator('#nav a[data-go="demonstracoes"]');
  if (!await link.isVisible()) await page.locator('#nav .nav-group', { has: link }).locator('.nav-group-toggle').click();
  await link.click();
  map = page.locator('#view details.map-disclosure').first();
  await expect(map.locator('table')).toBeHidden(); await map.locator('summary').click(); await expect(map.locator('table')).toBeVisible();

  await page.goto('/valora'); await page.locator('#valoraFirst').click();
  await page.locator('#vName').fill('Mapas da empresa'); await page.locator('#vEnt').fill('Empresa de mapas');
  await page.locator('#vStart').selectOption('example'); await page.locator('#vCreate').click();
  await expect(page.locator('#hdrEnt')).toHaveText('Empresa de mapas');
  const valora = page.locator('#nav a[data-v="demonstracoes"]');
  if (!await valora.isVisible()) await page.locator('#nav .nav-group', { has: valora }).locator('.nav-group-toggle').click();
  await valora.click();
  map = page.locator('#v-demonstracoes details.map-disclosure').first();
  await expect(map.locator('table')).toBeHidden(); await map.locator('summary').click(); await expect(map.locator('table')).toBeVisible();
});
