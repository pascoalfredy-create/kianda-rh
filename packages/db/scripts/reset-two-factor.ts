import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { auditLogs, closeDb, companies, getDb, PLATFORM_NIF, users } from '../src/index.js';

/**
 * Desactiva a verificação em dois passos de um ADMINISTRADOR DA PLATAFORMA que perdeu a app autenticadora.
 * Só aceita emails que estejam em KIANDA_PLATFORM_ADMINS (os clientes recuperam pelo RH da própria empresa,
 * com a ligação de acesso, que já repõe a verificação). Não mexe na palavra-passe. Fica registado na auditoria.
 * Uso: RESET_2FA_EMAIL=… KIANDA_PLATFORM_ADMINS=… pnpm --filter @kianda/db reset-2fa
 */
const email = (process.env.RESET_2FA_EMAIL ?? '').trim().toLowerCase();
const admins = (process.env.KIANDA_PLATFORM_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!email) throw new Error('Indique RESET_2FA_EMAIL.');
if (!admins.includes(email)) throw new Error(`${email} não é administrador da plataforma (KIANDA_PLATFORM_ADMINS). Clientes recuperam o acesso pelo RH da empresa.`);

const db = getDb();
try {
  const [account] = await db.select({ u: users }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
    .where(and(eq(companies.nif, PLATFORM_NIF), eq(users.email, email)));
  if (!account) throw new Error(`Não há conta administrativa para ${email}.`);
  const { u } = account;
  if (u.totpEnabledAt || u.totpSecret) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ totpSecret: null, totpEnabledAt: null, failedAttempts: 0, lockedUntil: null }).where(eq(users.id, u.id));
      await tx.insert(auditLogs).values({ companyId: u.companyId, actorId: u.id, action: 'reset_2fa', entity: 'user', entityId: u.id, before: { totpEnabledAt: u.totpEnabledAt }, after: { totpEnabledAt: null, by: 'procedimento de administração (GitHub Actions)' } });
    });
  }
  console.log(`Conta administrativa de ${email}: verificação em dois passos desactivada.`);
} finally {
  await closeDb();
}
