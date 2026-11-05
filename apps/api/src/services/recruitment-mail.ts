import { STAGE_LABEL, type Stage } from '@kianda/core';
import { and, asc, companies, eq, inArray, lte, recruitmentMail, type Db } from '@kianda/db';
import { IntegrationError, mailConfig, resendSend } from './integrations.js';
import { renderMail, type MailMessage } from './mail.js';

let flagged = false;
type Runner = (work: (db: Db) => Promise<unknown>) => Promise<unknown>;
let runner: Runner | null = null;
export const setRecruitmentMailRunner = (r: Runner | null) => { runner = r; };
export const takeRecruitmentMailFlag = () => { const value = flagged; flagged = false; return value; };
export function runRecruitmentMailInBackground(waitUntil?: (p: Promise<unknown>) => void) {
  if (!runner) return;
  const work = runner(db => dispatchRecruitmentMail(db)).catch(() => console.error('recruitment_mail_dispatch_failed'));
  if (waitUntil) waitUntil(work);
}
export async function queueRecruitmentMail(db: Db, candidateId: string, eventId: string, message: MailMessage) {
  await db.insert(recruitmentMail).values({ companyId: message.companyId!, candidateId, eventId, kind: message.kind, dedupeKey: `recruitment:${eventId}`, payload: message, status: message.to ? 'pending' : 'no_address', error: message.to ? null : 'Candidato sem email' }).onConflictDoNothing();
  flagged = true;
}
const stageCopy: Record<Stage, string> = {
  applied: 'Recebemos a sua candidatura. A equipa de recrutamento irá analisar o perfil e comunicar os próximos passos.',
  screening: 'A sua candidatura passou para a triagem. A equipa está a analisar a experiência e os requisitos da vaga.',
  interview: 'A sua candidatura passou para a fase de entrevista. A data, o local e as instruções serão comunicados pela equipa de recrutamento.',
  assessment: 'A sua candidatura passou para a prova técnica. A equipa irá comunicar as instruções e os prazos aplicáveis.',
  offer: 'A sua candidatura passou para a fase de proposta. Os termos remuneratórios serão apresentados numa comunicação própria; este aviso não constitui uma proposta contratual.',
  hired: 'A sua admissão foi registada pela equipa de Recursos Humanos. A equipa irá confirmar os próximos passos do acolhimento.',
  rejected: 'A sua candidatura não seguirá para a próxima fase deste processo. Agradecemos o interesse e o tempo dedicado à candidatura.',
  withdrawn: 'Registámos a desistência desta candidatura. Agradecemos o seu interesse.',
};
export async function queueCandidateStage(db: Db, candidate: { id: string; companyId: string; name: string; email: string | null }, openingTitle: string, stage: Stage, eventId: string) {
  const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, candidate.companyId));
  await queueRecruitmentMail(db, candidate.id, eventId, {
    companyId: candidate.companyId, to: candidate.email, kind: 'recruitment_stage', subject: `${co?.name ?? 'Recrutamento'} · ${openingTitle} · ${STAGE_LABEL[stage]}`,
    title: `Candidatura: ${STAGE_LABEL[stage]}`, paragraphs: [`Olá ${candidate.name},`, stageCopy[stage]],
    facts: [['Empresa', co?.name ?? '—'], ['Vaga', openingTitle], ['Referência', `K-${candidate.id.slice(0, 8).toUpperCase()}`]],
  });
}

/** Reclama um lote numa transacção curta; o HTTP ao fornecedor corre depois do commit. */
export async function dispatchRecruitmentMail(db: Db, limit = 10, now = new Date(), companyId?: string) {
  const cfg = mailConfig();
  if (!cfg) return { sent: 0, failed: 0, pendingConfiguration: true };
  const items = await db.transaction(async tx => {
    const due = await tx.select().from(recruitmentMail).where(and(inArray(recruitmentMail.status, ['pending', 'sending']), lte(recruitmentMail.nextAttemptAt, now), ...(companyId ? [eq(recruitmentMail.companyId, companyId)] : []))).orderBy(asc(recruitmentMail.createdAt)).limit(limit).for('update', { skipLocked: true });
    const claimed: typeof due = [];
    for (const row of due) {
      if (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= 23 * 3600000) {
        await tx.update(recruitmentMail).set({ status: 'delivery_unknown', error: 'Entrega não confirmada no prazo de repetição segura. Verifique no fornecedor antes de reenviar.' }).where(eq(recruitmentMail.id, row.id)); continue;
      }
      const [item] = await tx.update(recruitmentMail).set({ status: 'sending', attempts: row.attempts + 1, firstAttemptAt: row.firstAttemptAt ?? now, nextAttemptAt: new Date(now.getTime() + 60000) }).where(eq(recruitmentMail.id, row.id)).returning();
      claimed.push(item!);
    }
    return claimed;
  });
  const outcomes = await Promise.all(items.map(async item => {
    try {
      const m = item.payload as MailMessage;
      const providerId = await resendSend(cfg, { to: m.to!, subject: m.subject, ...renderMail(m), replyTo: m.replyTo, idempotencyKey: item.dedupeKey });
      await db.update(recruitmentMail).set({ status: 'sent', providerId, sentAt: now, error: null, payload: { ...m, paragraphs: [], facts: [], button: null } }).where(eq(recruitmentMail.id, item.id));
      return 'sent';
    } catch (error) {
      const status = error instanceof IntegrationError ? error.status : null;
      const permanent = status != null && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
      await db.update(recruitmentMail).set({ status: permanent || item.attempts >= 6 ? 'failed' : 'pending', error: permanent ? `Fornecedor recusou a mensagem (${status}).` : 'Serviço de email temporariamente indisponível.', nextAttemptAt: new Date(now.getTime() + Math.min(30, 2 ** item.attempts) * 60000) }).where(eq(recruitmentMail.id, item.id));
      return 'failed';
    }
  }));
  return { sent: outcomes.filter(x => x === 'sent').length, failed: outcomes.filter(x => x === 'failed').length, pendingConfiguration: false };
}
