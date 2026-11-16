import Link from 'next/link';
import { api, type ReleaseNote } from '@/lib/api';

export const dynamic = 'force-dynamic';

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat('pt-AO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Luanda',
  }).format(new Date(iso));

export default async function Novidades() {
  const notes = await api<ReleaseNote[]>('/v1/release-notes');
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Novidades</h1>
          <p className="sub">O que mudou no Kianda, da actualização mais recente para a mais antiga.</p>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="card empty">Ainda não há novidades para o seu perfil.</div>
      ) : (
        <div className="news-list">
          {notes.map(n => (
            <article key={n.slug} className="card news-item">
              <small className="muted">
                {dateLabel(n.publishedAt)}
                {n.unread && (
                  <span className="pill" style={{ marginLeft: 8 }}>
                    Nova
                  </span>
                )}
              </small>
              <h2>{n.title}</h2>
              <p>{n.body}</p>
              {n.url && <Link href={n.url}>Abrir →</Link>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
