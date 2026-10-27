import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { monthLabel } from '@/lib/format';
import { PAYROLL_ROLES } from '@/lib/types';
import { PayButton, ReverseButton } from './actions';

export const dynamic = 'force-dynamic';

interface Ob { kind: 'salaries' | 'inss' | 'irt'; label: string; amountMinor: number; dueDate: string; paidAt: string | null; status: 'paid' | 'overdue' | 'due_soon' | 'open'; daysLeft: number; reference: string | null; reconciled: boolean | null }
interface Row { runId: string; period: string; obligations: Ob[] }
interface BankInfo { profile: 'nib' | 'generic' | 'bfa' | 'bai'; banks: Record<string, number>; count: number; totalMinor: number; excluded: { name: string; netMinor: number; reason: string }[] }

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
        const agt = await api<{ issues: { employee: string; problem: string }[] }>(`/v1/payroll-runs/${r.runId}/maps/agt`).catch(() => null);
        const bankLabel = bank?.profile === 'nib' ? 'Ficheiro do banco (NOME, NIB, VALOR)' : bank?.profile === 'bfa' ? 'Ficheiro BFA (Excel)' : bank?.profile === 'bai' ? 'Ficheiro BAI (Excel)' : 'Ficheiro de transferências (CSV)';
        return (
          <div className="card section" key={r.runId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0', gap: 10, flexWrap: 'wrap' }}>
              <h2 className="h2-inline" style={{ fontSize: 14 }}><Link href={`/processamento?mes=${r.period}`}>{monthLabel(r.period)}</Link></h2>
              <div className="actions">
                <a className="btn sm" href={`/api/v1/payroll-runs/${r.runId}/maps/agt?format=xlsx`} title="Template IRT A2.1 — Portal do Contribuinte → Declarações → IRT → Entregar → Mapa de Remunerações → Upload de Ficheiro">Mapa AGT A2.1 (Excel)</a>
                <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/maps/agt?format=xlsx&template=simple`} title="Novo Template Simplificado IRT">AGT simplificado</a>
                <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/maps/inss?format=xlsx`}>Folha do INSS (Excel)</a>
                <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/maps/irt?format=csv`}>Resumo IRT (CSV)</a>
                {canBankFile && <a className="btn ghost sm" href={`/api/v1/payroll-runs/${r.runId}/bank-file`}>{bankLabel}</a>}
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
                    <td><span className={`st ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>{o.paidAt && <div className="muted">em {pt(o.paidAt)}{o.reference ? ` · ${o.reference}` : ''} · {o.reconciled ? <span className="tag future">conciliado</span> : <Link href="/conciliacao" className="tag">por conciliar</Link>}</div>}</td>
                    <td className="num">{canPay && (o.paidAt ? <ReverseButton runId={r.runId} kind={o.kind} /> : <PayButton runId={r.runId} kind={o.kind} label={o.label} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {agt && agt.issues.length > 0 && (
              <div className="warn" style={{ margin: '0 16px 14px' }}>
                <b>Mapa da AGT — corrija antes de submeter:</b>
                <ul>{agt.issues.slice(0, 12).map((x, i) => <li key={i}>{x.employee}: {x.problem}</li>)}</ul>
                {agt.issues.length > 12 && <div className="muted">… e mais {agt.issues.length - 12}.</div>}
              </div>
            )}
            {bank && Object.keys(bank.banks).length > 1 && (
              <div className="muted" style={{ margin: '0 16px 10px' }}>Beneficiários por banco: {Object.entries(bank.banks).map(([k, n]) => `${k} ${n}`).join(' · ')} — as transferências para outros bancos seguem pelo STC/SPTR (comissões do preçário).</div>
            )}
            {bank && bank.excluded.length > 0 && (
              <div className="warn" style={{ margin: '0 16px 14px' }}>
                Fora do ficheiro de transferências (pagar à parte ou corrigir a ficha): {bank.excluded.map((x) => `${x.name} (${x.reason}, ${formatKz(x.netMinor)})`).join(' · ')}
              </div>
            )}
          </div>
        );
      }))}
      <p className="muted">Prazos: salários até ao último dia do mês processado; INSS até ao dia 10 do mês seguinte; IRT até ao fim do mês seguinte (pacote AO-2026). O mapa da AGT segue os templates oficiais do Portal do Contribuinte (A2.1 com 32 colunas, ou o simplificado) e inclui todos os trabalhadores do mês. A folha do INSS segue a Folha de Remuneração Normal do INSS Virtual. O ficheiro do banco sai em NOME, NIB, VALOR (outros formatos nas Definições).</p>
    </>
  );
}
