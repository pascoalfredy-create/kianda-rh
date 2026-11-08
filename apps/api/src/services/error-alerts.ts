/**
 * Alerta por email aos administradores da plataforma quando a API devolve um erro interno (500).
 *
 * - Agrupado por assinatura (tipo de erro + rota), no máximo um email por assinatura e por hora (dedupeKey).
 * - Teto global de 10 alertas por hora, para um incidente grande não inundar a caixa de correio.
 * - Sem dados de clientes no corpo: rota, método, tipo e a primeira linha da mensagem (truncada), sem
 *   corpo do pedido, cabeçalhos, cookies ou identificadores da empresa.
 * - Corre depois da resposta e nunca lança.
 */
import { createHash } from 'node:crypto';
import { and, eq, getDb, gte, outboundEmails, platformAdmins, sql } from '@kianda/db';
import { sendMail } from './mail.js';

export const ERROR_ALERTS_PER_HOUR = 10;

export interface ErrorAlertInput { method: string; path: string; error: unknown; at?: Date }

/** Rota sem identificadores (UUID, números) para agrupar erros iguais em pedidos diferentes. */
export const normalisedRoute = (path: string) => path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');

export function errorSignature(input: ErrorAlertInput) {
  const e = input.error as { name?: string; message?: string; code?: string } | null;
  const name = e?.name || 'Error', first = String(e?.message ?? e ?? '').split('\n')[0]!.slice(0, 240);
  const route = `${input.method} ${normalisedRoute(input.path)}`;
  const fingerprint = createHash('sha256').update(`${name}|${e?.code ?? ''}|${route}`).digest('hex').slice(0, 16);
  return { name, first, route, fingerprint };
}

export async function alertServerError(input: ErrorAlertInput): Promise<'sent' | 'limited' | 'duplicate' | 'no_admins' | 'failed'> {
  try {
    const db = getDb(), at = input.at ?? new Date(), sig = errorSignature(input);
    const hour = at.toISOString().slice(0, 13);
    const since = new Date(at.getTime() - 3600_000);
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(outboundEmails).where(and(eq(outboundEmails.kind, 'alerta_erro'), gte(outboundEmails.createdAt, since)));
    if (n >= ERROR_ALERTS_PER_HOUR) return 'limited';
    const admins = await db.select({ email: platformAdmins.email }).from(platformAdmins);
    if (!admins.length) return 'no_admins';
    let outcome: 'sent' | 'duplicate' | 'failed' = 'duplicate';
    for (const { email } of admins) {
      const r = await sendMail(db, {
        to: email, kind: 'alerta_erro', dedupeKey: `api-error:${hour}:${sig.fingerprint}:${email}`,
        subject: `Kianda · erro interno em ${sig.route}`, title: 'Erro interno na API',
        paragraphs: ['A API devolveu um erro interno (500). Este aviso repete-se no máximo uma vez por hora para o mesmo erro.', 'Consulte os registos do Worker para o detalhe completo.'],
        facts: [['Rota', sig.route], ['Tipo', sig.name], ['Mensagem', sig.first || '—'], ['Assinatura', sig.fingerprint], ['Hora (UTC)', at.toISOString()]],
      });
      if (r === 'sent' || r === 'skipped') outcome = 'sent'; else if (r === 'failed' && outcome !== 'sent') outcome = 'failed';
    }
    return outcome;
  } catch {
    return 'failed';
  }
}
