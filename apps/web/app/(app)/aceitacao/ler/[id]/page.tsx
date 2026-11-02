import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ACK_CATEGORY_LABELS } from '@kianda/core';
import { api, ApiError } from '@/lib/api';
import { AcceptForm } from '../../forms';
import { ACK_STATE, dateTime, pt, type AckView } from '../../types';

export const dynamic = 'force-dynamic';

/** Ler e aceitar (o próprio) ou consultar a prova da aceitação (o próprio e o RH). */
export default async function LerDocumento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await api<AckView>(`/v1/acknowledgements/${id}`).catch((e: unknown) => { if (e instanceof ApiError && e.status === 404) notFound(); throw e; });
  const d = v.document;
  return (
    <>
      <p className="muted"><Link href="/aceitacao">← Documentos para aceitação</Link></p>
      <div className="page-head">
        <div>
          <h1>{d.title}</h1>
          <p className="sub">{ACK_CATEGORY_LABELS[d.category]} · versão {d.version}{d.publishedAt ? ` · publicado em ${dateTime(d.publishedAt)}` : ''}{d.dueDate ? ` · aceitar até ${pt(d.dueDate)}` : ''} · {v.employee.name}</p>
        </div>
        <span className={ACK_STATE[v.state][1]}>{ACK_STATE[v.state][0]}</span>
      </div>
      {d.status !== 'published' && v.status !== 'accepted' && <div className="warn">Este documento foi substituído por uma versão mais recente ou arquivado.</div>}
      <article className="card section">
        {d.body && <div style={{ padding: '16px 20px', whiteSpace: 'pre-wrap', lineHeight: 1.75, fontSize: 14.5 }}>{d.body}</div>}
        {d.files.length > 0 && <div style={{ padding: '0 20px 16px' }}><b>Anexos</b><ul style={{ margin: '6px 0 0 18px' }}>{d.files.map(f => <li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a> <span className="muted">(abrir e ler antes de aceitar)</span></li>)}</ul></div>}
      </article>
      {v.canAccept && d.contentSha256 && <AcceptForm requestId={v.id} contentSha256={d.contentSha256} />}
      {v.proof && <div className="card section">
        <h2>Prova da aceitação</h2>
        <table className="dense"><tbody>
          <tr><th>Aceite por</th><td>{v.proof.acceptedByName}{v.proof.acceptedByName !== v.employee.name ? ` (${v.employee.name})` : ''} · ficha n.º {v.employee.number}</td></tr>
          <tr><th>Data e hora (Luanda)</th><td>{dateTime(v.proof.acceptedAt)}</td></tr>
          <tr><th>Endereço de rede</th><td>{v.proof.ip ?? '—'}</td></tr>
          <tr><th>Navegador</th><td style={{ fontSize: 12 }}>{v.proof.userAgent || '—'}</td></tr>
        </tbody></table>
        <p className="muted" style={{ padding: '8px 16px 14px', fontSize: 12.5 }}>O registo identifica o texto e os anexos exactos desta versão.</p>
      </div>}
    </>
  );
}
