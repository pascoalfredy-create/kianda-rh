import { expect, test } from '@playwright/test';
import { apiAs, closePool, openMaps, registerCompany, signIn, watchErrors, type Company } from './support.js';

/** Ecrãs do RH para o proprietário de uma empresa nova (com dois colaboradores). */
const ROUTES = [
  '/', '/colaboradores', '/organograma', '/assiduidade', '/turnos', '/turnos?v=tipos', '/turnos?vista=mes', '/ausencias', '/processamento', '/obrigacoes', '/relatorios', '/analitica', '/bi',
  '/orcamento', '/financas', '/tesouraria', '/conciliacao', '/despesas', '/adiantamentos', '/documentos', '/recrutamento', '/desempenho',
  '/cessacoes', '/simulador', '/acessos', '/pedidos', '/sector', '/conformidade', '/definicoes', '/licenca', '/modulos', '/conta',
];

test('o simulador abre em Salários e Voltar regressa à página anterior sem terminar sessão', async ({ page, context }) => {
  const owner = await registerCompany();
  await signIn(context, owner.token);
  await page.goto('/colaboradores');
  await page.getByRole('button', { name: 'Salários', exact: true }).click();
  await page.getByRole('link', { name: 'Simulador salarial', exact: true }).click();
  await expect(page).toHaveURL(/\/simulador$/);
  await expect(page.getByRole('heading', { name: 'Simulador salarial' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar à página anterior', exact: true }).click();
  await expect(page).toHaveURL(/\/colaboradores$/);
  await expect(page.getByRole('heading', { name: 'Colaboradores', exact: true })).toBeVisible();
});

test.describe.configure({ mode: 'serial' });
let company: Company;
const people = [
  { number: '101', name: 'Amélia Kiluanje', jobTitle: 'Contabilista', base: 450000 },
  { number: '102', name: 'Bento Ndala', jobTitle: 'Técnico de Logística', base: 320000 },
];

test.beforeAll(async () => {
  company = await registerCompany({ name: 'Logística Kwanza E2E' });
  for (const p of people) {
    const r = await apiAs(company.token, 'POST', '/v1/employees', { number: p.number, name: p.name, gender: 'F', jobTitle: p.jobTitle, province: 'Luanda', nif: '00' + p.number.padStart(8, '0'),
      contract: { type: 'indefinite', startDate: '2026-01-05', base: p.base, meal: 30000, transport: 25000 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
});
test.afterAll(closePool);

test('todos os ecrãs do RH abrem sem erro de servidor nem de JavaScript', async ({ page, context }) => {
  await signIn(context, company.token);
  const errors = watchErrors(page);
  for (const route of ROUTES) {
    const res = await page.goto(route);
    expect(res, route).not.toBeNull();
    expect(res!.status(), `${route} respondeu ${res!.status()}`).toBeLessThan(400);
    await expect(page.locator('body'), route).not.toContainText(/Application error|Erro interno|Internal Server Error/);
    expect(page.url(), `${route} enviou para o login`).not.toContain('/login');
  }
  expect(errors).toEqual([]);
});

test('colaboradores: lista e ficha com contrato', async ({ page, context }) => {
  await signIn(context, company.token);
  const errors = watchErrors(page);
  await page.goto('/colaboradores');
  for (const p of people) await expect(page.getByText(p.name).first()).toBeVisible();
  // A ficha abre num painel lateral sobre a lista (?ficha=<id>).
  await page.getByText(people[0]!.name).first().click();
  await expect(page).toHaveURL(/ficha=[0-9a-f-]{36}/);
  await expect(page.locator('body')).toContainText(people[0]!.jobTitle);
  await expect(page.locator('body')).toContainText(/450[\s. ]?000/);
  expect(errors).toEqual([]);
});

test('processamento salarial: preparar abre os campos, guarda um prémio e só depois calcula a folha', async ({ page, context }) => {
  await signIn(context, company.token);
  const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-10');
  await expect(page.locator('body')).toContainText(/Outubro/i);
  await page.getByRole('button', { name: 'Preparar processamento' }).click();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento' });
  await expect(preparation).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeHidden();
  expect((await apiAs(company.token, 'GET', '/v1/payroll-runs?period=2026-10')).body).toEqual([]);
  const variable = preparation.getByRole('form', { name: 'Variável do processamento' });
  await expect(variable.getByLabel('Colaborador')).toBeVisible();
  await variable.getByLabel('Colaborador').selectOption({ label: people[0]!.name });
  await variable.getByLabel('Valor (Kz)').fill('12000');
  await variable.getByLabel('Descrição').fill('Prémio do mês');
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeDisabled();
  await variable.getByRole('button', { name: 'Lançar', exact: true }).click();
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeEnabled();
  await preparation.getByRole('button', { name: 'Calcular folha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recalcular' })).toBeVisible();
  await expect(page.locator('details.map-disclosure').filter({ hasText: 'Mapa de processamento salarial' })).toBeVisible();
  await openMaps(page);
  for (const p of people) await expect(page.getByText(p.name).first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(people[0]!.name) })).toContainText('12.000,00');
  await expect(page.getByRole('row', { name: new RegExp(people[1]!.name) })).not.toContainText('12.000,00');
  await expect(page.getByRole('button', { name: 'Recalcular' })).toBeVisible();
  await page.getByRole('button', { name: 'Rever preparação', exact: true }).click();
  await expect(preparation.getByRole('form', { name: 'Variável do processamento' })).toBeVisible();
  await expect(preparation).toContainText('1 variável guardada');
  expect(errors).toEqual([]);
});

test('cancelar a preparação não cria uma folha nem guarda variáveis por preencher', async ({ page, context }) => {
  await signIn(context, company.token);
  await page.goto('/processamento?mes=2026-09');
  await page.getByRole('button', { name: 'Preparar processamento' }).click();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento' });
  const variable = preparation.getByRole('form', { name: 'Variável do processamento' });
  await variable.getByLabel('Valor (Kz)').fill('9000');
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeDisabled();
  await variable.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await preparation.getByRole('button', { name: 'Cancelar preparação', exact: true }).click();
  await expect(preparation).toBeHidden();
  expect((await apiAs(company.token, 'GET', '/v1/payroll-runs?period=2026-09')).body).toEqual([]);
  expect((await apiAs(company.token, 'GET', '/v1/payroll-variables?period=2026-09')).body).toEqual([]);
});
