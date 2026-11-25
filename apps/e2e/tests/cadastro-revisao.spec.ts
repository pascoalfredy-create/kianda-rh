import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, closePool, PASSWORD, registerCompany, signIn, sql, watchErrors } from './support.js';

test.afterAll(closePool);

/** Empresa em revisão: NIF com padrão invulgar e email de teste (o cenário que o cliente tem de ver). */
async function companyInReview() {
  const owner = await registerCompany({ name: 'Lunda Serviços E2E' });
  const nif = `${`${Date.now()}`.slice(-4)}000000`;
  await sql(
    `update companies set nif=$1, registration_review_reasons='["O NIF apresenta uma sequência ou repetição de dígitos que requer confirmação."]'::jsonb where id=$2`,
    [nif, owner.id],
  );
  const testEmail = `teste.${randomUUID().slice(0, 8)}@e2e.kianda.test`;
  await sql('update users set email=$1 where company_id=$2', [testEmail, owner.id]);
  return { ...owner, nif, email: testEmail };
}

test('o cliente vê os pontos do cadastro, corrige o NIF e entra nos módulos', async ({ page, context }) => {
  const errors = watchErrors(page);
  const owner = await companyInReview();
  await signIn(context, owner.token);
  await page.goto('/modulos');
  await expect(page).toHaveURL(/\/cadastro-em-revisao$/);
  await expect(page.getByRole('heading', { name: 'Cadastro em revisão' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('1 ponto bloqueia o acesso aos módulos.');
  const nifRow = page.locator('[data-check="nif"]');
  await expect(nifRow).toContainText('Por confirmar');
  await expect(nifRow).toContainText('Bloqueia o acesso');
  await expect(nifRow).toContainText('padrão invulgar');
  const emailRow = page.locator('[data-check="ownerEmail"]');
  await expect(emailRow).toContainText('Não cumpre');
  await expect(emailRow).not.toContainText('Bloqueia o acesso');
  await expect(page.locator('[data-check="ownerName"]')).toContainText('Cumpre os requisitos');

  const nif = nifRow.getByLabel('NIF correcto');
  await nif.fill('2222220001');
  await nifRow.getByRole('button', { name: 'Corrigir NIF' }).click();
  await expect(nifRow).toContainText('continua com um padrão invulgar');
  await nif.fill(`7${`${Date.now()}`.slice(-9)}`);
  await nifRow.getByRole('button', { name: 'Corrigir NIF' }).click();
  await expect(page).toHaveURL(/\/modulos$/);
  const [company] = await sql<{ reasons: string[] }>(
    'select registration_review_reasons as reasons from companies where id=$1',
    [owner.id],
  );
  expect(company!.reasons).toEqual([]);

  // O email continua como aviso, com correcção na conta.
  await page.goto('/conta');
  const card = page.locator('#cadastro');
  await expect(card).toContainText('Dados do cadastro');
  await expect(card.locator('[data-check="ownerEmail"]')).toContainText('Não cumpre');
  await expect(card.locator('[data-check="nif"]')).toContainText('Cumpre os requisitos');
  // O único 400 esperado é a recusa do NIF invulgar submetido acima.
  expect(errors.filter(e => !e.includes('status of 400'))).toEqual([]);
});

test('a ficha da consola mostra a mesma lista e aprova com a nota', async ({ page, context }) => {
  const owner = await companyInReview();
  await sql(
    "insert into companies (id, name, nif) values ($1, 'Administração Kianda', 'PLATAFORMA') on conflict (nif) do nothing",
    [randomUUID()],
  );
  const adminEmail = `consola.${randomUUID().slice(0, 8)}@e2e.kianda.test`;
  await sql(
    `insert into users (id, company_id, name, email, role, password_hash)
    select $1, c.id, 'Administrador de teste', $2, 'owner', u.password_hash from companies c
    join users u on u.company_id = $3 where c.nif = 'PLATAFORMA'`,
    [randomUUID(), adminEmail, owner.id],
  );
  await sql('insert into platform_admins (email) values ($1) on conflict do nothing', [adminEmail]);
  const login = await apiAs<{ token: string }>('', 'POST', '/v1/auth/login', {
    email: adminEmail,
    password: PASSWORD,
    area: 'plataforma',
  });
  expect(login.status).toBe(200);
  await signIn(context, login.body.token);
  await page.goto(`/plataforma/empresas/${owner.id}`);
  const review = page.locator('.card', { hasText: 'Cadastro por rever' });
  await expect(review.locator('[data-check="nif"]')).toContainText('Bloqueia o acesso');
  await expect(review.locator('[data-check="ownerEmail"]')).toContainText('Aviso, não bloqueia');
  await review.getByLabel('Confirmação dos dados').fill('NIF confirmado pela certidão da AGT.');
  await review.getByRole('button', { name: 'Aprovar cadastro' }).click();
  await expect(review).toContainText('O acesso não está bloqueado.');
  const [company] = await sql<{ reasons: string[] }>(
    'select registration_review_reasons as reasons from companies where id=$1',
    [owner.id],
  );
  expect(company!.reasons).toEqual([]);
});
