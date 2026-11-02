/**
 * Aceitação electrónica de documentos (regulamento interno, políticas, avisos): o colaborador lê e declara que
 * tomou conhecimento e aceita, no portal. Fica registada a prova — quem, quando, de onde e qual o conteúdo exacto
 * (impressão digital SHA-256 do texto e dos anexos da versão publicada).
 *
 * Não substitui a assinatura quando a lei exige forma escrita assinada (por exemplo, o contrato de trabalho):
 * nesses casos regista a tomada de conhecimento, e o original assinado continua a ser o documento que faz fé.
 */

export const ACK_CATEGORIES = ['regulamento', 'seguranca', 'politica', 'aviso', 'contrato', 'outro'] as const;
export type AckCategory = typeof ACK_CATEGORIES[number];
export const ACK_CATEGORY_LABELS: Record<AckCategory, string> = {
  regulamento: 'Regulamento interno', seguranca: 'Higiene e segurança no trabalho', politica: 'Política interna',
  aviso: 'Aviso ou comunicação', contrato: 'Contrato ou adenda', outro: 'Outro documento',
};

/** Tarefas de acolhimento que ficam feitas quando o colaborador aceita um documento desta categoria. */
export const ACK_CHECKLIST_LINKS: Partial<Record<AckCategory, string>> = { regulamento: 'regulamento' };

export interface AckAudience { all: boolean; departmentIds: string[]; employeeIds: string[] }
export const ACK_MAX_BODY = 60_000;

export function ackAudienceIssue(a: AckAudience): string | null {
  if (!a.all && !a.departmentIds.length && !a.employeeIds.length) return 'Escolha os destinatários: todos, departamentos ou colaboradores.';
  if (a.departmentIds.length > 200 || a.employeeIds.length > 5000) return 'Demasiados destinatários seleccionados.';
  return null;
}

/** O colaborador está entre os destinatários? (todos, o seu departamento ou ele próprio). */
export function ackAudienceIncludes(a: AckAudience, emp: { id: string; departmentId: string | null }): boolean {
  return a.all || a.employeeIds.includes(emp.id) || (!!emp.departmentId && a.departmentIds.includes(emp.departmentId));
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * Impressão digital do conteúdo publicado: título, versão, texto e as impressões dos anexos (ordenadas).
 * Corre no navegador e no servidor (Web Crypto). Qualquer mudança no texto ou nos anexos muda o valor.
 */
export async function ackContentHash(c: { title: string; version: number; body: string; fileHashes: string[] }): Promise<string> {
  const canonical = JSON.stringify({ t: c.title.trim(), v: c.version, b: c.body.replace(/\r\n/g, '\n'), f: [...c.fileHashes].sort() });
  return hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

export type AckState = 'accepted' | 'overdue' | 'pending' | 'cancelled';
export function ackState(r: { status: string; dueDate: string | null }, today: string): AckState {
  if (r.status === 'accepted') return 'accepted';
  if (r.status === 'cancelled') return 'cancelled';
  return r.dueDate && r.dueDate < today ? 'overdue' : 'pending';
}
