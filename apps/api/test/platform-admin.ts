import { companies, eq, getDb, hashPassword, PLATFORM_NIF, platformAdmins, users } from '@kianda/db';
import { expect } from 'vitest';
import type { testClient } from './inject.js';

export const PLATFORM_PASSWORD = 'ConsolaSegura2026abc';

export async function createPlatformUser(email: string) {
  const db = getDb();
  await db.insert(companies).values({ name: 'Administração Kianda', nif: PLATFORM_NIF }).onConflictDoNothing();
  const [internal] = await db.select({ id: companies.id }).from(companies).where(eq(companies.nif, PLATFORM_NIF));
  const [user] = await db.insert(users).values({
    companyId: internal!.id, name: 'Administrador de teste', email, role: 'owner', passwordHash: await hashPassword(PLATFORM_PASSWORD),
  }).returning();
  await db.insert(platformAdmins).values({ email }).onConflictDoNothing();
  return user!;
}

export async function platformCookie(app: ReturnType<typeof testClient>, email: string) {
  await createPlatformUser(email);
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: PLATFORM_PASSWORD, area: 'plataforma' } });
  expect(login.statusCode, login.body).toBe(200);
  return `kianda_session=${login.cookies.find(c => c.name === 'kianda_session')!.value}`;
}
