import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { FINANCIAL_SECTORS, defaultModelingSector } from '@kianda/core';
import { auditLogs, closeDb, companies, companyModules, getDb, modelingMembers, subscriptions, users, valuationMembers } from '../src/index.js';

/**
 * Conta interna do dono do produto: activa RH, Modelagem (Integra) e Valora, sem limites e com exportações,
 * nas empresas de que um ADMINISTRADOR DA PLATAFORMA é proprietário — para acompanhar a evolução dos módulos.
 * Só aceita emails de KIANDA_PLATFORM_ADMINS; nunca concede nada a clientes. Idempotente; fica na auditoria.
 * Uso: INTERNAL_EMAIL=… KIANDA_PLATFORM_ADMINS=… pnpm --filter @kianda/db internal-account
 */
const email = (process.env.INTERNAL_EMAIL ?? '').trim().toLowerCase();
const admins = (process.env.KIANDA_PLATFORM_ADMINS ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!email) throw new Error('Indique INTERNAL_EMAIL.');
if (!admins.includes(email)) throw new Error(`${email} não é administrador da plataforma (KIANDA_PLATFORM_ADMINS). Clientes subscrevem em Módulos e licenças.`);

const UNTIL = '2099-12-31';
const NOTE = 'Conta interna da plataforma (dono do produto): todos os módulos activos para acompanhamento.';
const db = getDb();
const owners = await db.select({ user: users, company: companies }).from(users).innerJoin(companies, eq(companies.id, users.companyId))
  .where(and(eq(users.email, email), eq(users.role, 'owner')));
if (!owners.length) throw new Error(`${email} não é proprietário de nenhuma empresa.`);

for (const { user, company } of owners) {
  await db.transaction(async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, company.id));
    // RH: activo, na faixa sem limite de colaboradores.
    const hr = { status: 'active', tierKey: 't5', cycle: 'annual', paidUntil: UNTIL, notes: NOTE, updatedAt: new Date() };
    await tx.insert(subscriptions).values({ companyId: company.id, ...hr }).onConflictDoUpdate({ target: subscriptions.companyId, set: hr });
    const grants = await tx.select().from(companyModules).where(eq(companyModules.companyId, company.id));
    const modeling = grants.find((g) => g.module === 'modeling');
    const values = {
      hr: { enabled: true, status: 'active' },
      modeling: { enabled: true, status: 'active', paidUntil: UNTIL, trialEndsAt: null, projectLimit: null, extraUsers: 0, planKey: 'unlimited', cycle: 'annual',
        primarySector: modeling?.primarySector ?? defaultModelingSector(company.sector), modelingSectors: [...FINANCIAL_SECTORS] },
      valuation: { enabled: true, status: 'active', paidUntil: UNTIL, trialEndsAt: null, projectLimit: null, extraUsers: 0, planKey: 'unlimited', cycle: 'annual' },
    } as const;
    for (const [module, set] of Object.entries(values)) {
      await tx.insert(companyModules).values({ companyId: company.id, module, ...set }).onConflictDoUpdate({ target: [companyModules.companyId, companyModules.module], set: { ...set, updatedAt: new Date() } });
    }
    await tx.insert(modelingMembers).values({ companyId: company.id, userId: user.id, addedBy: user.id }).onConflictDoUpdate({ target: [modelingMembers.companyId, modelingMembers.userId], set: { enabled: true, permission: 'editor', scope: 'all' } });
    await tx.insert(valuationMembers).values({ companyId: company.id, userId: user.id, addedBy: user.id }).onConflictDoUpdate({ target: [valuationMembers.companyId, valuationMembers.userId], set: { enabled: true, permission: 'editor' } });
    await tx.insert(auditLogs).values({ companyId: company.id, actorId: user.id, action: 'internal_account', entity: 'company', entityId: company.id,
      before: { subscription: sub ? { status: sub.status, tierKey: sub.tierKey, paidUntil: sub.paidUntil } : null, modules: grants.map((g) => ({ module: g.module, status: g.status, enabled: g.enabled, paidUntil: g.paidUntil })) },
      after: { by: 'procedimento de administração (GitHub Actions)', modules: ['hr', 'modeling', 'valuation'], paidUntil: UNTIL, note: NOTE } });
  });
  console.log(`Empresa ${company.id} (${company.name}): RH, Modelagem e Valora activos até ${UNTIL}.`);
}
console.log(`Concluído: ${owners.length} empresa(s) de ${email}.`);
await closeDb();
