import { expect, test } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

/** Acolhimento e saída: lista criada na admissão, tarefas marcadas por quem lhes cabe, modelos da empresa e portal. */
test.afterAll(closePool);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test('Acolhimento: o RH acompanha a lista, ajusta o modelo e o colaborador vê só as suas tarefas', async ({ page, context }) => {
  const owner = await registerCompany();
  const created = await apiAs(owner.token, 'POST', '/v1/employees', { number: '21', name: 'Joana Lutete', gender: 'F', jobTitle: 'Analista', province: 'Luanda', nif: '0000002121', contract: { type: 'indefinite', startDate: daysAgo(5), base: 350000, meal: 30000, transport: 25000 } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const joana = await addUser(owner, 'Joana Lutete', 'employee', created.body.id);

  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/acolhimento');
  await expect(page.getByRole('heading', { name: 'Acolhimento e saída', level: 1 })).toBeVisible();
  const row = page.locator('table', { has: page.getByRole('columnheader', { name: 'Progresso' }) }).getByRole('row', { name: /Joana Lutete/ });
  await expect(row).toContainText('Acolhimento');
  await expect(row).toContainText('em atraso');
  await page.screenshot({ path: '/tmp/e2e/acolhimento-01-listas.png', fullPage: false });

  await row.getByRole('link', { name: /Joana Lutete/ }).click();
  await expect(page.getByRole('heading', { name: 'Acolhimento · Joana Lutete' })).toBeVisible();
  const task = page.getByRole('row', { name: /Contrato de trabalho assinado/ });
  await task.getByRole('button', { name: 'Marcar como feita' }).click();
  await expect(task).toContainText('Feita por Dona E2E');
  await expect(page.locator('.kpi', { hasText: 'Feitas' })).toContainText('1 de 11');
  await page.screenshot({ path: '/tmp/e2e/acolhimento-02-lista.png', fullPage: false });

  await page.goto('/acolhimento?v=modelos');
  const model = page.getByLabel('Modelo de acolhimento');
  await model.getByRole('button', { name: 'Acrescentar tarefa' }).click();
  const last = await model.getByRole('textbox', { name: /^Tarefa \d+$/ }).count();
  await model.getByLabel(`Tarefa ${last}`, { exact: true }).fill('Visita às instalações e apresentação aos clientes');
  await model.getByLabel(`Responsável da tarefa ${last}`).selectOption('manager');
  await model.getByLabel(`Prazo da tarefa ${last}`).fill('2');
  await model.getByRole('button', { name: 'Gravar modelo' }).click();
  await expect(model).toContainText('Modelo gravado.');
  const templates = await apiAs(owner.token, 'GET', '/v1/checklist-templates');
  expect(templates.body[0].items.at(-1)).toMatchObject({ title: 'Visita às instalações e apresentação aos clientes', responsible: 'manager', offsetDays: 2 });
  await page.screenshot({ path: '/tmp/e2e/acolhimento-03-modelo.png', fullPage: false });

  await signIn(context, joana.token);
  await page.goto('/');
  await expect(page.getByRole('link', { name: /tarefas? por fazer/ })).toBeVisible();
  await page.goto('/acolhimento');
  await expect(page.getByRole('heading', { name: 'As minhas tarefas', level: 1 })).toBeVisible();
  const mine = page.locator('.card', { hasText: 'As minhas tarefas' }).getByRole('row');
  await expect(mine).toHaveCount(3); // cabeçalho + 2 tarefas do colaborador
  await mine.nth(1).getByRole('link').click();
  await expect(page.getByRole('row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Marcar como feita' }).first().click();
  await expect(page.locator('.kpi', { hasText: 'Feitas' })).toContainText('1 de 2');
  await page.screenshot({ path: '/tmp/e2e/acolhimento-04-colaborador.png', fullPage: false });
  expect(errors).toEqual([]);
});
