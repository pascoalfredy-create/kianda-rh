import { expect, test } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, sql, watchErrors, type Company } from './support.js';

/**
 * Ponto com localização no navegador: configuração pelo RH, marcação com GPS (simulado), recusa fora do local,
 * quiosque com código rotativo e lista de excepções da chefia.
 */
test.describe.configure({ mode: 'serial' });
const SEDE = { latitude: -8.8125, longitude: 13.2302 };
const NEAR = { latitude: -8.8131, longitude: 13.2305, accuracy: 20 };
const FAR = { latitude: -8.83, longitude: 13.25, accuracy: 10 };
let owner: Company, worker: { id: string; token: string }, employeeId = '';

test.beforeAll(async () => {
  owner = await registerCompany({ name: 'Estaleiro Marginal E2E' });
  const e = await apiAs(owner.token, 'POST', '/v1/employees', { number: '31', name: 'Domingos Kiala', gender: 'M', jobTitle: 'Encarregado', province: 'Luanda', nif: '0000000031',
    contract: { type: 'indefinite', startDate: '2026-01-05', base: 280000, meal: 30000, transport: 25000 } });
  expect(e.status, JSON.stringify(e.body)).toBe(201);
  employeeId = e.body.id;
  worker = await addUser(owner, 'Domingos', 'employee', employeeId);
});
test.afterAll(closePool);
const clearToday = () => sql(`delete from attendance_entries where employee_id = $1`, [employeeId]);

test('RH: cria o local com raio, liga o quiosque e escolhe bloquear fora do local', async ({ page, context }) => {
  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/locais');
  await expect(page.getByRole('heading', { name: 'Locais de trabalho' })).toBeVisible();
  await page.getByLabel('Nome').fill('Sede — Marginal');
  await page.getByLabel('Latitude').fill(String(SEDE.latitude));
  await page.getByLabel('Longitude').fill(String(SEDE.longitude));
  await page.getByLabel('Raio (metros)').fill('150');
  await page.getByRole('button', { name: 'Acrescentar local' }).click();
  await expect(page.locator('table').first()).toContainText('Sede — Marginal');
  await page.getByRole('button', { name: 'Ligar quiosque' }).click();
  await expect(page.getByRole('link', { name: 'Abrir quiosque' })).toBeVisible();
  await page.getByLabel(/Bloquear marcações fora do local/).check();
  await Promise.all([page.waitForResponse((r) => r.url().includes('/v1/workplaces/settings') && r.ok()), page.getByRole('button', { name: 'Gravar regra' }).click()]);
  expect((await apiAs(owner.token, 'GET', '/v1/workplaces')).body.mode).toBe('block');
  expect(errors).toEqual([]);
});

test('colaborador: fora do local a marcação é recusada; dentro é aceite, com aviso de privacidade', async ({ browser }) => {
  await clearToday();
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: FAR, locale: 'pt-PT', timezoneId: 'Africa/Luanda' });
  await signIn(context, worker.token);
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto('/assiduidade');
  await expect(page.getByText('A sua localização é registada só no momento da marcação')).toBeVisible();
  await page.locator('.card.clock').getByRole('button', { name: 'Registar entrada' }).click();
  await expect(page.locator('.card.clock').getByRole('alert')).toContainText(/km do local «Sede — Marginal»/);
  await expect(page.locator('.card.clock').getByText('Fora de serviço')).toBeVisible();
  await context.setGeolocation(NEAR);
  await page.locator('.card.clock').getByRole('button', { name: 'Registar entrada' }).click();
  await expect(page.locator('.card.clock').getByText('Em serviço')).toBeVisible();
  const [row] = await sql<{ clock_in_location: { status: string; method: string } }>(`select clock_in_location from attendance_entries where employee_id = $1`, [employeeId]);
  expect(row!.clock_in_location).toMatchObject({ status: 'ok', method: 'gps' });
  await context.close();
  // O 403 da tentativa fora do local é a resposta esperada (o navegador regista-o na consola).
  expect(errors.filter((e) => !/status of 403/.test(e))).toEqual([]);
});

test('quiosque: o ecrã mostra o código rotativo e o colaborador marca sem GPS', async ({ browser, page }) => {
  await clearToday();
  const path = (await apiAs(owner.token, 'GET', '/v1/workplaces')).body.workplaces[0].kioskPath as string;
  const kioskErrors = watchErrors(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Sede — Marginal' })).toBeVisible();
  await expect(page.getByAltText('QR do ponto')).toBeVisible();
  const code = (await page.locator('[aria-live="polite"]').first().textContent())!.replace(/\D/g, '');
  expect(code).toMatch(/^\d{6}$/);
  // Sem permissão de localização: só o código do quiosque permite marcar.
  const context = await browser.newContext({ locale: 'pt-PT', timezoneId: 'Africa/Luanda' });
  await signIn(context, worker.token);
  const phone = await context.newPage();
  await phone.goto('/assiduidade');
  await phone.getByRole('button', { name: 'Usar o código do quiosque' }).click();
  await phone.getByLabel('Código do quiosque').fill(code);
  await phone.locator('.card.clock').getByRole('button', { name: 'Registar entrada' }).click();
  await expect(phone.locator('.card.clock').getByText('Em serviço')).toBeVisible();
  const [row] = await sql<{ clock_in_location: { method: string; lat?: number } }>(`select clock_in_location from attendance_entries where employee_id = $1`, [employeeId]);
  expect(row!.clock_in_location).toMatchObject({ method: 'kiosk' });
  expect(row!.clock_in_location.lat).toBeUndefined();
  await context.close();
  expect(kioskErrors).toEqual([]);
});

test('alertar: a marcação fora do local é aceite e aparece nas excepções da chefia', async ({ browser, page, context }) => {
  await clearToday();
  expect((await apiAs(owner.token, 'PUT', '/v1/workplaces/settings', { mode: 'alert' })).status).toBe(200);
  const phoneContext = await browser.newContext({ permissions: ['geolocation'], geolocation: FAR, locale: 'pt-PT', timezoneId: 'Africa/Luanda' });
  await signIn(phoneContext, worker.token);
  const phone = await phoneContext.newPage();
  await phone.goto('/assiduidade');
  await phone.locator('.card.clock').getByRole('button', { name: 'Registar entrada' }).click();
  await expect(phone.locator('.card.clock').getByText('Em serviço')).toBeVisible();
  await phoneContext.close();

  await signIn(context, owner.token);
  const errors = watchErrors(page);
  await page.goto('/assiduidade?s=equipa');
  const row = page.locator('tr', { hasText: 'Domingos Kiala' }).first();
  await expect(row.locator('.flag', { hasText: '📍' })).toContainText('1');
  const issues = page.locator('.card', { hasText: 'Excepções de localização' });
  await expect(issues).toContainText('Domingos Kiala');
  await expect(issues).toContainText(/Fora do local: a .* de «Sede — Marginal» \(GPS ±10 m\)/);
  await expect(issues.getByRole('link', { name: 'mapa' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=-8\.83&mlon=13\.25/);
  expect(errors).toEqual([]);
});
