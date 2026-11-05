import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

test.afterAll(closePool);
async function fixture() {
  const owner = await registerCompany();
  const people: { id: string; name: string }[] = [];
  const add = async (name: string) => {
    const r = await apiAs(owner.token, 'POST', '/v1/employees', { number: String(people.length + 1), name, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2026-01-01', base: 100000 } });
    expect(r.status).toBe(201); people.push({ id: r.body.id, name }); return people.at(-1)!;
  };
  for (const name of ['Amélia Folha', 'Bento Folha', 'Carlos Folha']) await add(name);
  const sheet = async () => (await apiAs(owner.token, 'GET', '/v1/payroll-runs/opening?period=2026-09&batch=1')).body;
  return { owner, people, add, sheet };
}

test('lotes de salários na Folha incluem novos colaboradores e preservam os lotes anteriores', async ({ page, context }) => {
  const { owner, people, add, sheet } = await fixture(); await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-09');
  await page.getByRole('button', { name: 'Processar em lote', exact: true }).click();
  const selection = page.getByRole('region', { name: 'Colaboradores do processamento em lote', exact: true });
  await selection.getByRole('button', { name: 'Limpar selecção', exact: true }).click();
  for (const p of people.slice(0, 2)) await selection.getByRole('checkbox', { name: `Processar ${p.name}`, exact: true }).check();
  await page.getByRole('button', { name: 'Processar seleccionados', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lote concluído: 2');
  const before = (await sheet()).run.lines; expect(before).toHaveLength(2);
  expect((await apiAs(owner.token, 'GET', '/v1/payroll-variables?period=2026-09')).body).toEqual([]);
  const newcomer = await add('Diana Nova Admissão'); await page.reload();
  await page.getByRole('button', { name: 'Processar em lote', exact: true }).click();
  await expect(selection.getByRole('checkbox', { name: `Processar ${newcomer.name}`, exact: true })).toBeChecked();
  await expect(selection.getByRole('checkbox', { name: `Processar ${people[0]!.name}`, exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Processar seleccionados', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('4 no total');
  const complete = (await sheet()).run.lines; expect(complete).toHaveLength(4);
  for (const old of before) expect(complete.find((l: any) => l.employeeId === old.employeeId)).toEqual(old);
  expect(errors).toEqual([]);
});

test('no telefone a selecção cabe no ecrã e cancelar não calcula salários', async ({ page, context }) => {
  const { owner, sheet } = await fixture(); await signIn(context, owner.token);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/processamento?mes=2026-09');
  await page.getByRole('button', { name: 'Processar em lote', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Processar Amélia Folha', exact: true })).toBeChecked();
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Cancelar preparação', exact: true }).click();
  expect((await sheet()).run).toBeNull();
});
