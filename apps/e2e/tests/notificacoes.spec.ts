import { expect, test } from '@playwright/test';
import { addUser, apiAs, closePool, registerCompany, signIn, sql, watchErrors } from './support.js';

/**
 * Notificações no telemóvel. O Chrome dos testes não tem serviço de push real: simula-se só a subscrição que o
 * navegador criaria (endereço do serviço e chaves). Tudo o resto é real: activação, registo no servidor,
 * aviso gerado por um evento e desactivação ao terminar sessão.
 */
test.afterAll(closePool);

test('Notificações: o colaborador activa no telemóvel, recebe o aviso do evento e deixa de receber ao sair', async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: 'http://localhost:3000' });
  await context.addInitScript(`(() => {
    const KEY = 'e2e-push-sub';
    const wrap = (j) => j && ({ endpoint: j.endpoint, toJSON: () => j, unsubscribe: async () => { sessionStorage.removeItem(KEY); return true; } });
    // Chrome sem ecrã responde sempre «denied»: simula-se a autorização dada pelo utilizador.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    PushManager.prototype.getSubscription = async () => wrap(JSON.parse(sessionStorage.getItem(KEY) || 'null'));
    PushManager.prototype.subscribe = async () => {
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const p256dh = b64(await crypto.subtle.exportKey('raw', pair.publicKey)), auth = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
      const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-' + Date.now();
      const json = { endpoint, keys: { p256dh, auth } };
      sessionStorage.setItem(KEY, JSON.stringify(json));
      return wrap(json);
    };
  })();`);
  const owner = await registerCompany();
  const emp = await apiAs(owner.token, 'POST', '/v1/employees', { number: '61', name: 'Marta Sungo', gender: 'F', jobTitle: 'Técnica', province: 'Luanda', nif: '0000006161', contract: { type: 'indefinite', startDate: '2025-02-03', base: 300000, meal: 30000, transport: 25000 } });
  const marta = await addUser(owner, 'Marta Sungo', 'employee', emp.body.id);

  await signIn(context, marta.token);
  const errors = watchErrors(page);
  await page.goto('/');
  const invite = page.getByRole('status').filter({ hasText: 'Receba no telemóvel os avisos' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Activar notificações' }).click();
  await expect(invite).toContainText('Notificações activas neste dispositivo.');
  await page.screenshot({ path: '/tmp/e2e/notificacoes-01-convite.png', fullPage: false });

  const subs = await sql<{ n: string }>('select count(*) as n from push_subscriptions s join users u on u.id = s.user_id where u.employee_id = $1', [emp.body.id]);
  expect(subs[0]!.n).toBe('1');
  await page.goto('/conta');
  const card = page.locator('.card', { hasText: 'Notificações no telemóvel' });
  await expect(card).toContainText('Activas neste dispositivo');
  await card.getByRole('button', { name: 'Enviar aviso de teste' }).click();
  await expect(card).toContainText('Aviso de teste enviado');
  await page.screenshot({ path: '/tmp/e2e/notificacoes-02-conta.png', fullPage: false });

  // Um evento real: o RH aprova uma ausência registada para a Marta → aviso na caixa de saída.
  const a = await apiAs(owner.token, 'POST', '/v1/absences', { employeeId: emp.body.id, type: 'justified', startDate: '2026-12-21', endDate: '2026-12-21' });
  expect(a.status).toBe(201);
  expect((await apiAs(owner.token, 'POST', `/v1/absences/${a.body.id}/approve`, {})).status).toBe(200);
  const queued = await sql<{ title: string }>(`select payload->>'title' as title from push_outbox o join users u on u.id = o.user_id where u.employee_id = $1 order by o.created_at desc limit 1`, [emp.body.id]);
  expect(queued[0]!.title).toMatch(/pedido aprovado/);

  await page.getByRole('button', { name: 'Terminar sessão' }).first().click();
  await expect(page).toHaveURL(/\/$|\/login/);
  const after = await sql<{ n: string }>('select count(*) as n from push_subscriptions s join users u on u.id = s.user_id where u.employee_id = $1', [emp.body.id]);
  expect(after[0]!.n).toBe('0');
  expect(errors).toEqual([]);
});
