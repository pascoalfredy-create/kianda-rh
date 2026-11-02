import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ACK_CATEGORY_LABELS } from '@kianda/core';
import { Attachments } from '@/components/attachments';
import { api, ApiError, currentUser } from '@/lib/api';
import { DocumentActions, DraftEditor } from '../forms';
import { ACK_STATE, dateTime, DOC_STATUS, pt, type AckDocDetail } from '../types';

export const dynamic = 'force-dynamic';

/** RH: rascunho (editar, anexar, publicar) ou documento publicado (quem aceitou, quem falta, versões). */
export default async function DocumentoAceitacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin'].includes(me.user.role)) redirect('/aceitacao');
  const doc = await api<AckDocDetail>(`/v1/ack-documents/${id}`).catch((e: unknown) => { if (e instanceof ApiError && e.status === 404) notFound(); throw e; });
  const people = (await api<{ id: string; name: string; number: string; status?: string; departmentId?: string | null }[]>('/v1/employees')).filter(p => p.status !== 'terminated');
  const accepted = doc.recipients.filter(r => r.status === 'accepted').length, active = doc.recipients.filter(r => r.status !== 'cancelled');
  return (
    <>
      <p className="muted"><Link href="/aceitacao">← Aceitação de documentos</Link></p>
      <div className="page-head">
        <div>
          <h1>{doc.title}</h1>
          <p className="sub">{ACK_CATEGORY_LABELS[doc.category]} · versão {doc.version}{doc.publishedAt ? ` · publicado em ${dateTime(doc.publishedAt)}` : ''}{doc.dueDate ? ` · aceitar até ${pt(doc.dueDate)}` : ''}</p>
        </div>
        <span className={DOC_STATUS[doc.status][1]}>{DOC_STATUS[doc.status][0]}</span>
      </div>
      <DocumentActions doc={doc} people={people} />
      {doc.status === 'draft' ? <>
        <DraftEditor doc={doc} people={people} />
        <div className="card section"><h2>Anexo (PDF)</h2><div style={{ padding: '0 16px 16px' }}><Attachments entity="ack_document" entityId={doc.id} hint="O PDF faz parte do conteúdo aceite: depois de publicar, não se altera." /></div></div>
      </> : <>
        <div className="grid">
          <div className="card kpi"><div className="l">Aceites</div><div className="v">{accepted} de {active.length}</div></div>
          <div className="card kpi"><div className="l">Por aceitar</div><div className="v">{active.length - accepted}</div></div>
        </div>
        <div className="card section">
          <h2>Destinatários</h2>
          <table className="dense">
            <thead><tr><th>Colaborador</th><th>Departamento</th><th>Situação</th><th>Aceite em</th></tr></thead>
            <tbody>{doc.recipients.map(r => <tr key={r.requestId}>
              <td>{r.number} · {r.name}</td><td>{r.department ?? '—'}</td>
              <td><span className={ACK_STATE[r.state][1]}>{ACK_STATE[r.state][0]}</span></td>
              <td>{r.acceptedAt ? <Link href={`/aceitacao/ler/${r.requestId}`}>{dateTime(r.acceptedAt)} · prova</Link> : '—'}</td>
            </tr>)}</tbody>
          </table>
          {!doc.recipients.length && <div className="empty">Sem destinatários activos.</div>}
        </div>
        <div className="card section">
          <h2>Conteúdo publicado</h2>
          {doc.body && <div style={{ padding: '0 16px 12px', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{doc.body}</div>}
          {doc.files.length > 0 && <ul style={{ padding: '0 16px 16px 34px' }}>{doc.files.map(f => <li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul>}
        </div>
      </>}
    </>
  );
}
