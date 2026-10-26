/** Formatação partilhada (servidor e cliente). */
export const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const shiftMonth = (period: string, delta: number) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Mês corrente em Luanda (UTC+1). */
export const currentPeriod = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);
