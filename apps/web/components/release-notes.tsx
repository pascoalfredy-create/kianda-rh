'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReleaseNote } from '@/lib/api';

/** Aviso no topo do Kianda com as novidades por ver; fechar ou abrir uma marca-as como vistas. */
export function NewsBanner({ notes }: { notes: ReleaseNote[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden || notes.length === 0) return null;
  const seen = async () => {
    setHidden(true);
    await fetch('/api/v1/release-notes/seen', { method: 'POST' }).catch(() => undefined);
    router.refresh();
  };
  const shown = notes.slice(0, 3);
  return (
    <section className="news-banner no-print" aria-label="Novidades do Kianda">
      <div className="news-head">
        <b>Novidades no Kianda</b>
        <button type="button" className="btn ghost sm" onClick={() => void seen()}>
          Fechar
        </button>
      </div>
      {shown.map(n => (
        <div key={n.slug} className="news-item">
          <b>{n.title}</b>
          <p>{n.body}</p>
          {n.url && (
            <Link href={n.url} onClick={() => void seen()}>
              Abrir →
            </Link>
          )}
        </div>
      ))}
      {notes.length > shown.length && (
        <Link href="/novidades" onClick={() => void seen()}>
          Ver todas as novidades ({notes.length})
        </Link>
      )}
    </section>
  );
}
