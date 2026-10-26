import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { DecisionButtons } from '../portal/forms';

export const dynamic = 'force-dynamic';

interface Inbox {
  documents: { id: string; employeeId: string; employeeName: string; employeeNumber: string; title: string; inputs: Record<string, string>; createdAt: string }[];
  profiles: { id: string; employeeId: string; employeeName: string; employeeNumber: string; changes: Record<string, string | null>; previous: Record<string, string | null>; note: string | null; createdAt: string }[];
  labels: Record<string, string>;
}
const dt = (d: string) => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });

export default async function Pedidos() {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin'].includes(me.user.role)) redirect('/');
  const inbox = await api<Inbox>('/v1/portal/inbox');
  return (
    <>
      <h1>Pedidos do portal</h1>
      <p className="sub">Declarações e alterações de dados pedidas pelos colaboradores. A emissão automática de declarações liga-se nas <Link href="/definicoes">Definições</Link>.</p>
      <div className="card section">
        <h2>Declarações ({inbox.documents.length})</h2>
        <table className="dense">
          <tbody>
            {inbox.documents.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/colaboradores/${d.employeeId}`}><b>{d.employeeNumber} · {d.employeeName}</b></Link><div className="muted">{dt(d.createdAt)}</div></td>
                <td>{d.title}{Object.values(d.inputs).length > 0 && <div className="muted">{Object.values(d.inputs).join(' · ')}</div>}</td>
                <td className="num"><DecisionButtons approvePath={`/v1/document-requests/${d.id}/issue`} rejectPath={`/v1/document-requests/${d.id}/reject`} approveLabel="Emitir" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!inbox.documents.length && <div className="empty">Sem declarações por emitir.</div>}
      </div>
      <div className="card section">
        <h2>Alterações de dados pessoais ({inbox.profiles.length})</h2>
        <table className="dense">
          <tbody>
            {inbox.profiles.map((p) => (
              <tr key={p.id} style={{ verticalAlign: 'top' }}>
                <td><Link href={`/colaboradores/${p.employeeId}`}><b>{p.employeeNumber} · {p.employeeName}</b></Link><div className="muted">{dt(p.createdAt)}</div>{p.note && <div className="muted">“{p.note}”</div>}</td>
                <td>{Object.entries(p.changes).map(([k, v]) => <div key={k}><b>{inbox.labels[k] ?? k}:</b> <span className="muted" style={{ textDecoration: 'line-through' }}>{p.previous[k] ?? '—'}</span> → <b style={k === 'iban' ? { color: 'var(--amber)' } : undefined}>{v ?? '—'}</b>{k === 'iban' && <span className="tag" style={{ marginLeft: 6 }}>confirmar com o colaborador</span>}</div>)}</td>
                <td className="num"><DecisionButtons approvePath={`/v1/profile-requests/${p.id}/approve`} rejectPath={`/v1/profile-requests/${p.id}/reject`} approveLabel="Aprovar" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!inbox.profiles.length && <div className="empty">Sem alterações por aprovar.</div>}
      </div>
    </>
  );
}
