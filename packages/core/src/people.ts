/**
 * Regras da ficha do colaborador: remuneração em vigor, documentos com validade e hierarquia.
 * Funções puras — sem base de dados — para serem testadas e reutilizadas na API e no frontend.
 */
import { daysBetween } from './calendar.js';
import type { Minor } from './money.js';

// ───────────────────────── Remuneração ─────────────────────────

export interface CompensationChange {
  effectiveDate: string; // AAAA-MM-DD
  baseMinor: Minor;
  mealMinor: Minor;
  transportMinor: Minor;
  reason?: string;
}

/** Remuneração em vigor numa data: a última alteração com efeito igual ou anterior a essa data. */
export function compensationAt<T extends CompensationChange>(changes: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const c of changes) {
    if (c.effectiveDate <= date && (!best || c.effectiveDate > best.effectiveDate)) best = c;
  }
  return best;
}

/** Variação percentual (em pontos base) do salário base face à alteração anterior. */
export function compensationHistory<T extends CompensationChange>(changes: readonly T[]): (T & { previousBaseMinor: Minor | null; changeBps: number | null })[] {
  const sorted = [...changes].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return sorted.map((c, i) => {
    const prev = i > 0 ? sorted[i - 1]!.baseMinor : null;
    return { ...c, previousBaseMinor: prev, changeBps: prev ? Math.round(((c.baseMinor - prev) / prev) * 10_000) : null };
  });
}

// ───────────────────────── Documentos ─────────────────────────

export const DOCUMENT_TYPES = {
  bi: 'Bilhete de Identidade',
  passport: 'Passaporte',
  residence_card: 'Cartão de Residente',
  work_visa: 'Visto de Trabalho',
  driving_licence: 'Carta de Condução',
  professional_card: 'Carteira Profissional',
  other: 'Outro',
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export interface IdentityDocument { id?: string; type: DocumentType; number: string; expiryDate?: string | null }
export interface DocumentAlert { documentId?: string; type: DocumentType; kind: 'expired' | 'expiring'; daysLeft: number; message: string }

/** Documentos caducados ou a caducar dentro da janela (por omissão 60 dias). */
export function documentAlerts(docs: readonly IdentityDocument[], today: string, windowDays = 60): DocumentAlert[] {
  const out: DocumentAlert[] = [];
  for (const d of docs) {
    if (!d.expiryDate) continue;
    const left = daysBetween(today, d.expiryDate);
    const label = DOCUMENT_TYPES[d.type];
    if (left < 0) out.push({ documentId: d.id, type: d.type, kind: 'expired', daysLeft: left, message: `${label}: caducou há ${-left} dia(s)` });
    else if (left <= windowDays) out.push({ documentId: d.id, type: d.type, kind: 'expiring', daysLeft: left, message: `${label}: caduca em ${left} dia(s)` });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ───────────────────────── Hierarquia ─────────────────────────

export interface OrgNode { id: string; managerId: string | null }

/**
 * Verdadeiro se atribuir `managerId` como chefia de `employeeId` criar um ciclo
 * (o próprio, ou alguém que já está abaixo dele na hierarquia).
 */
export function createsCycle(nodes: readonly OrgNode[], employeeId: string, managerId: string | null): boolean {
  if (!managerId) return false;
  if (managerId === employeeId) return true;
  const managerOf = new Map(nodes.map((n) => [n.id, n.managerId]));
  let cur: string | null | undefined = managerId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === employeeId) return true;
    if (seen.has(cur)) return true; // ciclo já existente nos dados
    seen.add(cur);
    cur = managerOf.get(cur);
  }
  return false;
}

export type OrgTree<T> = T & { reports: OrgTree<T>[] };

/** Constrói a árvore do organograma. Chefias inexistentes (ou de outra empresa) tornam o nó raiz. */
export function buildOrgTree<T extends OrgNode>(nodes: readonly T[], sortKey: (n: T) => string = (n) => n.id): OrgTree<T>[] {
  const byId = new Map<string, OrgTree<T>>(nodes.map((n) => [n.id, { ...n, reports: [] }]));
  const roots: OrgTree<T>[] = [];
  for (const n of byId.values()) {
    const parent = n.managerId ? byId.get(n.managerId) : undefined;
    if (parent && !createsCycle(nodes, n.id, n.managerId)) parent.reports.push(n);
    else roots.push(n);
  }
  const sort = (list: OrgTree<T>[]) => {
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    list.forEach((n) => sort(n.reports));
  };
  sort(roots);
  return roots;
}
