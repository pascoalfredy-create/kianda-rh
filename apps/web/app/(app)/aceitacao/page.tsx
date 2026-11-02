import Link from 'next/link';
import { ACK_CATEGORY_LABELS } from '@kianda/core';
import { api, currentUser } from '@/lib/api';
import { NewAckDocument } from './forms';
import { ACK_STATE, dateTime, DOC_STATUS, pt, type AckDocRow, type MyAck } from './types';

export const dynamic = 'force-dynamic';

/** Aceitação de documentos: o RH publica e acompanha; cada colaborador lê e aceita os que lhe são dirigidos. */
export default async function Aceitacao() {
  const me = (await currentUser())!;
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const [mine, docs] = await Promise.all([
    me.user.employeeId ? api<MyAck[]>('/v1/acknowledgements') : Promise.resolve([] as MyAck[]),
    hr ? api<AckDocRow[]>('/v1/ack-documents') : Promise.resolve([] as AckDocRow[]),
  ]);
  const pending = mine.filter(m => m.status === 'pending'), accepted = mine.filter(m => m.status === 'accepted');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{hr ? 'Aceitação de documentos' : 'Para ler e aceitar'}</h1>
          <p className="sub">{hr ? 'Regulamento interno, políticas e avisos lidos e aceites no portal, com prova de data, hora e conteúdo' : 'Documentos da empresa que lhe pedem para ler e aceitar'}</p>
        </div>
        {hr && <NewAckDocument />}
      </div>

      {me.user.employeeId && <div className="card section">
        <h2>{hr ? 'Para eu ler e aceitar' : 'Por aceitar'}</h2>
        {pending.length ? <table className="dense"><tbody>{pending.map(m => <tr key={m.id}>
          <td><Link href={`/aceitacao/ler/${m.id}`}><b>{m.document.title}</b></Link><div className="muted">{ACK_CATEGORY_LABELS[m.document.category]} · versão {m.document.version}</div></td>
          <td>{m.document.dueDate ? `até ${pt(m.document.dueDate)}` : ''}</td>
          <td><span className={ACK_STATE[m.state][1]}>{ACK_STATE[m.state][0]}</span></td>
          <td className="num"><Link className="btn sm" href={`/aceitacao/ler/${m.id}`}>Ler e aceitar</Link></td>
        </tr>)}</tbody></table> : <div className="empty">Não tem documentos por aceitar.</div>}
        {accepted.length > 0 && <details style={{ padding: '0 16px 12px' }}><summary className="muted" style={{ cursor: 'pointer' }}>Aceites ({accepted.length})</summary>
          <table className="dense"><tbody>{accepted.map(m => <tr key={m.id}><td><Link href={`/aceitacao/ler/${m.id}`}>{m.document.title}</Link> <span className="muted">· versão {m.document.version}</span></td><td>{m.acceptedAt ? dateTime(m.acceptedAt) : ''}</td></tr>)}</tbody></table>
        </details>}
      </div>}

      {hr && <div className="card">
        <table>
          <thead><tr><th>Documento</th><th>Destinatários</th><th>Aceites</th><th>Prazo</th><th>Situação</th></tr></thead>
          <tbody>{docs.map(d => <tr key={d.id}>
            <td><Link href={`/aceitacao/${d.id}`}><b>{d.title}</b></Link><div className="muted">{ACK_CATEGORY_LABELS[d.category]} · versão {d.version}</div></td>
            <td>{d.status === 'draft' ? '—' : d.recipients}</td>
            <td>{d.status === 'draft' ? '—' : <><b>{d.accepted}</b> de {d.recipients}{d.overdue > 0 && <div style={{ color: 'var(--red)', fontSize: 12 }}>{d.overdue} em atraso</div>}</>}</td>
            <td>{d.dueDate ? pt(d.dueDate) : '—'}</td>
            <td><span className={DOC_STATUS[d.status][1]}>{DOC_STATUS[d.status][0]}</span></td>
          </tr>)}</tbody>
        </table>
        {!docs.length && <div className="empty">Ainda não publicou documentos. Comece pelo regulamento interno: os colaboradores aceitam-no no portal e a tarefa do acolhimento fica feita.</div>}
      </div>}
      {hr && <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>A aceitação electrónica regista a tomada de conhecimento e a concordância com prova de data, hora e conteúdo. Não substitui a assinatura quando a lei exige documento escrito e assinado (por exemplo, o contrato de trabalho): nesses casos o original assinado continua a ser o que faz fé.</p>}
    </>
  );
}
