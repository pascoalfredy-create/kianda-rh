import { CYCLES, DEFAULT_TIERS, MODELING_PLANS, VALUATION_PLANS, type BillingCycle, type PlatformModule } from '@kianda/core';

export type RegistrationQuery = Record<string, string | string[] | undefined>;
export interface RegistrationSelection { module: PlatformModule; planKey: string; cycle: BillingCycle }

/** Compatibilidade com ligações comerciais existentes; o cadastro já não exige escolher planos ou ciclos. */
export function registrationSelection(query: RegistrationQuery): RegistrationSelection {
  const module = query.modulo === 'modeling' ? 'modeling' : query.modulo === 'valuation' ? 'valuation' : 'hr';
  const planKey = module === 'modeling' ? MODELING_PLANS.find(p => p.key === query.plano)?.key ?? 'pme'
    : module === 'valuation' ? VALUATION_PLANS.find(p => p.key === query.plano)?.key ?? 'essencial'
    : DEFAULT_TIERS.find(p => p.key === query.plano)?.key ?? '';
  const cycle = typeof query.ciclo === 'string' && Object.hasOwn(CYCLES, query.ciclo) ? query.ciclo as BillingCycle : 'monthly';
  return { module, planKey, cycle };
}

export function registrationHref(module: PlatformModule, planKey: string, cycle: BillingCycle): string {
  return `/registo?${new URLSearchParams({ modulo: module, plano: planKey, ciclo: cycle })}`;
}
