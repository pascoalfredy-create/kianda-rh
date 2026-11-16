import { expect, test } from '@playwright/test';
import { closePool, registerCompany, signIn, sql, watchErrors } from './support.js';

test.afterAll(closePool);

test('novidades: aviso no topo até ser fechado e histórico em Novidades', async ({ page, context }) => {
  const owner = await registerCompany();
  const slug = `e2e-${Date.now()}`;
  await sql(
    `insert into release_notes(slug, title, body, modules, roles, url) values ($1, 'Novo: teste de novidades', 'Uma novidade de teste.', '{hr}', '{}', '/relatorios')`,
    [slug],
  );
  try {
    await signIn(context, owner.token);
    const errors = watchErrors(page);
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Novidades do Kianda' });
    await expect(banner.getByText('Novo: teste de novidades')).toBeVisible();
    await banner.getByRole('button', { name: 'Fechar' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Novidades do Kianda' })).toBeHidden();
    await page.goto('/novidades');
    await expect(page.getByRole('heading', { name: 'Novo: teste de novidades' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await sql('delete from release_notes where slug = $1', [slug]);
  }
});
