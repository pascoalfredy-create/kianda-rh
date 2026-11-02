import type { PunchLocation } from './types';

/** Textos da localização de uma marcação (sem 'use client': usados também em componentes do servidor). */
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`);
/** Texto curto para a chefia/colaborador. */
export function describeLocation(l: PunchLocation | null | undefined): string {
  if (!l) return '';
  const how = l.method === 'kiosk' ? 'código do quiosque' : l.method === 'gps' ? `GPS${l.accuracy !== undefined ? ` ±${metres(l.accuracy)}` : ''}` : 'sem localização';
  switch (l.status) {
    case 'ok': return `No local «${l.workplaceName ?? '—'}» (${how})`;
    case 'outside': return `Fora do local: ${l.distance !== null ? `a ${metres(l.distance)} de ` : ''}«${l.workplaceName ?? '—'}» (${how})`;
    case 'unavailable': return 'Localização indisponível ou imprecisa';
    default: return `Posição registada (${how}); sem locais configurados`;
  }
}
export const mapLink = (l: PunchLocation | null | undefined) =>
  l && l.lat !== undefined && l.lng !== undefined ? `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=17/${l.lat}/${l.lng}` : null;

