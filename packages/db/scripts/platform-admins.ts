import 'dotenv/config';
import { closeDb, getDb, platformAdmins } from '../src/index.js';
import { notInArray } from 'drizzle-orm';

/** Sincroniza os administradores da plataforma com KIANDA_PLATFORM_ADMINS (emails separados por vírgula). Vazio = não mexe. */
const emails = (process.env.KIANDA_PLATFORM_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
if (!emails.length) {
  console.log('KIANDA_PLATFORM_ADMINS vazio: administradores da plataforma mantidos.');
} else {
  const db = getDb();
  for (const email of emails) await db.insert(platformAdmins).values({ email }).onConflictDoNothing();
  await db.delete(platformAdmins).where(notInArray(platformAdmins.email, emails));
  console.log(`Administradores da plataforma: ${emails.length}.`);
}
await closeDb();
