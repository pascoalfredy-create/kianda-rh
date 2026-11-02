import { VALUATION_INCLUDED_USERS, VALUATION_TRIAL_ANALYSES, valuationCapacity } from '@kianda/core';
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

/** Um plano (pago ou definido pela plataforma) nunca fica abaixo do uso actual: arquivar análises ou retirar acessos primeiro. */
export async function requireValuationPlanUsage(db: Db, companyId: string, limits: { analysisLimit: number | null; extraUsers: number }) {
  const usage = await valuationUsage(db, companyId);
  if (limits.analysisLimit !== null && usage.activeAnalyses > limits.analysisLimit) throw new DomainError('limite_inferior_ao_uso', `A empresa tem ${usage.activeAnalyses} análises activas. Arquive análises antes de escolher um plano com ${limits.analysisLimit}.`, 409);
  if (usage.enabledUsers > VALUATION_INCLUDED_USERS + limits.extraUsers) throw new DomainError('limite_inferior_ao_uso', `A empresa tem ${usage.enabledUsers} utilizadores com acesso ao Valora: acrescente utilizadores extra ou retire acessos.`, 409);
}

export async function requireAnalysisCapacity(db: Db, companyId: string) {
  await lockValuationCompany(db, companyId);
  if (!(await valuationUsage(db, companyId)).canCreateAnalysis) throw new DomainError('limite_analises', 'Atingiu o número de análises activas contratado. Arquive uma análise ou mude de plano em Módulos e licenças.', 409);
}
