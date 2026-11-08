/**
 * Receita recorrente mensal (MRR) da consola, por módulo, ao preço efectivamente contratado:
 * o total do ciclo (com o desconto do ciclo) dividido pelos meses do ciclo. Só conta licenças pagas
 * (activas ou em atraso, com data de fim real); avaliações gratuitas e acessos internos (2099) não contam.
 */
import { CYCLES, cyclePrice, modelingPlanPrice, valuationPlanPrice, type BillingCycle, type SubscriptionStatus } from '@kianda/core';
import type { subscriptions } from '@kianda/db';
import { tierOf } from './licence.js';

interface ModuleState { subscribed?: boolean; status: string; paidUntil: string | null; planKey?: string | null; cycle?: string | null; extraUsers?: number }
const paid = (m: { status: string; paidUntil: string | null }) => ['active', 'past_due'].includes(m.status) && !!m.paidUntil && m.paidUntil < '2099-01-01';
const perMonth = (total: number | undefined | null, cycle: string | null | undefined) => total && cycle && cycle in CYCLES ? Math.round(total / CYCLES[cycle as BillingCycle].months) : 0;

export function consoleMrr(sub: typeof subscriptions.$inferSelect | null, hrStatus: SubscriptionStatus, modules: { hr: ModuleState; modeling: ModuleState; valuation: ModuleState }) {
  let hr = 0;
  if (sub && modules.hr.subscribed !== false && paid({ status: hrStatus, paidUntil: sub.paidUntil })) {
    const tier = tierOf(sub), cycle = (sub.cycle ?? 'monthly') as BillingCycle;
    hr = perMonth(cyclePrice(tier, cycle)?.totalMinor, cycle) || (tier.monthlyMinor ?? 0);
  }
  const plan = (m: ModuleState, price: typeof modelingPlanPrice) => m.subscribed !== false && paid(m) && m.planKey && m.cycle ? perMonth(price(m.planKey, m.cycle as BillingCycle, m.extraUsers ?? 0)?.totalMinor, m.cycle) : 0;
  return { hr, modeling: plan(modules.modeling, modelingPlanPrice), valuation: plan(modules.valuation, valuationPlanPrice) };
}
