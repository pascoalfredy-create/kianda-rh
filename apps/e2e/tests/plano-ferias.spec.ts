import { expect, test } from '@playwright/test';
import { apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';
test.afterAll(closePool);
test('plano de férias (art. 206.º): todos os trabalhadores, períodos marcados e por aprovar', async ({ page, context }) => {
  const o = await registerCompany();
  await apiAs(o.token, 'PATCH', '/v1/company/settings', { address: 'Rua Principal, Talatona, Luanda' });
  const ids: string[] = [];
  for (const [i, n] of ['Amélia Bastos', 'Bento Kiala', 'Carla Muhongo', 'Daniel Nzinga'].entries()) ids.push((await apiAs(o.token, 'POST', '/v1/employees', { number: String(i + 1), name: n, jobTitle: 'Técnico', contract: { type: 'indefinite', startDate: '2024-03-01', base: 220000 } })).body.id);
  await apiAs(o.token, 'POST', '/v1/absences', { employeeId: ids[0], type: 'vacation', startDate: '2027-02-01', endDate: '2027-02-12', approve: true });
  await apiAs(o.token, 'POST', '/v1/absences', { employeeId: ids[0], type: 'vacation', startDate: '2027-08-02', endDate: '2027-08-13', approve: true });
  await apiAs(o.token, 'POST', '/v1/absences', { employeeId: ids[1], type: 'vacation', startDate: '2027-07-05', endDate: '2027-07-30' });
  await signIn(context, o.token); const errors = watchErrors(page);
  await page.goto('/ausencias?ano=2027'); await page.getByRole('link', { name: 'Plano de férias (A4)' }).click();
  await expect(page.getByRole('heading', { name: 'Plano de férias 2027' })).toBeVisible();
  await expect(page.locator('table.vacation-plan')).toContainText('01/02/2027 — 12/02/2027; 02/08/2027 — 13/08/2027');
  await expect(page.locator('table.vacation-plan')).toContainText('(por aprovar)');
  await expect(page.locator('table.vacation-plan tbody tr')).toHaveCount(4);
  expect(errors).toEqual([]);
});
