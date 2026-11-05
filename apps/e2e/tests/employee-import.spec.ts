import { expect, test } from '@playwright/test';
import { xlsx } from '../../api/src/lib/xlsx';
import { apiAs, registerCompany, signIn, watchErrors } from './support';
test('uma empresa migra o Excel, remove a prévia errada e confirma as fichas sem duplicados', async ({ page, context }) => {
  const company = await registerCompany(), errors = watchErrors(page);
  const bytes = xlsx([
    { name: 'Orientações', rows: [['Instruções da empresa']] },
    { name: 'Pessoal', rows: [['Folha de pessoal'], ['N.º mecanográfico', 'Nome', 'Função', 'Data de admissão', 'Salário base'], ['0001', 'Ana Migração', 'Técnica', '2024-03-04', 150000], ['0002', 'Bento Migração', 'Técnico', '2024-05-01', 170000]] },
  ]);
  await signIn(context, company.token);
  await page.goto('/colaboradores');
  await page.getByRole('link', { name: 'Importar colaboradores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Importar colaboradores', exact: true })).toBeVisible();
  const upload = async () => {
    await page.getByLabel('Ficheiro de colaboradores').setInputFiles({ name: 'Pessoal.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
    await page.getByLabel('Folha do Excel').selectOption('1');
    await expect(page.getByLabel('Coluna: Nome completo', { exact: true })).toHaveValue('1');
    await page.getByRole('button', { name: 'Validar e pré-visualizar', exact: true }).click();
    await expect(page.getByRole('heading', { name: '4. Rever e importar' })).toBeVisible();
  };
  await upload();
  expect((await apiAs(company.token, 'GET', '/v1/employees')).body).toHaveLength(0);
  await page.getByRole('button', { name: 'Remover documento', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4. Rever e importar' })).toHaveCount(0);
  expect((await apiAs(company.token, 'GET', '/v1/employees')).body).toHaveLength(0);
  await upload();
  await page.getByRole('checkbox', { name: /Revi a pré-visualização/ }).check();
  await page.getByRole('button', { name: 'Confirmar importação de 2 colaboradores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
  const people = (await apiAs(company.token, 'GET', '/v1/employees')).body;
  expect(people.map((e: any) => e.number)).toEqual(['0001', '0002']);
  expect(people.map((e: any) => e.contract.baseMinor)).toEqual([15000000, 17000000]);
  await page.getByRole('link', { name: 'Ver colaboradores', exact: true }).click();
  await expect(page.getByRole('link', { name: /Ana Migração/ })).toBeVisible();
  expect(errors).toEqual([]);
});
