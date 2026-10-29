import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { CLAIM_STATUS } from './status';

export const dynamic = 'force-dynamic';

interface Claim { id: string; number: string; title: string; status: string; totalMinor: number; employeeName: string; createdAt: string; submittedAt: string | null; paidOn: string | null }

export default async function Despesas({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const role = me.user.role;
  const tabs: [string, string][] = [];
  if (me.user.employeeId) tabs.push(['mine', 'As minhas']);
  if (['owner', 'hr_admin', 'manager'].includes(role)) tabs.push(['approve', 'Para aprovar']);
  if (['owner', 'finance'].includes(role)) tabs.push(['pay', 'Por reembolsar']);
  if (['owner', 'hr_admin', 'finance', 'payroll'].includes(role)) tabs.push(['all', 'Todas']);
  const view = tabs.find(([k]) => k === sp.v)?.[0] ?? tabs[0]?.[0] ?? 'mine';
  const claims = await api<Claim[]>(`/v1/expenses?scope=${view}`);
  const overview = view === 'all' || !tabs.some(([k]) => k === 'all') ? claims : await api<Claim[]>('/v1/expenses?scope=all');
  const sum = (...states: string[]) => overview.filter(c => states.includes(c.status)).reduce((s, c) => s + c.totalMinor, 0);
  const total = claims.reduce((s, c) => s + c.totalMinor, 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Despesas e ajudas de custo</h1>
          <p className="sub">Notas de despesas com recibos e diárias, aprovação pela chefia e reembolso pelas Finanças</p>
        </div>
        <span className="actions">
          {view === 'pay' && claims.length > 0 && <a className="btn ghost" href="/api/v1/expenses-bank-file">Ficheiro de transferências (CSV)</a>}
          <Link className="btn" href="/despesas/nova">Nova nota de despesas</Link>
        </span>
      </div>
      <div className="rh-kpis three"><div className="card kpi"><div className="l">Pendentes de aprovação</div><div className="v">{formatKz(sum('submitted'))}</div></div><div className="card kpi"><div className="l">Aprovadas por pagar</div><div className="v">{formatKz(sum('approved'))}</div></div><div className="card kpi"><div className="l">Pagas</div><div className="v">{formatKz(sum('paid'))}</div></div></div>
      {tabs.length > 1 && <nav className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`?v=${k}`} className={view === k ? 'on' : ''}>{l}</Link>)}</nav>}
      <div className="card">
        <table>
          <thead><tr><th>Nota</th>{view !== 'mine' && <th>Colaborador</th>}<th>Motivo</th><th>Situação</th><th className="num">Total</th></tr></thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/despesas/${c.id}`}><b>{c.number}</b></Link></td>
                {view !== 'mine' && <td>{c.employeeName}</td>}
                <td>{c.title}</td>
                <td><span className={CLAIM_STATUS[c.status]?.[1]}>{CLAIM_STATUS[c.status]?.[0]}</span>{c.paidOn && <span className="muted"> em {c.paidOn.split('-').reverse().join('/')}</span>}</td>
                <td className="num">{formatKz(c.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
          {claims.length > 1 && <tfoot><tr><td colSpan={view !== 'mine' ? 4 : 3}><b>Total</b></td><td className="num"><b>{formatKz(total)}</b></td></tr></tfoot>}
        </table>
        {!claims.length && <div className="empty">{view === 'approve' ? 'Nenhuma nota à espera da sua decisão.' : view === 'pay' ? 'Nenhum reembolso por pagar.' : 'Ainda não há notas de despesas.'}</div>}
      </div>
    </>
  );
}
