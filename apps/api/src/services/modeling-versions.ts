import { buildFinancialReportBundle, FINANCIAL_REPORT_VERSION, type FinancialReportBundle, type FinancialReportSource } from '@kianda/core';
import { and, companies, desc, eq, financialModelVersions, financialPersonnelImports, type Db, type financialModels } from '@kianda/db';
import { DomainError } from './payroll.js';
import { financialCalculationSource, financialFingerprint } from './modeling-calculation.js';

export async function financialReportBundle(db: Db, model: typeof financialModels.$inferSelect, metadata: Partial<Pick<FinancialReportSource, 'state' | 'asOf' | 'versionId' | 'versionNumber' | 'versionLabel' | 'approvedByName'>> = {}): Promise<FinancialReportBundle> {
  const [company] = await db.select().from(companies).where(eq(companies.id, model.companyId));
  if (!company) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
  const raw = model.assumptions as Record<string, unknown>;
  for (const key of ['promotor', 'promotorNif']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || (raw[key] as string).length > 200)) throw new DomainError('promotor_invalido', 'A identificação do promotor deve ser texto até 200 caracteres.', 422);
  const imported = await db.select().from(financialPersonnelImports).where(and(eq(financialPersonnelImports.companyId, model.companyId), eq(financialPersonnelImports.modelId, model.id))).orderBy(desc(financialPersonnelImports.importedAt));
  return buildFinancialReportBundle(model.assumptions, {
    modelId: model.id, projectName: model.name, sector: model.sector, currency: model.currency, companyName: company.name, companyNif: company.nif,
    promoter: typeof raw.promotor === 'string' && raw.promotor.trim() ? raw.promotor.trim() : undefined, promoterNif: typeof raw.promotorNif === 'string' ? raw.promotorNif : undefined, revision: model.revision, sourceHash: financialCalculationSource(model).sourceAssumptionsHash, asOf: new Date().toISOString(), state: 'draft', ...metadata,
  }, imported.map((p) => ({ source: p.source, fromPeriod: p.fromPeriod, toPeriod: p.toPeriod, importedAt: p.importedAt.toISOString() })));
}
export async function financialVersionOf(db: Db, companyId: string, modelId: string, versionId: string) {
  const [version] = await db.select().from(financialModelVersions).where(and(eq(financialModelVersions.companyId, companyId), eq(financialModelVersions.modelId, modelId), eq(financialModelVersions.id, versionId)));
  if (!version) throw new DomainError('nao_encontrado', 'Versão inexistente', 404);
  if (version.reportVersion !== FINANCIAL_REPORT_VERSION) throw new DomainError('formato_versao', 'O formato desta versão exige o renderizador correspondente.', 409);
  if (financialFingerprint({ assumptions: version.payload.inputAssumptions, sector: version.payload.source.sector, currency: version.payload.source.currency }) !== version.sourceHash || financialFingerprint(version.payload) !== version.payloadHash) throw new DomainError('integridade_versao', 'O conteúdo da versão não corresponde ao registo de aprovação.', 409);
  return version;
}
