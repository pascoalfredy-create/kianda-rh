import { EXPENSE_CATEGORIES, formatKz, luandaDate, PER_DIEM_ZONE } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { CLAIM_STATUS } from '../status';
import { ClaimActions, ClaimForm } from '../form';

export const dynamic = 'force-dynamic';

interface Detail {
  id: string; number: string; title: string; status: string; tripFrom: string | null; tripTo: string | null; totalMinor: number; employeeId: string;
  createdAt: string; submittedAt: string | null; decidedAt: string | null; decisionNote: string | null; paidOn: string | null; paidReference: string | null; matchId: string | null;
  employee: { id: string; name: string; number: string; jobTitle: string; iban: string | null };
  lines: { kind: 'expense' | 'per_diem'; date: string; description: string; category: string | null; documentRef: string | null; supplierNif: string | null; zone: string | null; days: number | null; rateMinor: number | null; amountMinor: number }[];
  totals: { expensesMinor: number; perDiemMinor: number; totalMinor: number };
  rates: { national: number | null; international: number | null };
  problems: string[];
  can: { edit: boolean; submit: boolean; decide: boolean; pay: boolean; reversePayment: boolean; cancel: boolean };
}
const pt = (d: string) => d.split('-').reverse().join('/');
const dec = (m: number | null) => (m === null ? '' : String(m / 100).replace('.', ','));

export default async function Nota({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  const d = await api<Detail>(`/v1/expenses/${id}`);
  const accounts = d.can.pay ? await api<{ id: string; name: string }[]>('/v1/bank/accounts').catch(() => []) : [];
  const editing = d.can.edit;
  return (
    <>
      <div className="crumb"><Link href="/despesas">Despesas</Link> / {d.number}</div>
      <div className="page-head">
        <div>
          <h1>Nota de despesas {d.number}</h1>
          <p className="sub">{d.employee.name} · {d.employee.jobTitle} · <span className={CLAIM_STATUS[d.status]?.[1]}>{CLAIM_STATUS[d.status]?.[0]}</span></p>
        </div>
      </div>
      {d.decisionNote && <div className={d.status === 'rejected' ? 'alert' : 'warn'}>{d.status === 'rejected' ? 'Recusada' : 'Nota da decisão'}: {d.decisionNote}{d.status === 'rejected' && editing ? ' — corrija e volte a submeter.' : ''}</div>}
      {editing && d.problems.length > 0 && d.lines.length > 0 && <div className="warn">Antes de submeter: <ul>{d.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {(d.can.submit || d.can.decide || d.can.pay || d.can.reversePayment || d.can.cancel || !editing) && <ClaimActions id={d.id} can={{ ...d.can, submit: false }} accounts={accounts} />}
      {editing ? (
        <ClaimForm
          init={{
            id: d.id, title: d.title, tripFrom: d.tripFrom, tripTo: d.tripTo,
            lines: d.lines.map((l) => ({ kind: l.kind, date: l.date, description: l.description, category: l.category ?? 'transport', amount: l.kind === 'expense' ? dec(l.amountMinor) : '', documentRef: l.documentRef ?? '', supplierNif: l.supplierNif ?? '', zone: l.zone ?? 'national', days: l.days ? String(l.days).replace('.', ',') : '1', rate: dec(l.rateMinor) })),
          }}
          today={luandaDate(new Date())} rates={d.rates}
        />
      ) : (
        <div className="card section">
          <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div><div className="muted">Motivo</div><b>{d.title}</b></div>
            <div><div className="muted">Deslocação</div>{d.tripFrom ? `${pt(d.tripFrom)} a ${pt(d.tripTo ?? d.tripFrom)}` : '—'}</div>
            <div><div className="muted">Colaborador</div>{d.employee.number} · {d.employee.name}</div>
            <div><div className="muted">Reembolso</div>{d.paidOn ? <>Pago em {pt(d.paidOn)}{d.paidReference ? ` · ${d.paidReference}` : ''} {d.matchId ? <span className="tag future">conciliado</span> : null}</> : d.employee.iban ? `Por transferência (${d.employee.iban})` : 'Sem IBAN na ficha'}</div>
          </div>
          <table className="dense">
            <thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Documento</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td>{pt(l.date)}</td><td>{l.description}</td>
                  <td>{l.kind === 'expense' ? EXPENSE_CATEGORIES[l.category as keyof typeof EXPENSE_CATEGORIES] : `${PER_DIEM_ZONE[l.zone as keyof typeof PER_DIEM_ZONE]}: ${String(l.days).replace('.', ',')} × ${formatKz(l.rateMinor ?? 0)}`}</td>
                  <td>{l.documentRef ?? ''}{l.supplierNif ? <div className="muted">NIF {l.supplierNif}</div> : null}</td>
                  <td className="num">{formatKz(l.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {d.totals.expensesMinor > 0 && d.totals.perDiemMinor > 0 && <>
                <tr><td colSpan={4}>Despesas documentadas</td><td className="num">{formatKz(d.totals.expensesMinor)}</td></tr>
                <tr><td colSpan={4}>Ajudas de custo</td><td className="num">{formatKz(d.totals.perDiemMinor)}</td></tr>
              </>}
              <tr><td colSpan={4}><b>Total a reembolsar</b></td><td className="num"><b>{formatKz(d.totals.totalMinor)}</b></td></tr>
            </tfoot>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30, padding: '40px 16px 20px' }}>
            <div style={{ borderTop: '1px solid var(--ink3)', paddingTop: 6, textAlign: 'center' }} className="muted">O colaborador</div>
            <div style={{ borderTop: '1px solid var(--ink3)', paddingTop: 6, textAlign: 'center' }} className="muted">Aprovado {d.decidedAt && d.status !== 'rejected' ? `em ${new Date(d.decidedAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}` : ''}</div>
          </div>
        </div>
      )}
      {me.user.employeeId === d.employeeId && d.status === 'submitted' && <p className="muted">A nota está com a sua chefia para aprovação.</p>}
    </>
  );
}
