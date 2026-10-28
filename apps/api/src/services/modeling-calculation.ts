import { createHash } from 'node:crypto';
import { and, eq, financialModels, getDb } from '@kianda/db';
import { type Ctx } from '../plugins/tenant.js';
import { DomainError } from './payroll.js';

export async function financialModelOf(c: Ctx) {
  const [model] = await getDb().select().from(financialModels).where(and(eq(financialModels.companyId, c.get('actor').companyId), eq(financialModels.id, c.req.param('id')!)));
  if (!model) throw new DomainError('nao_encontrado', 'Projecto inexistente', 404);
  return model;
}

/** Impressão da origem: ordem das chaves não muda o hash; nenhuma fórmula de Excel é enviada. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function financialCalculationSource(model: typeof financialModels.$inferSelect) {
  return {
    model: { id: model.id, name: model.name, sector: model.sector, currency: model.currency, archived: Boolean(model.archivedAt) },
    sourceRevision: model.revision,
    sourceAssumptionsHash: createHash('sha256').update(JSON.stringify(canonical({ assumptions: model.assumptions, sector: model.sector, currency: model.currency }))).digest('hex'),
  };
}
