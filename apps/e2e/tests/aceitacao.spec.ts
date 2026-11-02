import { expect, test } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

/** Aceitação electrónica: o RH publica o regulamento; a colaboradora lê, aceita e a tarefa do acolhimento fica feita. */
test.afterAll(closePool);

test('Aceitação: publicar o regulamento interno, aceitar no portal e ver a prova', async ({ page, context }) => {
  const owner = await registerCompany();
  const emp = await apiAs(owner.token, 'POST', '/v1/employees', { number: '41', name: 'Teresa Ngola', gender: 'F', jobTitle: 'Contabilista', province: 'Luanda', nif: '0000004141', contract: { type: 'indefinite', startDate: new Date().toISOString().slice(0, 10), base: 400000, meal: 30000, transport: 25000 } });
  expect(emp.status, JSON.stringify(emp.body)).toBe(201);
  const teresa = await addUser(owner, 'Teresa Ngola', 'employee', emp.body.id);

  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/aceitacao');
  await page.getByRole('button', { name: 'Novo documento' }).click();
  await page.getByLabel('Título').fill('Regulamento interno');
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await expect(page.getByRole('heading', { name: 'Rascunho · versão 1' })).toBeVisible();
  await page.getByLabel('Texto do documento').fill('Artigo 1.º — Horário de trabalho: das 8h00 às 17h00, com uma hora de intervalo.\nArtigo 2.º — Uso obrigatório do cartão de identificação.');
  await page.screenshot({ path: '/tmp/e2e/aceitacao-01-rascunho.png', fullPage: false });
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Publicar para aceitação' }).click();
  await expect(page.locator('.kpi', { hasText: 'Aceites' })).toContainText('0 de 1');
  await expect(page.getByRole('row', { name: /Teresa Ngola/ })).toContainText('Por aceitar');

  await signIn(context, teresa.token);
  await page.goto('/');
  await page.getByRole('link', { name: /1 documento da empresa para ler e aceitar/ }).click();
  await page.getByRole('link', { name: 'Ler e aceitar', exact: true }).click();
  await expect(page.getByText('Artigo 2.º — Uso obrigatório do cartão de identificação.')).toBeVisible();
  const accept = page.getByRole('button', { name: 'Aceitar' });
  await expect(accept).toBeDisabled();
  await page.getByLabel(/Declaro que li o documento/).check();
  await page.screenshot({ path: '/tmp/e2e/aceitacao-02-ler.png', fullPage: false });
  await accept.click();
  await expect(page.getByRole('heading', { name: 'Prova da aceitação' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Aceite por/ })).toContainText('Teresa Ngola');
  await page.screenshot({ path: '/tmp/e2e/aceitacao-03-prova.png', fullPage: false });

  // O acolhimento da Teresa tinha «Ler e aceitar o regulamento interno»: ficou feita sozinha.
  await page.goto('/acolhimento');
  const mine = page.locator('.card', { hasText: 'As minhas tarefas' });
  await expect(mine).not.toContainText('regulamento interno');

  await signIn(context, owner.token);
  await page.goto('/aceitacao');
  await expect(page.getByRole('row', { name: /Regulamento interno/ })).toContainText('1 de 1');
  await page.screenshot({ path: '/tmp/e2e/aceitacao-04-rh.png', fullPage: false });
  expect(errors).toEqual([]);
});
