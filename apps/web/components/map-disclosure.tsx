'use client';

import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useWorkspaceState } from './workspace-state';

/** Mapas começam recolhidos. O controlo nativo mantém teclado e estado expandido acessíveis. */
export function MapDisclosure({ title, children }: { title: string; children: ReactNode }) {
  const path = usePathname(), search = useSearchParams();
  const params = new URLSearchParams(search.toString()); params.delete('voltar');
  const [open, setOpen] = useWorkspaceState(`map:${path}?${params}:${title}`, false);
  return <details className="map-disclosure" open={open} onToggle={event => { if (event.currentTarget.open !== open) setOpen(event.currentTarget.open); }}><summary><span>{title}</span><span className="map-show">Ver</span><span className="map-hide">Recolher</span></summary><div className="map-content">{children}</div></details>;
}
