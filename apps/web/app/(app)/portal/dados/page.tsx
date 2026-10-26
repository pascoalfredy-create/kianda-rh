import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { CancelRequest, ProfileRequestForm } from '../forms';

export const dynamic = 'force-dynamic';

interface Req { id: string; status: string; createdAt: string; changes: Record<string, string | null>; previous: Record<string, string | null>; decisionNote: string | null }
const STATUS: Record<string, [string, string]> = { pending: ['Pendente', 'st pending'], approved: ['Aprovado', 'st approved'], rejected: ['Recusado', 'st rejected'], cancelled: ['Retirado', 'tag'] };

export default async function MeusDados() {
  const me = (await currentUser())!;
  if (!me.user.employeeId) redirect('/');
  const [e, { requests, labels }] = await Promise.all([
    api<Record<string, string | null> & { name: string; number: string; biNumber: string | null; nif: string | null; inssNumber: string | null; jobTitle: string }>(`/v1/employees/${me.user.employeeId}`),
    api<{ requests: Req[]; labels: Record<string, string> }>('/v1/profile-requests?scope=mine'),
  ]);
  const pending = requests.some((r) => r.status === 'pending');
  return (
    <>
      <div className="crumb"><Link href="/">Início</Link> / Os meus dados</div>
      <h1>Os meus dados</h1>
      <p className="sub">{e.name} · n.º {e.number} · {e.jobTitle}. Identificação (BI {e.biNumber ?? '—'}, NIF {e.nif ?? '—'}, INSS {e.inssNumber ?? '—'}) só pode ser alterada pelo RH com o documento.</p>
      {pending && <div className="warn">Tem um pedido pendente. Pode enviar outro, mas o RH trata-os por ordem.</div>}
      <ProfileRequestForm current={{ phone: e.phone, email: e.email, address: e.address, maritalStatus: e.maritalStatus, emergencyContactName: e.emergencyContactName, emergencyContactPhone: e.emergencyContactPhone, iban: e.iban, bank: e.bank }} />
      {requests.length > 0 && (
        <div className="card section" style={{ marginTop: 16 }}>
          <h2>Pedidos de alteração</h2>
          <table className="dense">
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={{ width: 110 }} className="muted">{new Date(r.createdAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}</td>
                  <td>{Object.entries(r.changes).map(([k, v]) => <div key={k}><b>{labels[k] ?? k}:</b> <span className="muted">{r.previous[k] ?? '—'}</span> → {v ?? '—'}</div>)}{r.decisionNote && <div className="muted">RH: {r.decisionNote}</div>}</td>
                  <td className="num"><span className={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</span> {r.status === 'pending' && <CancelRequest id={r.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
