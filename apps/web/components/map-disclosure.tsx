import type { ReactNode } from 'react';

/** Mapas começam recolhidos. O controlo nativo mantém teclado e estado expandido acessíveis. */
export function MapDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="map-disclosure"><summary><span>{title}</span><span className="map-show">Ver</span><span className="map-hide">Recolher</span></summary><div className="map-content">{children}</div></details>;
}
