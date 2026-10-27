const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
/** "2026-11" → "Nov/2026" (partilhado entre servidor e cliente). */
export const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]}/${p.slice(0, 4)}`;
