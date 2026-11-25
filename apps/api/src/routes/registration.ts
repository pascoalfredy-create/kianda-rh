import {
  isUnusualNif,
  isValidCompanyNif,
  ownerEmailProblem,
  ownerNameProblem,
  registrationNameProblem,
} from '@kianda/core';
import { and, auditLogs, companies, eq, getDb, ne, users, verifyPassword } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, rateLimit, requireAccount, type AppEnv, type Ctx } from '../plugins/tenant.js';
import { issueEmailChange } from '../services/email-verification.js';
import {
  clearReviewIfResolved,
  companyRegistration,
  notifyAdminsOfCorrection,
  primaryOwner,
} from '../services/registration.js';
import { DomainError } from '../services/payroll.js';
import { platformSettingsGet } from '../services/licence.js';

/** Só o proprietário principal corrige os dados do cadastro (é ele que a lista mostra). */
async function requirePrimaryOwner(c: Ctx) {
  const actor = c.get('actor');
  if (actor.platformAdmin) throw new DomainError('sem_permissao', 'Reservado às empresas clientes.', 403);
  const owner = await primaryOwner(getDb(), actor.companyId);
  if (actor.role !== 'owner' || owner?.id !== actor.actorId)
    throw new DomainError(
      'sem_permissao',
      'Só o proprietário principal da conta pode corrigir os dados do cadastro.',
      403,
    );
  return actor;
}

/** Cadastro da empresa: lista de pontos e correcções feitas pelo próprio cliente. */
export function registrationRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/v1/registration', requireAccount, async c => {
    const actor = c.get('actor');
    if (actor.platformAdmin)
      return c.json({
        inReview: false,
        items: [],
        blocking: 0,
        canEdit: false,
        supportEmail: null,
        supportPhone: null,
      });
    const data = await companyRegistration(getDb(), actor.companyId);
    if (!data) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
    const { ownerId, ...rest } = data;
    const settings = await platformSettingsGet(getDb());
    return c.json({
      ...rest,
      canEdit: actor.role === 'owner' && ownerId === actor.actorId,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone,
    });
  });

  /** NIF: só enquanto o cadastro está em revisão. Depois de aprovado, apenas o suporte o altera. */
  app.post('/v1/registration/nif', requireAccount, rateLimit('registration-nif', 10, 3_600_000), async c => {
    const actor = await requirePrimaryOwner(c);
    const b = z
      .object({ nif: z.string().trim().refine(isValidCompanyNif, 'O NIF de empresa tem 10 algarismos.') })
      .parse(await body(c));
    if (isUnusualNif(b.nif))
      throw new DomainError(
        'nif_invulgar',
        'Este NIF continua com um padrão invulgar. Se estiver correcto, envie o comprovativo ao suporte.',
        400,
      );
    const db = getDb();
    const resolved = await db.transaction(async tx => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, actor.companyId)).for('update');
      if (!company) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
      if (!company.registrationReviewReasons.length)
        throw new DomainError(
          'cadastro_aprovado',
          'O cadastro já foi aprovado. Para alterar o NIF, contacte o suporte.',
          409,
        );
      if (company.nif === b.nif) throw new DomainError('nif_igual', 'Este já é o NIF registado.', 400);
      const [taken] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.nif, b.nif), ne(companies.id, company.id)));
      if (taken)
        throw new DomainError(
          'nif_duplicado',
          'Já existe uma empresa registada com este NIF. Confirme o número ou contacte o suporte.',
          409,
        );
      await tx.update(companies).set({ nif: b.nif }).where(eq(companies.id, company.id));
      await tx.insert(auditLogs).values({
        companyId: company.id,
        actorId: actor.actorId,
        action: 'registration_nif_corrected',
        entity: 'company',
        entityId: company.id,
        before: { nif: company.nif },
        after: { nif: b.nif },
      });
      return clearReviewIfResolved(tx, company.id, actor.actorId);
    });
    await notifyAdminsOfCorrection(db, actor.companyId, `o NIF passou a ${b.nif}`, resolved);
    return c.json({ ok: true, resolved, ...(await companyRegistration(db, actor.companyId)) });
  });

  /** Nome da empresa provisório (contas anteriores às validações do registo). */
  app.post('/v1/registration/company-name', requireAccount, async c => {
    const actor = await requirePrimaryOwner(c);
    const b = z
      .object({
        name: z
          .string()
          .trim()
          .min(2)
          .max(200)
          .refine(v => !registrationNameProblem(v), 'Indique a denominação real da empresa.'),
      })
      .parse(await body(c));
    const db = getDb();
    const resolved = await db.transaction(async tx => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, actor.companyId)).for('update');
      if (!company) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
      if (!registrationNameProblem(company.name))
        throw new DomainError('nome_valido', 'O nome da empresa já cumpre os requisitos.', 409);
      await tx.update(companies).set({ name: b.name }).where(eq(companies.id, company.id));
      await tx.insert(auditLogs).values({
        companyId: company.id,
        actorId: actor.actorId,
        action: 'registration_company_name_corrected',
        entity: 'company',
        entityId: company.id,
        before: { name: company.name },
        after: { name: b.name },
      });
      return clearReviewIfResolved(tx, company.id, actor.actorId);
    });
    await notifyAdminsOfCorrection(db, actor.companyId, `o nome da empresa passou a «${b.name}»`, resolved);
    return c.json({ ok: true, resolved, ...(await companyRegistration(db, actor.companyId)) });
  });

  /** Nome do proprietário provisório. */
  app.post('/v1/registration/owner-name', requireAccount, async c => {
    const actor = await requirePrimaryOwner(c);
    const b = z
      .object({
        name: z
          .string()
          .trim()
          .min(2)
          .max(150)
          .refine(
            v => !ownerNameProblem(v),
            'Indique o nome completo, sem números nem valores como Teste, Demo ou Admin.',
          ),
      })
      .parse(await body(c));
    const db = getDb();
    const resolved = await db.transaction(async tx => {
      const [u] = await tx.select().from(users).where(eq(users.id, actor.actorId)).for('update');
      if (!u) throw new DomainError('nao_encontrado', 'Conta inexistente', 404);
      if (!ownerNameProblem(u.name))
        throw new DomainError('nome_valido', 'O nome do proprietário já cumpre os requisitos.', 409);
      await tx.update(users).set({ name: b.name }).where(eq(users.id, u.id));
      await tx.insert(auditLogs).values({
        companyId: actor.companyId,
        actorId: actor.actorId,
        action: 'registration_owner_name_corrected',
        entity: 'user',
        entityId: u.id,
        before: { name: u.name },
        after: { name: b.name },
      });
      return clearReviewIfResolved(tx, actor.companyId, actor.actorId);
    });
    if (resolved) await notifyAdminsOfCorrection(db, actor.companyId, 'o nome do proprietário', true);
    return c.json({ ok: true, resolved, ...(await companyRegistration(db, actor.companyId)) });
  });

  /** Novo email do proprietário: confirma-se pela ligação enviada para ele, com a palavra-passe actual. */
  app.post('/v1/registration/email', requireAccount, rateLimit('registration-email', 5, 3_600_000), async c => {
    const actor = await requirePrimaryOwner(c);
    const b = z
      .object({
        email: z
          .email('Indique um email válido, no formato nome@empresa.ao.')
          .refine(v => !ownerEmailProblem(v), 'Use um email real a que tenha acesso, não um endereço de teste.'),
        password: z.string().min(1, 'Indique a palavra-passe actual'),
      })
      .parse(await body(c));
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, actor.actorId));
    if (!u || !(await verifyPassword(b.password, u.passwordHash)))
      return c.json({ error: 'credenciais_invalidas', message: 'A palavra-passe actual está errada.' }, 400);
    const sent = await issueEmailChange(db, actor.actorId, b.email);
    return c.json({ ok: true, email: sent.email, ...(await companyRegistration(db, actor.companyId)) });
  });

  return app;
}
