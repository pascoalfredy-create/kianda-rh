import { blockingChecks, registrationChecklist, type RegistrationCheck } from '@kianda/core';
import { and, asc, auditLogs, companies, eq, platformAdmins, users, type Db } from '@kianda/db';
import { maskEmail, pendingEmailChange } from './email-verification.js';
import { appBaseUrl } from './integrations.js';
import { platformSettingsGet } from './licence.js';
import { sendMail } from './mail.js';

type Company = typeof companies.$inferSelect;

/** Proprietário principal (o mais antigo): é ele que responde pelos dados do cadastro. */
export async function primaryOwner(db: Pick<Db, 'select'>, companyId: string) {
  const [owner] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, 'owner')))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return owner ?? null;
}

export function checklistFor(
  company: Pick<Company, 'name' | 'nif' | 'registrationReviewReasons'>,
  owner: { name: string; email: string | null } | null,
  pendingEmail: string | null,
): RegistrationCheck[] {
  return registrationChecklist({
    companyName: company.name,
    nif: company.nif,
    ownerName: owner?.name ?? null,
    ownerEmail: owner?.email ?? null,
    pendingEmail,
    inReview: company.registrationReviewReasons.length > 0,
  });
}

/** Lista de pontos de uma empresa, com o email do proprietário mascarado (cliente e consola). */
export async function companyRegistration(db: Db, companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return null;
  const owner = await primaryOwner(db, companyId);
  const pending = owner ? await pendingEmailChange(db, owner.id) : null;
  const items = checklistFor(company, owner, pending).map(item =>
    item.key === 'ownerEmail' ? { ...item, value: maskEmail(item.value) || null } : item,
  );
  return {
    inReview: company.registrationReviewReasons.length > 0,
    items,
    blocking: blockingChecks(items).length,
    ownerId: owner?.id ?? null,
  };
}

/**
 * Depois de uma correcção do cliente: se já nada bloqueia (além da confirmação manual sem motivo),
 * o cadastro deixa de estar em revisão. Corre dentro da transacção da correcção.
 */
export async function clearReviewIfResolved(
  tx: Pick<Db, 'select' | 'update' | 'insert'>,
  companyId: string,
  actorId: string,
): Promise<boolean> {
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for('update');
  if (!company?.registrationReviewReasons.length) return false;
  const owner = await primaryOwner(tx, companyId);
  const left = blockingChecks(checklistFor(company, owner, null)).filter(i => i.key !== 'review');
  if (left.length) return false;
  await tx.update(companies).set({ registrationReviewReasons: [] }).where(eq(companies.id, companyId));
  await tx.insert(auditLogs).values({
    companyId,
    actorId,
    action: 'registration_resolved_by_client',
    entity: 'company',
    entityId: companyId,
    before: { registrationReviewReasons: company.registrationReviewReasons },
    after: { registrationReviewReasons: [] },
  });
  return true;
}

/** Aviso à administração: o cliente corrigiu dados do cadastro (e se isso o desbloqueou). */
export async function notifyAdminsOfCorrection(db: Db, companyId: string, change: string, resolved: boolean) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return;
  const base = appBaseUrl();
  for (const a of await db.select().from(platformAdmins))
    await sendMail(db, {
      to: a.email,
      // Associado à empresa: o pedido do cliente corre restrito a ela (segurança por empresa).
      companyId: company.id,
      kind: 'plataforma_cadastro_corrigido',
      subject: `Cadastro corrigido pelo cliente — ${company.name}`,
      title: 'Cadastro corrigido pelo cliente',
      paragraphs: [
        `${company.name} (NIF ${company.nif}) corrigiu: ${change}.`,
        resolved
          ? 'Já nada bloqueava o acesso, por isso a empresa ficou desbloqueada automaticamente. Reveja a ficha se quiser confirmar.'
          : 'A empresa continua em revisão.',
      ],
      button: base ? { label: 'Abrir a ficha', url: `${base}/plataforma/empresas/${company.id}` } : null,
    });
}

/** Email ao proprietário quando a equipa aprova o cadastro, com o que ainda falta corrigir. */
export async function sendRegistrationApproved(db: Db, companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const owner = await primaryOwner(db, companyId);
  if (!company || !owner?.email) return;
  const pending = await pendingEmailChange(db, owner.id);
  const remaining = checklistFor(company, owner, pending).filter(i => i.status !== 'ok');
  const base = appBaseUrl(),
    settings = await platformSettingsGet(db);
  await sendMail(db, {
    to: owner.email,
    companyId,
    kind: 'cadastro_aprovado',
    subject: `Cadastro aprovado — ${company.name}`,
    title: 'O seu cadastro foi aprovado',
    paragraphs: [
      `A equipa Kianda confirmou os dados de ${company.name}. Os módulos escolhidos já estão disponíveis.`,
      ...remaining.map(i => `Falta ainda: ${i.label.toLowerCase()} — ${i.message ?? 'por corrigir'}`),
    ],
    button: base ? { label: 'Entrar no Kianda', url: `${base}/modulos` } : null,
    replyTo: settings.supportEmail,
  });
}

/** Pontos do registo para o email de boas-vindas (só o que não cumpre). */
export function welcomeChecklistLines(items: RegistrationCheck[]) {
  return items
    .filter(i => i.status !== 'ok')
    .map(i => `${i.label}: ${i.message ?? 'por confirmar'}${i.blocking ? ' (bloqueia o acesso aos módulos)' : ''}`);
}
