import { CYCLES, DEFAULT_TIERS, MODELING_PLANS, type BillingCycle, type PlatformModule } from '@kianda/core';

export type RegistrationQuery = Record<string, string | string[] | undefined>;
export interface RegistrationSelection { module: PlatformModule; planKey: string; cycle: BillingCycle }

/** A escolha pública preenche o formulário; a API valida os limites e concede apenas a avaliação. */
export function registrationSelection(query: RegistrationQuery): RegistrationSelection {
  const module = query.modulo === 'modeling' ? 'modeling' : 'hr';
  const planKey = module === 'modeling' ? MODELING_PLANS.find(p => p.key === query.plano)?.key ?? 'pme' : DEFAULT_TIERS.find(p => p.key === query.plano)?.key ?? '';
  const cycle = typeof query.ciclo === 'string' && Object.hasOwn(CYCLES, query.ciclo) ? query.ciclo as BillingCycle : 'monthly';
  return { module, planKey, cycle };
}

export function registrationHref(module: PlatformModule, planKey: string, cycle: BillingCycle): string {
  return `/registo?${new URLSearchParams({ modulo: module, plano: planKey, ciclo: cycle })}`;
}
