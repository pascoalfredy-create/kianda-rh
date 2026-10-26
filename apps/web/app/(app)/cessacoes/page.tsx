import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { TERMINATION_STATUS } from './status';

export const dynamic = 'force-dynamic';

interface Row { id: string; employeeName: string; employeeNumber: string; reasonLabel: string; effectiveDate: string; status: string; createdAt: string }

export default async function Cessacoes() {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role)) redirect('/');
  const rows = await api<Row[]>('/v1/terminations');
  const canEdit = ['owner', 'hr_admin'].includes(me.user.role);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cessação de contratos</h1>
          <p className="sub">Fecho de contas por motivo (Lei Geral do Trabalho), integração no processamento e documentos de cessação</p>
        </div>
        {canEdit && <Link className="btn" href="/cessacoes/nova">Nova cessação</Link>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Colaborador</th><th>Motivo</th><th>Último dia</th><th>Situação</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/cessacoes/${r.id}`}><b>{r.employeeNumber} · {r.employeeName}</b></Link></td>
                <td>{r.reasonLabel}</td><td>{r.effectiveDate.split('-').reverse().join('/')}</td>
                <td><span className={TERMINATION_STATUS[r.status]?.[1]}>{TERMINATION_STATUS[r.status]?.[0]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nenhuma cessação registada.</div>}
      </div>
    </>
  );
}
