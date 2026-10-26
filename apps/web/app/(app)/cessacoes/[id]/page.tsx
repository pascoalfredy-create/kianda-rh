import { formatKz } from '@kianda/core';
import type { TerminationDetail } from '../types';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { TerminationActions, TerminationEditor } from '../editor';
import { TERMINATION_STATUS } from '../status';

export const dynamic = 'force-dynamic';

const pt = (d: string) => d.split('-').reverse().join('/');

export default async function Cessacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  const d = await api<TerminationDetail>(`/v1/terminations/${id}`);
  const canEdit = ['owner', 'hr_admin'].includes(me.user.role);
  return (
    <>
      <div className="crumb"><Link href="/cessacoes">Cessações</Link> / {d.employee.name}</div>
      <div className="page-head">
        <div>
          <h1>{d.reasonLabel}</h1>
          <p className="sub"><Link href={`/colaboradores/${d.employee.id}`}>{d.employee.number} · {d.employee.name}</Link> · último dia {pt(d.effectiveDate)} · <span className={TERMINATION_STATUS[d.status]?.[1]}>{TERMINATION_STATUS[d.status]?.[0]}</span></p>
        </div>
        {d.status === 'confirmed' && (
          <span className="actions">
            <Link className="btn ghost" href={`/cessacoes/${d.id}/fecho`}>Fecho de contas</Link>
            <Link className="btn ghost" href={`/cessacoes/${d.id}/certificado`}>Certificado de trabalho</Link>
          </span>
        )}
      </div>
      {d.cancelNote && <div className="warn">Anulada: {d.cancelNote}</div>}
      {canEdit && d.status !== 'cancelled' && <TerminationActions id={d.id} status={d.status} />}
      {d.status === 'confirmed' && <div className="warn">Confirmada. O fecho de contas está nas variáveis de {d.period.slice(5)}/{d.period.slice(0, 4)}: volte a preparar o processamento desse mês para o incluir no recibo final.</div>}
      {d.status === 'draft' && canEdit ? (
        <TerminationEditor init={{ id: d.id, employeeId: d.employeeId, reason: d.reason, effectiveDate: d.effectiveDate, noticeDate: d.noticeDate, agreedCompensationMinor: d.agreedCompensationMinor, items: d.items, note: d.note }} />
      ) : (
        <div className="card section">
          <h2>Fecho de contas</h2>
          <table className="dense">
            <thead><tr><th>Rubrica</th><th>Base de cálculo</th><th className="num">Abono</th><th className="num">Desconto</th></tr></thead>
            <tbody>{d.items.map((x, i) => <tr key={i}><td>{x.label}</td><td className="muted">{x.basis}</td><td className="num">{x.kind === 'earning' ? formatKz(x.amountMinor) : ''}</td><td className="num">{x.kind === 'deduction' ? formatKz(x.amountMinor) : ''}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}><b>Totais</b></td><td className="num"><b>{formatKz(d.totals.earningsMinor)}</b></td><td className="num"><b>{formatKz(d.totals.deductionsMinor)}</b></td></tr></tfoot>
          </table>
          {d.payslip && <p style={{ padding: '10px 16px' }}>Líquido estimado do recibo final: <b>{formatKz(d.payslip.netMinor)}</b></p>}
        </div>
      )}
    </>
  );
}
