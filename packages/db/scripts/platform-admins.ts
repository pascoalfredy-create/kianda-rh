import 'dotenv/config';
import { and, eq, notInArray } from 'drizzle-orm';
import { closeDb, companies, getDb, hashPassword, platformAdmins, subscriptions, users } from '../src/index.js';

/**
 * Sincroniza os administradores da plataforma com KIANDA_PLATFORM_ADMINS (emails separados por vírgula). Vazio = não mexe.
 * Quem ainda não tem utilizador recebe uma conta na empresa interna "Kianda RH — Plataforma" (fora da lista de clientes,
 * sem expiração), com a palavra-passe inicial KIANDA_PLATFORM_INITIAL_PASSWORD (ou a das contas de demonstração).
 */
export const PLATFORM_NIF = 'PLATAFORMA';
const emails = (process.env.KIANDA_PLATFORM_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
if (!emails.length) {
  console.log('KIANDA_PLATFORM_ADMINS vazio: administradores da plataforma mantidos.');
} else {
  const db = getDb();
  for (const email of emails) await db.insert(platformAdmins).values({ email }).onConflictDoNothing();
  await db.delete(platformAdmins).where(notInArray(platformAdmins.email, emails));
  const initial = process.env.KIANDA_PLATFORM_INITIAL_PASSWORD || process.env.SEED_OWNER_PASSWORD;
  let [internal] = await db.select().from(companies).where(eq(companies.nif, PLATFORM_NIF));
  for (const email of emails) {
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) continue;
    if (!initial) { console.log(`Sem palavra-passe inicial: conta de ${email} não criada.`); continue; }
    internal ??= (await db.insert(companies).values({ name: 'Kianda RH — Plataforma', nif: PLATFORM_NIF, code: 'KIANDA' }).returning())[0]!;
    await db.insert(subscriptions).values({ companyId: internal.id, status: 'active', tierKey: 't1', cycle: 'annual', paidUntil: '2099-12-31', notes: 'Conta interna da plataforma' }).onConflictDoNothing();
    await db.insert(users).values({ companyId: internal.id, email, name: email.split('@')[0]!, role: 'owner', passwordHash: await hashPassword(initial) });
    console.log(`Conta da plataforma criada para ${email}.`);
  }
  console.log(`Administradores da plataforma: ${emails.length}.`);
  void and;
}
await closeDb();
