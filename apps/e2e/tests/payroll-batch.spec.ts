import { expect, test } from '@playwright/test';
import { apiAs, closePool, openMaps, registerCompany, signIn, sql, watchErrors, type Company } from './support.js';

test.afterAll(closePool);
async function team() {
  const owner = await registerCompany();
  const people: { id: string; name: string }[] = [];
  for (const [i, name] of ['Amélia Lote', 'Bento Lote', 'Carla Sem Prémio'].entries()) {
    const p = await apiAs(owner.token, 'POST', '/v1/employees', { number: String(i + 1), name, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 100000 } });
    expect(p.status).toBe(201); people.push({ id: p.body.id, name });
  }
  return { owner, people };
}
const vars = async (owner: Company) => (await apiAs(owner.token, 'GET', '/v1/payroll-variables?period=2026-10')).body;

test('lote de prémios calcula a equipa e distingue INSS do trabalhador e da empresa na folha e no recibo', async ({ page, context }) => {
  const { owner, people } = await team(); await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-10&s=variaveis');
  await page.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const form = page.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await form.getByLabel('Descrição do lote', { exact: true }).fill('Prémio da equipa');
  for (const p of people.slice(0, 2)) await form.getByRole('checkbox', { name: `Seleccionar ${p.name}`, exact: true }).check();
  await form.getByLabel('Valor comum (Kz)', { exact: true }).fill('10000');
  await form.getByRole('button', { name: 'Aplicar valor aos seleccionados', exact: true }).click();
  await form.getByRole('textbox', { name: `Valor de ${people[1]!.name}`, exact: true }).fill('20000');
  await form.getByRole('button', { name: 'Guardar lote', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lote guardado: 2');
  expect(await vars(owner)).toHaveLength(2);
  await page.goto('/processamento?mes=2026-10');
  await page.getByRole('button', { name: 'Preparar processamento', exact: true }).click();
  await page.getByRole('button', { name: 'Calcular folha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'INSS do trabalhador' })).toContainText(/9[\s.]900,00/);
  await expect(page.locator('.kpi').filter({ hasText: 'INSS da empresa' })).toContainText(/26[\s.]400,00/);
  await expect(page.locator('.kpi').filter({ hasText: 'Líquido a pagar' })).toContainText(/320[\s.]100,00/);
  await expect(page.locator('.kpi').filter({ hasText: 'Custo total empresa' })).toContainText(/356[\s.]400,00/);
  await openMaps(page);
  await expect(page.getByRole('columnheader', { name: 'INSS trabalhador', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'INSS empresa', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Carla Sem Prémio/ })).toBeVisible();
  await page.getByRole('row', { name: /Amélia Lote/ }).getByRole('link', { name: 'Recibo', exact: true }).click();
  const deductions = page.getByRole('table', { name: 'Descontos do trabalhador', exact: true });
  await expect(deductions).toContainText(/Segurança Social \(3%\)/);
  await expect(deductions).not.toContainText('INSS entidade empregadora');
  await expect(page.locator('.payslip .net')).toContainText(/106[\s.]700,00/);
  await expect(page.locator('.payslip')).toContainText(/Encargos da entidade empregadora \(não descontados\)/);
  expect(errors).toEqual([]);
});

test('cancelar um lote por guardar deixa as variáveis e o processamento intactos', async ({ page, context }) => {
  const { owner, people } = await team(); await signIn(context, owner.token);
  await page.goto('/processamento?mes=2026-10&s=variaveis');
  await page.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const form = page.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await form.getByRole('checkbox', { name: `Seleccionar ${people[0]!.name}`, exact: true }).check();
  await form.getByRole('textbox', { name: `Valor de ${people[0]!.name}`, exact: true }).fill('5000');
  await form.getByRole('button', { name: 'Cancelar lote', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await vars(owner)).toEqual([]);
  expect((await apiAs(owner.token, 'GET', '/v1/payroll-runs?period=2026-10')).body).toEqual([]);
});

test('selecção e valores de colaboradores noutras páginas pertencem ao mesmo lote', async ({ page, context }) => {
  const owner = await registerCompany();
  await sql(`insert into employees(company_id,number,name,job_title) select $1, g::text, 'Pessoa '||g, 'Técnico' from generate_series(1,51) g`, [owner.id]);
  await sql(`insert into contracts(employee_id,type,start_date,base_minor) select id,'indefinite','2026-01-01',10000000 from employees where company_id=$1`, [owner.id]);
  await signIn(context, owner.token);
  await page.goto('/processamento?mes=2026-10&s=variaveis');
  await page.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const form = page.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await form.getByLabel('Descrição do lote', { exact: true }).fill('Prémios em duas páginas');
  await expect(form.getByRole('checkbox', { name: /^Seleccionar / })).toHaveCount(50);
  await form.getByRole('checkbox', { name: /^Seleccionar / }).first().check();
  await form.getByRole('textbox', { name: /^Valor de / }).first().fill('1000');
  await form.getByRole('button', { name: 'Seguinte', exact: true }).click();
  await expect(form.getByRole('checkbox', { name: /^Seleccionar / })).toHaveCount(1);
  await form.getByRole('checkbox', { name: /^Seleccionar / }).check();
  await form.getByRole('textbox', { name: /^Valor de / }).fill('2000');
  await form.getByRole('button', { name: 'Guardar lote', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lote guardado: 2');
  const saved = await vars(owner);
  expect(saved.map((v: any) => v.amountMinor).sort((a: number, b: number) => a - b)).toEqual([100000, 200000]);
});
