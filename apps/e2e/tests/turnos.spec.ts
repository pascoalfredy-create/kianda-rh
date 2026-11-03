import { expect, test } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, watchErrors } from './support.js';

/** Planeamento de turnos: tipos de turno, pincel, padrão de rotação, verificações, publicação e «os meus turnos». */
test.afterAll(closePool);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const nextMonday = () => { const d = new Date(Date.now() + 3_600_000); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return iso(d); };

test('Turnos: o RH cria os turnos, planeia com o pincel e um padrão, publica, e o colaborador vê a sua escala', async ({ page, context, browser }) => {
  const owner = await registerCompany();
  const ids: string[] = [];
  for (const [n, name] of [['31', 'Ana Muxima'], ['32', 'Bento Kanda'], ['33', 'Carla Tchissola'], ['34', 'Dário Lemos']] as const) {
    const r = await apiAs(owner.token, 'POST', '/v1/employees', { number: n, name, gender: 'F', jobTitle: 'Vigilante', province: 'Luanda', nif: `00000031${n}`, contract: { type: 'indefinite', startDate: '2025-03-03', base: 250000, meal: 25000, transport: 20000 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201); ids.push(r.body.id);
  }
  const ana = await addUser(owner, 'Ana Muxima', 'employee', ids[0]);
  for (const t of [{ code: 'T', name: 'Tarde', startTime: '14:00', endTime: '22:00', breakMinutes: 30, color: 'amber' }, { code: 'N', name: 'Noite', startTime: '22:00', endTime: '06:00', breakMinutes: 30, color: 'violet', minStaff: 1 }]) {
    expect((await apiAs(owner.token, 'POST', '/v1/shifts/types', t)).status).toBe(201);
  }

  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/turnos');
  await expect(page.getByRole('heading', { name: 'Planeamento de turnos', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Tipos de turno' }).click();
  await page.getByRole('button', { name: 'Novo tipo de turno' }).click();
  await page.getByLabel('Código').fill('m');
  await page.getByLabel('Nome').fill('Manhã');
  await page.getByLabel('Entrada').fill('06:00');
  await page.getByLabel('Saída').fill('14:00');
  await expect(page.locator('.preview')).toContainText('Trabalho previsto: 7h30');
  await page.getByRole('button', { name: 'Criar turno' }).click();
  await expect(page.getByRole('row', { name: /Manhã/ })).toContainText('06:00–14:00');
  await expect(page.getByRole('row', { name: /Noite/ })).toContainText('Nocturno');
  await page.screenshot({ path: '/tmp/e2e/turnos-01-tipos.png', fullPage: false });

  const monday = nextMonday();
  await page.goto(`/turnos?vista=quinzena&de=${monday}`);
  const grid = page.locator('table.roster');
  await expect(grid.getByRole('row', { name: /Ana Muxima/ })).toBeVisible();
  // Pincel: Manhã para a Ana na segunda e na terça.
  await page.getByRole('radio', { name: /^M/ }).click();
  const anaRow = grid.getByRole('row', { name: /Ana Muxima/ });
  await anaRow.getByRole('button').nth(0).click();
  await anaRow.getByRole('button').nth(1).click();
  await expect(page.getByRole('button', { name: 'Gravar (2)' })).toBeVisible();
  // Padrão de rotação para as quatro pessoas, desfasado dois dias.
  await page.getByRole('button', { name: 'Aplicar padrão' }).click();
  await page.getByLabel('Padrão', { exact: true }).fill('M×2 T×2 N×2 F×2');
  await page.getByLabel('Desfasar cada colaborador (dias)').fill('2');
  await expect(page.locator('.pattern-row').first()).toContainText('MMTTNNFF');
  await page.getByRole('button', { name: 'Aplicar a 56 dia(s)' }).click();
  await expect(page.getByText('Padrão aplicado a 56 dia(s). Reveja e grave.')).toBeVisible();
  await expect(page.locator('.map.roster tfoot')).toContainText('Noite');
  await page.screenshot({ path: '/tmp/e2e/turnos-02-rascunho.png', fullPage: false });
  await page.getByRole('button', { name: /^Gravar \(\d+\)$/ }).click();
  await expect(page.getByText(/dia\(s\) gravados\. Publique para a equipa ver\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar (56)' })).toBeEnabled();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Publicar (56)' }).click();
  await expect(page.getByText('Publicados 56 dia(s) de 4 colaborador(es).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  // Uma folga sobre um turno publicado fica por publicar; descartar volta atrás.
  await page.getByRole('radio', { name: /Folga/ }).click();
  await anaRow.getByRole('button').nth(0).click();
  await expect(page.getByRole('button', { name: 'Gravar (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('button', { name: 'Gravar' })).toBeDisabled();
  await page.screenshot({ path: '/tmp/e2e/turnos-03-publicado.png', fullPage: true });
  expect(errors).toEqual([]);

  // A colaboradora vê a sua escala publicada.
  const mine = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Africa/Luanda', viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  await signIn(mine, ana.token);
  const phone = await mine.newPage();
  await phone.goto(`/turnos?v=meus&de=${monday}`);
  await expect(phone.getByRole('heading', { name: 'Os meus turnos', level: 1 })).toBeVisible();
  await expect(phone.locator('.kpi', { hasText: 'Próximo turno' })).toContainText('06:00–14:00');
  await expect(phone.getByRole('row', { name: /seg/ }).first()).toContainText('Manhã');
  expect(await phone.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await phone.screenshot({ path: '/tmp/e2e/turnos-04-os-meus.png', fullPage: false });
  await mine.close();
  // A dona vê a escala no telemóvel: a grelha desliza dentro do cartão, sem alargar a página.
  const own = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Africa/Luanda', viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  await signIn(own, owner.token);
  const ownPhone = await own.newPage();
  await ownPhone.goto(`/turnos?de=${monday}`);
  await expect(ownPhone.locator('table.roster')).toBeVisible();
  expect(await ownPhone.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')).toBeLessThanOrEqual(1);
  await ownPhone.screenshot({ path: '/tmp/e2e/turnos-05-escala-telemovel.png', fullPage: false });
  await own.close();
});
