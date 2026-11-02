import { VALUATION_TRIAL_ANALYSES, valuationCapacity } from '@kianda/core';
import { and, companies, companyModules, eq, isNull, sql, valuationAnalyses, valuationMembers, type Db } from '@kianda/db';
import { DomainError } from './payroll.js';

/** Serializa admissões de utilizadores e criação/restauro de análises dentro da transacção da empresa. */
export async function lockValuationCompany(db: Db, companyId: string) {
  await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('update');
}

export async function valuationUsage(db: Db, companyId: string) {
  const [grant] = await db.select().from(companyModules).where(and(eq(companyModules.companyId, companyId), eq(companyModules.module, 'valuation')));
  const [analyses] = await db.select({ n: sql<number>`count(*)::int` }).from(valuationAnalyses).where(and(eq(valuationAnalyses.companyId, companyId), isNull(valuationAnalyses.archivedAt)));
  const [members] = await db.select({ n: sql<number>`count(*)::int` }).from(valuationMembers).where(and(eq(valuationMembers.companyId, companyId), eq(valuationMembers.enabled, true)));
  return valuationCapacity({ analysisLimit: grant ? grant.projectLimit : VALUATION_TRIAL_ANALYSES, extraUsers: grant?.extraUsers ?? 0 }, analyses?.n ?? 0, members?.n ?? 0);
}

export async function requireAnalysisCapacity(db: Db, companyId: string) {
  await lockValuationCompany(db, companyId);
  if (!(await valuationUsage(db, companyId)).canCreateAnalysis) throw new DomainError('limite_analises', 'Atingiu o número de análises activas contratado. Arquive uma análise ou contacte a plataforma para ampliar.', 409);
}
