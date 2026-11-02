import type { AckCategory, AckState } from '@kianda/core';

export interface AckFile { id: string; name: string; mime: string; sizeBytes: number; sha256: string; url: string }
export interface AckDocRow { id: string; title: string; category: AckCategory; version: number; status: 'draft' | 'published' | 'archived'; dueDate: string | null; publishedAt: string | null; createdAt: string; recipients: number; accepted: number; pending: number; overdue: number }
export interface AckDocDetail {
  id: string; title: string; body: string; category: AckCategory; version: number; previousId: string | null; status: AckDocRow['status']; dueDate: string | null;
  audience: { all: boolean; departmentIds: string[]; employeeIds: string[] }; contentSha256: string | null; publishedAt: string | null; files: AckFile[];
  departments: { id: string; name: string }[];
  recipients: { requestId: string; employeeId: string; name: string; number: string; department: string | null; status: string; state: AckState; acceptedAt: string | null }[];
}
export interface MyAck { id: string; status: 'pending' | 'accepted'; state: AckState; acceptedAt: string | null; document: { id: string; title: string; category: AckCategory; version: number; dueDate: string | null; publishedAt: string | null } }
export interface AckView {
  id: string; status: string; state: AckState; canAccept: boolean; employee: { id: string; name: string; number: string };
  document: { id: string; title: string; body: string; category: AckCategory; version: number; status: string; dueDate: string | null; publishedAt: string | null; contentSha256: string | null; files: AckFile[] };
  proof: { acceptedAt: string; acceptedByName: string | null; ip: string | null; userAgent: string | null; contentSha256: string } | null;
}

export const pt = (d: string) => d.split('-').reverse().join('/');
export const dateTime = (d: string) => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });
export const ACK_STATE: Record<AckState, [string, string]> = { accepted: ['Aceite', 'st approved'], overdue: ['Em atraso', 'st rejected'], pending: ['Por aceitar', 'st pending'], cancelled: ['Anulado', 'tag'] };
export const DOC_STATUS: Record<AckDocRow['status'], [string, string]> = { draft: ['Rascunho', 'tag'], published: ['Publicado', 'st approved'], archived: ['Arquivado', 'tag'] };
