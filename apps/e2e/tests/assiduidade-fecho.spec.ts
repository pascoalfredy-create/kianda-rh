import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, sql, watchErrors } from './support.js';

test.afterAll(closePool);

test('fecho da assiduidade obriga a classificar os dias sem registo e lança as faltas', async ({ page, context }) => {
  const owner = await registerCompany();
  const e = await apiAs(owner.token, 'POST', '/v1/employees', {
    number: '1',
    name: 'Pessoa do Ponto',
    jobTitle: 'Técnico',
    contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 },
  });
  expect(e.status).toBe(201);
  await sql(
    `insert into attendance_entries(company_id, employee_id, work_date, clock_in, clock_out, source, created_by)
    select $1, $2, d::date, d + interval '8 hour', d + interval '16 hour', 'web', $2 from generate_series('2026-09-01'::timestamptz, '2026-09-30'::timestamptz, interval '1 day') d
    where extract(isodow from d) < 6 and d::date not in ('2026-09-14', '2026-09-15')`,
    [owner.id, e.body.id],
  );
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto(`/assiduidade/${e.body.id}?mes=2026-09`);
  const approve = page.getByRole('button', { name: 'Aprovar mês', exact: true });
  await expect(page.getByText(/dia\(s\) útil\(eis\) sem registo de ponto nem ausência/)).toBeVisible();
  await expect(approve).toBeDisabled();
  await page.getByRole('radio', { name: /Falta injustificada/ }).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('button', { name: 'Reabrir mês', exact: true })).toBeVisible();
  const absences = (
    await apiAs(owner.token, 'GET', `/v1/absences?employeeId=${e.body.id}&from=2026-09-01&to=2026-09-30`)
  ).body.filter((a: { type: string }) => a.type === 'unjustified');
  expect(absences.map((a: { startDate: string; endDate: string }) => `${a.startDate}/${a.endDate}`)).toContain(
    '2026-09-14/2026-09-15',
  );
  expect(errors).toEqual([]);
});

test('mapa de efectividade: grelha por dia, aviso de provisório e ligação a partir da assiduidade', async ({
  page,
  context,
}) => {
  const owner = await registerCompany();
  const e = await apiAs(owner.token, 'POST', '/v1/employees', {
    number: '7',
    name: 'Pessoa do Mapa',
    jobTitle: 'Técnico',
    contract: { type: 'indefinite', startDate: '2026-01-01', base: 200000 },
  });
  expect(e.status).toBe(201);
  await sql(
    `insert into attendance_entries(company_id, employee_id, work_date, clock_in, clock_out, source, created_by)
    select $1, $2, d::date, d + interval '8 hour', d + interval '16 hour', 'web', $2 from generate_series('2026-09-01'::timestamptz, '2026-09-30'::timestamptz, interval '1 day') d
    where extract(isodow from d) < 6 and d::date not in ('2026-09-14', '2026-09-17')`,
    [owner.id, e.body.id],
  );
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/assiduidade?s=equipa&mes=2026-09');
  await page.getByRole('link', { name: /Ver o mapa de efectividade/ }).click();
  await expect(page.getByRole('heading', { name: 'Mapa de efectividade' })).toBeVisible();
  await expect(page.getByText(/Provisório\./)).toBeVisible();
  const row = page.getByRole('row', { name: /Pessoa do Mapa/ });
  const cells = row.getByRole('cell');
  await expect(cells.nth(1)).toHaveText('P');
  await expect(cells.nth(5)).toHaveText('·');
  await expect(cells.nth(14)).toHaveText('SR');
  await expect(cells.nth(17)).toHaveText('Fr');
  await expect(page.getByText('Sem registo (por regularizar)')).toBeVisible();
  // Em pré-visualização o ecrã abre, mas Excel, PDF e impressão ficam reservados à subscrição paga.
  await expect(page.getByRole('button', { name: 'PDF' })).toBeDisabled();
  await page.goto('/relatorios');
  await expect(page.getByRole('link', { name: 'Abrir mapa →' })).toBeVisible();
  expect(errors).toEqual([]);
});
