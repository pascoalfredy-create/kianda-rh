import 'dotenv/config';
import { and, eq, ne, notInArray } from 'drizzle-orm';
import { closeDb, companies, companyModules, getDb, hashPassword, PLATFORM_NIF, platformAdmins, subscriptions, users } from '../src/index.js';

/**
 * Sincroniza os administradores da plataforma com KIANDA_PLATFORM_ADMINS (emails separados por vírgula). Vazio = não mexe.
 * Cria o acesso próprio da consola com KIANDA_PLATFORM_INITIAL_PASSWORD ou SEED_OWNER_PASSWORD.
 * Um email que também é utilizado por uma empresa conserva as duas contas separadas.
 */
const emails = [...new Set((process.env.KIANDA_PLATFORM_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
const initial = process.env.KIANDA_PLATFORM_INITIAL_PASSWORD || process.env.SEED_OWNER_PASSWORD;
try {
  await getDb().transaction(async (db) => {
    if (emails.length) {
      await db.insert(platformAdmins).values(emails.map(email => ({ email }))).onConflictDoNothing();
      await db.delete(platformAdmins).where(notInArray(platformAdmins.email, emails));
      if (initial) await db.insert(companies).values({ name: 'Kianda — Administração da plataforma', nif: PLATFORM_NIF }).onConflictDoNothing();
    } else {
      console.log('KIANDA_PLATFORM_ADMINS vazio: administradores da plataforma mantidos.');
    }

    const [internal] = await db.select({ id: companies.id }).from(companies).where(eq(companies.nif, PLATFORM_NIF));
    for (const email of emails) {
      const [exists] = internal ? await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, internal.id), eq(users.email, email))) : [];
      if (exists) continue;
      if (!initial || !internal) { console.log(`Sem palavra-passe inicial: conta de ${email} não criada.`); continue; }
      const [created] = await db.insert(users).values({ companyId: internal.id, email, name: email.split('@')[0]!, role: 'owner', passwordHash: await hashPassword(initial) }).onConflictDoNothing().returning({ id: users.id });
      if (created) console.log(`Conta da plataforma criada para ${email}.`);
    }

    if (internal) {
      // As licenças antigas ficam no histórico e deixam de estar activas no registo administrativo.
      await db.update(subscriptions).set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(subscriptions.companyId, internal.id), ne(subscriptions.status, 'cancelled')));
      await db.update(companyModules).set({ enabled: false, status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(companyModules.companyId, internal.id), eq(companyModules.enabled, true)));
    }
  });
} finally {
  await closeDb();
}
