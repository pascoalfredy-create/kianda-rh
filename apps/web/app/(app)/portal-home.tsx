import { formatKz, monthLabelPt } from './portal/format';
import Link from 'next/link';
import { ClockCard } from '@/components/clock-card';
import { api } from '@/lib/api';
import type { Profile, BalanceRow } from '@/lib/types';
import { RequestDeclaration } from './portal/forms';

interface Portal {
  lastPayslip: { id: string; period: string; netMinor: number } | null; pendingAbsences: number;
  expenses: { open: number; toReceiveMinor: number; rejected: number }; documents: number;
  documentRequests: { id: string; templateKey: string; status: string; createdAt: string; documentId: string | null; decisionNote: string | null }[];
  profileRequests: { id: string; status: string; createdAt: string; changes: Record<string, string | null>; decisionNote: string | null }[];
  review: { id: string; status: string; cycle: string } | null;
  selfService: { templates: { key: string; title: string; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[] }[]; autoIssue: boolean };
}
const STATUS: Record<string, [string, string]> = { pending: ['Pendente', 'st pending'], issued: ['Emitida', 'st approved'], approved: ['Aprovado', 'st approved'], rejected: ['Recusado', 'st rejected'], cancelled: ['Retirado', 'tag'] };

/** Início do colaborador: o essencial do dia-a-dia num só ecrã. */
export async function PortalHome({ name, employeeId }: { name: string; employeeId: string }) {
  const year = new Date().getFullYear();
  const [p, balances, profile] = await Promise.all([api<Portal>('/v1/portal'), api<BalanceRow[]>(`/v1/leave/balances?year=${year}`).catch(() => []), api<Profile>(`/v1/employees/${employeeId}`).catch(() => null)]);
  const firstContract = profile?.contracts.at(-1)?.startDate;
  const tenure = firstContract ? Math.max(0, (Date.now() - Date.parse(firstContract)) / (86400000 * 365.25)) : null;
  const mine = balances.find((b) => b.employee.id === employeeId);
  const titles = Object.fromEntries(p.selfService.templates.map((t) => [t.key, t.title]));
  const dt = (d: string) => new Date(d).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' });
  return (
    <>
      <h1>Olá, {name.split(' ')[0]}</h1>
      <p className="sub">O seu espaço: ponto, recibos, férias, despesas, declarações e dados pessoais</p>
      <ClockCard />
      {p.review && (
        <Link href={`/desempenho/${p.review.id}`} className="warn" style={{ display: 'block' }}>
          {p.review.status === 'self' ? `Tem a auto-avaliação de "${p.review.cycle}" por fazer →` : `A sua avaliação de "${p.review.cycle}" está concluída: tome conhecimento →`}
        </Link>
      )}
      <div className="rh-kpis">
        <Link href={p.lastPayslip ? `/recibos/${p.lastPayslip.id}` : '/recibos'} className="card kpi">
          <div className="l">Último recibo{p.lastPayslip ? ` · ${monthLabelPt(p.lastPayslip.period)}` : ''}</div>
          <div className="v">{p.lastPayslip ? formatKz(p.lastPayslip.netMinor) : '—'}</div><div className="muted">líquido · ver todos os recibos</div>
        </Link>
        <Link href="/ausencias" className="card kpi">
          <div className="l">Férias {year}</div>
          <div className="v">{mine ? mine.available : '—'} <span className="muted" style={{ fontSize: 14 }}>dias disponíveis</span></div>
          <div className="muted">{p.pendingAbsences ? `${p.pendingAbsences} pedido(s) à espera` : 'pedir férias ou ausência'}</div>
        </Link>
        <div className="card kpi"><div className="l">Antiguidade</div><div className="v">{tenure === null ? '—' : `${tenure.toFixed(1).replace('.', ',')} anos`}</div><div className="muted">{firstContract ? `desde ${firstContract.split('-').reverse().join('/')}` : 'Sem contrato registado'}</div></div>
        <div className="card kpi"><div className="l">Chefia directa</div><div className="v" style={{ fontSize: 16 }}>{profile?.manager?.name ?? '—'}</div><div className="muted">{profile?.manager?.jobTitle}</div></div>
      </div>
      <div className="grid">
        <Link href="/despesas" className="card kpi">
          <div className="l">Despesas</div>
          <div className="v">{p.expenses.toReceiveMinor ? formatKz(p.expenses.toReceiveMinor) : p.expenses.open}</div>
          <div className="muted">{p.expenses.toReceiveMinor ? 'aprovado, a receber' : 'nota(s) em curso'}{p.expenses.rejected ? ` · ${p.expenses.rejected} recusada(s)` : ''}</div>
        </Link>
        <Link href="/documentos" className="card kpi">
          <div className="l">Documentos</div><div className="v">{p.documents}</div><div className="muted">declarações e contratos emitidos</div>
        </Link>
        <Link href="/portal/dados" className="card kpi">
          <div className="l">Os meus dados</div><div className="v" style={{ fontSize: 16 }}>Morada, contactos, IBAN</div><div className="muted">pedir actualização</div>
        </Link>
      </div>
      <div className="two" style={{ alignItems: 'start' }}>
        <div className="card section">
          <h2>Pedir uma declaração</h2>
          <RequestDeclaration templates={p.selfService.templates} autoIssue={p.selfService.autoIssue} />
        </div>
        <div className="card section">
          <h2>Os meus pedidos</h2>
          <table className="dense">
            <tbody>
              {p.documentRequests.map((r) => (
                <tr key={r.id}>
                  <td>{titles[r.templateKey] ?? r.templateKey}<div className="muted">{dt(r.createdAt)}{r.decisionNote && r.status === 'rejected' ? ` · ${r.decisionNote}` : ''}</div></td>
                  <td className="num"><span className={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</span> {r.documentId && <Link href={`/documentos/${r.documentId}`}>abrir</Link>}</td>
                </tr>
              ))}
              {p.profileRequests.map((r) => (
                <tr key={r.id}>
                  <td>Alteração de dados ({Object.keys(r.changes).length} campo(s))<div className="muted">{dt(r.createdAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</div></td>
                  <td className="num"><span className={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!p.documentRequests.length && !p.profileRequests.length && <div className="empty">Sem pedidos.</div>}
        </div>
      </div>
    </>
  );
}
