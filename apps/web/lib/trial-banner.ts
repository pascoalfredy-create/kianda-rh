import { trialDaysRemaining } from '@kianda/core';

/**
 * Texto único da avaliação gratuita para o RH, o Integra e o Valora: data em dd/mm/aaaa, dias que faltam
 * (hora de Angola, incluindo hoje) e o que muda com a subscrição.
 */
export function trialBannerText(product: 'Kianda' | 'Integra' | 'Valora', until: string, today: string): string {
  const date = until.split('-').reverse().join('/'), days = trialDaysRemaining(until, today);
  const head = days <= 1 ? `Último dia da avaliação gratuita${product === 'Kianda' ? '' : ` do ${product}`} (${date}).` : `Avaliação gratuita${product === 'Kianda' ? '' : ` do ${product}`} até ${date} · ${days} dias, incluindo hoje.`;
  return `${head} Pode usar tudo; para exportar e imprimir, escolha um plano.`;
}
