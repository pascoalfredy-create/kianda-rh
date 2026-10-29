'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** Diálogo nativo: foco contido, Escape e regresso à lista com os filtros. */
export function RhDialog({ title, returnTo, onClose, drawer, children }: { title: string; returnTo?: string; onClose?: () => void; drawer?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const dialog = ref.current!;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = before; };
  }, []);
  const close = () => { if (onClose) onClose(); else if (returnTo) router.push(returnTo, { scroll: false }); };
  return <dialog ref={ref} className={`rh-dialog ${drawer ? 'employee-drawer' : ''}`} aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="rh-dialog-inner"><div className="rh-dialog-head"><b>{title}</b><button type="button" className="dialog-close" aria-label="Fechar janela" onClick={close}>×</button></div><div className="rh-dialog-body">{children}</div></div>
  </dialog>;
}
