import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { monthLabel } from '@/lib/format';
import { PAYROLL_ROLES } from '@/lib/types';
import { PayButton, ReverseButton } from './actions';

export const dynamic = 'force-dynamic';

interface Ob { kind: 'salaries' | 'inss' | 'irt'; label: string; amountMinor: number; dueDate: string; paidAt: string | null; status: 'paid' | 'overdue' | 'due_soon' | 'open'; daysLeft: number; reference: string | null }
interface Row { runId: string; period: string; obligations: Ob[] }
interface BankInfo { count: number; totalMinor: number; excluded: { name: string; netMinor: number; reason: string }[] }

const pt = (d: string) => d.split('-').reverse().join('/');
const STATUS: Record<Ob['status'], [string, string]> = { paid: ['Pago', 'approved'], overdue: ['Em atraso', 'rejected'], due_soon: ['A vencer', 'pending'], open: ['Por pagar', 'cancelled'] };

export default async function Obrigacoes() {
  const me = (await currentUser())!;
  if (!PAYROLL_ROLES.includes(me.user.role)) redirect('/');
  const canPay = me.user.role === 'owner' || me.user.role === 'finance';
  const canBankFile = ['owner', 'finance', 'payroll'].includes(me.user.role);
  const rows = await api<Row[]>('/v1/obligations');
  const all = rows.flatMap((r) => r.obligations);
  const overdue = all.filter((o) => o.status === 'overdue');
  const soon = all.filter((o) => o.status === 'due_soon');
  const open = all.filter((o) => o.status !== 'paid');

  return (
    <>
      <h1>Obrigações e pagamentos</h1>
      <p className="sub">Salários, Segurança Social e IRT de cada processamento fechado · prazos legais · mapas e ficheiro de transferência</p>
      <div className="grid">
        <div className="card kpi"><div className="l">Em atraso</div><div className="v" style={{ color: overdue.length ? 'var(--red)' : undefined }}>{overdue.length}</div><div className="muted" style={{ fontSize: 12 }}>{formatKz(overdue.reduce((s, o) => s + o.amountMinor, 0))}</div></div>
        <div className="card kpi"><div className="l">A vencer (7 dias)</div><div className="v" style={{ color: soon.length ? 'var(--amber)' : undefined }}>{soon.length}</div><div className="muted" style={{ fontSize: 12 }}>{formatKz(soon.reduce((s, o) => s + o.amountMinor, 0))}</div></div>
        <div className="card kpi"><div className="l">Total por pagar</div><div className="v">{formatKz(open.reduce((s, o) => s + o.amountMinor, 0))}</div></div>
      </div>
      {!rows.length && <div className="card empty">Ainda não há processamentos fechados. <Link href="/processamento" style={{ color: 'var(--brand)' }}>Ir para o processamento →</Link></div>}
      {await Promise.all(rows.map(async (r) => {
        const bank = canBankFile ? await api<BankInfo>(`/v1/payroll-runs/${r.runId}/bank-file?format=json`).catch(() => null) : null;
        return (
          <div className="card section" key={r.runId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0', gap: 10, flexWrap: 'wrap' }}>
              <h2 className="h2-inline" style={{ fontSize: 14 }}><Link href={`/processamento?mes=${r.period}`}>{monthLabel(r.period)}</Link></h2>
              <div className="actions">
                <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/maps/irt?format=csv`}>Mapa de IRT (CSV)</a>
                <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/maps/inss?format=csv`}>Folha do INSS (CSV)</a>
                {canBankFile && <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/bank-file`}>Ficheiro de transferências (CSV)</a>}
              </div>
            </div>
            <table>
              <thead><tr><th>Obrigação</th><th className="num">Valor</th><th>Prazo</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {r.obligations.map((o) => (
                  <tr key={o.kind}>
                    <td><b>{o.label}</b>{o.kind === 'salaries' && bank && <div className="muted">{bank.count} transferência(s){bank.excluded.length ? ` · ${bank.excluded.length} fora do ficheiro` : ''}</div>}</td>
                    <td className="num"><b>{formatKz(o.amountMinor)}</b></td>
                    <td>{pt(o.dueDate)}{o.status !== 'paid' && <div className="muted">{o.daysLeft < 0 ? `há ${-o.daysLeft} dia(s)` : o.daysLeft === 0 ? 'hoje' : `faltam ${o.daysLeft} dia(s)`}</div>}</td>
                    <td><span className={`st ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>{o.paidAt && <div className="muted">em {pt(o.paidAt)}{o.reference ? ` · ${o.reference}` : ''}</div>}</td>
                    <td className="num">{canPay && (o.paidAt ? <ReverseButton runId={r.runId} kind={o.kind} /> : <PayButton runId={r.runId} kind={o.kind} label={o.label} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bank && bank.excluded.length > 0 && (
              <div className="warn" style={{ margin: '0 16px 14px' }}>
                Fora do ficheiro de transferências (pagar à parte ou corrigir a ficha): {bank.excluded.map((x) => `${x.name} (${x.reason}, ${formatKz(x.netMinor)})`).join(' · ')}
              </div>
            )}
          </div>
        );
      }))}
      <p className="muted">Prazos: salários até ao último dia do mês processado; INSS até ao dia 10 do mês seguinte; IRT até ao fim do mês seguinte (pacote AO-2026). Os ficheiros CSV abrem no Excel; o formato de importação de cada banco e dos portais da AGT/INSS pode exigir ajustes.</p>
    </>
  );
}
