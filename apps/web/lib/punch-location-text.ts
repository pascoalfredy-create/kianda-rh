import type { PunchLocation } from './types';

/** Textos da localização de uma marcação (sem 'use client': usados também em componentes do servidor). */
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`);
/** Texto curto para a chefia/colaborador. */
export function describeLocation(l: PunchLocation | null | undefined): string {
  if (!l) return '';
  const base = describePlace(l);
  const flags = [l.signals?.includes('shared_device') ? 'telemóvel usado hoje por outro colaborador' : '', l.signals?.includes('foreign_network') ? `rede fora de Angola${l.country ? ` (${l.country})` : ''}` : ''].filter(Boolean);
  return flags.length ? `${base} · ATENÇÃO: ${flags.join('; ')}` : base;
}
function describePlace(l: PunchLocation): string {
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

