import { expect, test } from '@playwright/test';
import { apiAs, closePool, openMaps, registerCompany, signIn, watchErrors } from './support.js';

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

test('lote de alterações vazio não bloqueia a remuneração habitual nem os meses seguintes', async ({ page, context }) => {
  const { owner, sheet } = await fixture(); await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-09');
  await page.getByRole('button', { name: 'Preparar processamento', exact: true }).click();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento' });
  await expect(preparation.getByRole('region', { name: 'Remunerações habituais do mês' })).toBeVisible();
  await expect(preparation.getByRole('form', { name: 'Variável do processamento' })).toHaveCount(0);
  const calculate = preparation.getByRole('button', { name: 'Calcular folha', exact: true });
  await expect(calculate).toBeEnabled();
  await preparation.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const optional = preparation.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await optional.getByRole('button', { name: 'Seleccionar resultados (3)', exact: true }).click();
  await optional.getByRole('checkbox', { name: 'Incide INSS', exact: true }).uncheck();
  await expect(optional.getByRole('button', { name: 'Guardar lote', exact: true })).toBeDisabled();
  await expect(calculate).toBeEnabled(); await calculate.click();
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toBeVisible();
  const september = (await sheet()).run.lines;
  expect((await apiAs(owner.token, 'GET', '/v1/payroll-variables?period=2026-09')).body).toEqual([]);
  await page.goto('/processamento?mes=2026-10');
  await page.getByRole('button', { name: 'Processar em lote', exact: true }).click();
  await page.getByRole('button', { name: 'Processar seleccionados', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Lote concluído: 3');
  const october = (await apiAs(owner.token, 'GET', '/v1/payroll-runs/opening?period=2026-10')).body;
  expect(october.variables).toEqual([]);
  for (const old of september) expect(october.run.lines.find((l: any) => l.employeeId === old.employeeId)).toMatchObject({ grossMinor: old.grossMinor, netMinor: old.netMinor });
  expect(errors).toEqual([]);
});

test('edita alterações guardadas e descarta ou cancela alterações incompletas', async ({ page, context }) => {
  const { owner, people, sheet } = await fixture();
  expect((await apiAs(owner.token, 'POST', '/v1/payroll-variables', { employeeId: people[0]!.id, period: '2026-09', kind: 'bonus', label: 'Prémio pontual', amount: 10000 })).status).toBe(201);
  expect((await apiAs(owner.token, 'POST', '/v1/payroll-runs', { period: '2026-09' })).status).toBe(201);
  await signIn(context, owner.token); const errors = watchErrors(page);
  await page.goto('/processamento?mes=2026-09&s=variaveis'); await openMaps(page);
  await page.getByRole('row').filter({ hasText: 'Prémio pontual' }).getByRole('button', { name: 'Editar', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Editar alteração do mês', exact: true });
  await editor.getByLabel('Valor (Kz)', { exact: true }).fill('2000');
  await editor.getByRole('button', { name: 'Guardar alteração', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Recalcular', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Folha calculada: 3');
  expect((await sheet()).run.lines.find((l: any) => l.employeeId === people[0]!.id).grossMinor).toBe(10200000);
  await page.getByRole('button', { name: 'Rever preparação', exact: true }).click();
  const preparation = page.getByRole('region', { name: 'Preparação do processamento' });
  await preparation.getByRole('button', { name: 'Lançar em lote', exact: true }).click();
  const optional = preparation.getByRole('form', { name: 'Variáveis em lote', exact: true });
  await optional.getByRole('button', { name: 'Seleccionar resultados (3)', exact: true }).click();
  await optional.getByLabel('Valor comum (Kz)', { exact: true }).fill('5000');
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeDisabled();
  await preparation.getByRole('button', { name: 'Descartar alteração por guardar', exact: true }).click();
  await expect(preparation.getByRole('button', { name: 'Calcular folha', exact: true })).toBeEnabled();
  await preparation.getByRole('button', { name: 'Lançar variável', exact: true }).click();
  await preparation.getByLabel('Valor (Kz)', { exact: true }).fill('7000');
  await preparation.getByRole('button', { name: 'Cancelar preparação', exact: true }).click();
  await expect(preparation).toHaveCount(0);
  const saved = (await apiAs(owner.token, 'GET', '/v1/payroll-variables?period=2026-09')).body;
  expect(saved).toHaveLength(1); expect(saved[0].amountMinor).toBe(200000); expect(errors).toEqual([]);
});
