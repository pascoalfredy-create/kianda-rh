import { createHash } from 'node:crypto';
import { and, companies, eq, financialModels, getDb } from '@kianda/db';
import { type Ctx } from '../plugins/tenant.js';
import { DomainError } from './payroll.js';

export async function financialModelOf(c: Ctx, coherentHistory = false) {
  const db = getDb(), companyId = c.get('actor').companyId;
  // A revisão e os balancetes devem pertencer ao mesmo estado. A empresa é bloqueada
  // primeiro, na ordem usada pela criação/arquivo, sem impedir consultas concorrentes.
  if (coherentHistory) await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('key share');
  const query = db.select().from(financialModels).where(and(eq(financialModels.companyId, companyId), eq(financialModels.id, c.req.param('id')!)));
  const [model] = coherentHistory ? await query.for('share') : await query;
  if (!model) throw new DomainError('nao_encontrado', 'Projecto inexistente', 404);
  return model;
}

/** Impressão da origem: ordem das chaves não muda o hash; nenhuma fórmula de Excel é enviada. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function financialFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function financialCalculationSource(model: typeof financialModels.$inferSelect) {
  return {
    model: { id: model.id, name: model.name, sector: model.sector, currency: model.currency, archived: Boolean(model.archivedAt) },
    sourceRevision: model.revision,
    sourceAssumptionsHash: financialFingerprint({ assumptions: model.assumptions, sector: model.sector, currency: model.currency }),
  };
}
