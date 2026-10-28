import { CYCLES, type BillingCycle } from './licensing.js';
import { kz } from './money.js';
import { FINANCIAL_SECTORS, type FinancialSector } from './modeling/types.js';

/** Modelagem é licenciada por projectos, sem relação com o efectivo do RH. */
export const MODELING_INCLUDED_USERS = 5;
export const MODELING_EXTRA_USER_MONTHLY_MINOR = kz(35_000);
export const MODELING_PLANS = [
  { key: 'pme', label: 'Plano PME', projectLimit: 2, sectorLimit: 2, monthlyMinor: kz(300_000), prices: { monthly: kz(300_000), semiannual: kz(1_620_000), annual: kz(2_880_000) } },
  { key: 'corporate', label: 'Plano Corporate', projectLimit: 5, sectorLimit: 4, monthlyMinor: kz(600_000), prices: { monthly: kz(600_000), semiannual: kz(3_240_000), annual: kz(5_760_000) } },
  { key: 'enterprise10', label: 'Grandes Empresas (Até 10)', projectLimit: 10, sectorLimit: 8, monthlyMinor: kz(1_200_000), prices: { monthly: kz(1_200_000), semiannual: kz(6_480_000), annual: kz(11_520_000) } },
  { key: 'unlimited', label: 'Grandes Empresas (Ilimitado)', projectLimit: null, sectorLimit: 8, monthlyMinor: kz(1_500_000), prices: { monthly: null, semiannual: kz(8_100_000), annual: kz(14_400_000) } },
] as const;
export type ModelingPlanKey = typeof MODELING_PLANS[number]['key'];
export const MODELING_SECTOR_LABELS: Record<FinancialSector, string> = { mineracao: 'Mineração', petroleo: 'Petróleo & Gás', agro: 'Agro-indústria', comercio: 'Comércio & Distribuição', servicos: 'Serviços & Consultoria', industria: 'Indústria transformadora', imobiliario: 'Imobiliário', tecnologia: 'Tecnologia & Telecom' };

/** Sugestão para o registo; o sector principal da Modelagem é mostrado e confirmado pelo cliente. */
export function defaultModelingSector(companySector: string | null | undefined): FinancialSector {
  return ({ mining: 'mineracao', oil_gas: 'petroleo', agriculture: 'agro', commerce: 'comercio', services: 'servicos', manufacturing: 'industria', construction: 'imobiliario', telecom: 'tecnologia' } as Record<string, FinancialSector>)[companySector ?? ''] ?? 'servicos';
}

/** Projectos e sectores são limites distintos. O sector principal nunca é substituído por um adicional. */
export function modelingSectorSelection(planKey: string, primarySector: FinancialSector, selected: readonly string[]): FinancialSector[] {
  const plan = MODELING_PLANS.find(p => p.key === planKey);
  if (!plan || !FINANCIAL_SECTORS.includes(primarySector)) throw new RangeError('Plano ou sector principal inválido.');
  if (selected.some(s => !FINANCIAL_SECTORS.includes(s as FinancialSector)) || new Set(selected).size !== selected.length) throw new RangeError('Escolha sectores válidos, sem repetir.');
  if (selected.length !== plan.sectorLimit || !selected.includes(primarySector)) throw new RangeError(`Este plano requer ${plan.sectorLimit} sectores, incluindo o sector principal do registo.`);
  return FINANCIAL_SECTORS.filter(s => selected.includes(s));
}

/** Os descontos publicados são do plano base; os extras mantêm 35 000 Kz por mês do ciclo. */
export function modelingPlanPrice(planKey: string, cycle: BillingCycle, extraUsers = 0) {
  if (!Number.isSafeInteger(extraUsers) || extraUsers < 0 || extraUsers > 100_000) throw new RangeError('Número de utilizadores extra inválido');
  const plan = MODELING_PLANS.find(p => p.key === planKey);
  if (!plan || plan.prices[cycle] === null) return null;
  const months = CYCLES[cycle].months;
  const extraMinor = extraUsers * MODELING_EXTRA_USER_MONTHLY_MINOR * months;
  const grossMinor = plan.monthlyMinor * months + extraMinor;
  const totalMinor = plan.prices[cycle] + extraMinor;
  return { grossMinor, discountMinor: grossMinor - totalMinor, totalMinor, extraMinor };
}

export interface ModelingLimits { projectLimit: number | null; extraUsers: number }
export function modelingCapacity(limits: ModelingLimits, activeProjects: number, enabledUsers: number) {
  for (const value of [limits.extraUsers, activeProjects, enabledUsers, ...(limits.projectLimit === null ? [] : [limits.projectLimit])]) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Limite inválido');
  if (limits.projectLimit !== null && limits.projectLimit < 1) throw new RangeError('O contrato deve incluir pelo menos um projecto');
  const userLimit = MODELING_INCLUDED_USERS + limits.extraUsers;
  return { projectLimit: limits.projectLimit, includedUsers: MODELING_INCLUDED_USERS, extraUsers: limits.extraUsers, userLimit,
    activeProjects, enabledUsers, canCreateProject: limits.projectLimit === null || activeProjects < limits.projectLimit, canAddUser: enabledUsers < userLimit };
}
/** Ser proprietário de uma empresa cliente não concede acesso aos modelos Excel. */
export function canExportModeling(format: string, actorId: string, configuredProductOwnerId: string | undefined, platformAdmin: boolean): boolean {
  if (format === 'pdf') return true;
  return format === 'xlsx' && Boolean(configuredProductOwnerId) && actorId === configuredProductOwnerId && platformAdmin;
}
