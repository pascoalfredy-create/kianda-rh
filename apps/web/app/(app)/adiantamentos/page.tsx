import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { CancelAdvance, DecideAdvance, PayAdvance, RequestForm } from './forms';
import { monthLabel } from './format';

export const dynamic = 'force-dynamic';

interface Advance {
  id: string; number: string; amountMinor: number; installments: number; firstPeriod: string; reason: string | null; status: string; decisionNote: string | null;
  writtenRequestAt: string; paidOn: string | null; employee: { id: string; name: string; number: string };
  plan: { period: string; amountMinor: number; deducted: boolean }[]; repaidMinor: number; outstandingMinor: number;
}
const STATUS: Record<string, [string, string]> = {
  pending: ['Pendente', 'st pending'], approved: ['Aprovado — por pagar', 'st pending'], paid: ['Pago — em reembolso', 'st approved'],
  rejected: ['Recusado', 'st rejected'], cancelled: ['Cancelado', 'tag'],
};
const DECIDE = ['owner', 'hr_admin', 'payroll'];
const PAY = ['owner', 'finance', 'payroll'];

export default async function Adiantamentos() {
  const me = (await currentUser())!;
  const role = me.user.role;
  const staff = DECIDE.includes(role) || PAY.includes(role);
  const list = await api<Advance[]>('/v1/advances');
  const employees = DECIDE.includes(role) ? (await api<{ id: string; name: string; status: string }[]>('/v1/employees')).filter((e) => e.status === 'active') : undefined;
  const accounts = PAY.includes(role) ? await api<{ id: string; name: string }[]>('/v1/bank/accounts').catch(() => []) : [];
  const open = list.filter((a) => a.status === 'pending' || a.status === 'approved');
  const done = list.filter((a) => !(a.status === 'pending' || a.status === 'approved'));
  const row = (a: Advance) => (
    <tr key={a.id} style={{ verticalAlign: 'top' }}>
      <td><b>{a.number}</b>{staff && <div><Link href={`/colaboradores/${a.employee.id}`}>{a.employee.name}</Link></div>}<div className="muted" style={{ fontSize: 12 }}>pedido escrito a {new Date(a.writtenRequestAt).toLocaleDateString('pt-PT')}{a.reason ? ` · ${a.reason}` : ''}</div></td>
      <td className="num"><b>{formatKz(a.amountMinor)}</b>{a.status === 'paid' && <div className="muted" style={{ fontSize: 12 }}>em dívida {formatKz(a.outstandingMinor)}</div>}</td>
      <td style={{ fontSize: 12.5 }}>{a.plan.map((p) => <div key={p.period} style={p.deducted ? { color: 'var(--ink3)', textDecoration: 'line-through' } : undefined}>{monthLabel(p.period)} · {formatKz(p.amountMinor)}</div>)}</td>
      <td><span className={STATUS[a.status]?.[1]}>{STATUS[a.status]?.[0]}</span>{a.decisionNote && <div className="muted" style={{ fontSize: 12 }}>{a.decisionNote}</div>}{a.paidOn && <div className="muted" style={{ fontSize: 12 }}>pago a {a.paidOn.split('-').reverse().join('/')}</div>}</td>
      <td className="num">
        {a.status === 'pending' && DECIDE.includes(role) && a.employee.id !== me.user.employeeId && <DecideAdvance id={a.id} installments={a.installments} firstPeriod={a.firstPeriod} />}
        {a.status === 'approved' && PAY.includes(role) && <PayAdvance id={a.id} accounts={accounts} />}
        {(a.status === 'pending' && (a.employee.id === me.user.employeeId || DECIDE.includes(role))) || (a.status === 'approved' && DECIDE.includes(role)) ? <div style={{ marginTop: 6 }}><CancelAdvance id={a.id} /></div> : null}
      </td>
    </tr>
  );
  return (
    <>
      <h1>Adiantamentos salariais</h1>
      <p className="sub">Pedido escrito, aprovação com plano de prestações e reembolso automático no processamento — até 3 salários base em dívida e prestações até 25% do salário líquido (LGT, art. 248.º).</p>
      {me.user.employeeId && (
        <div className="card section"><h2>Pedir um adiantamento</h2><RequestForm /></div>
      )}
      {employees && (
        <details className="card section"><summary style={{ padding: '14px 16px', cursor: 'pointer', fontWeight: 600 }}>Registar um pedido em nome de um colaborador (pedido escrito em papel)</summary><RequestForm employees={employees} /></details>
      )}
      <div className="card section">
        <h2>{staff ? 'Por decidir e por pagar' : 'Os meus pedidos em curso'}</h2>
        {open.length ? <table className="dense"><tbody>{open.map(row)}</tbody></table> : <div className="empty">Nenhum pedido em curso.</div>}
      </div>
      {done.length > 0 && (
        <div className="card section"><h2>Histórico</h2><table className="dense"><tbody>{done.map(row)}</tbody></table></div>
      )}
    </>
  );
}
