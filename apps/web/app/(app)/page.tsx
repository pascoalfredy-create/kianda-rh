import { ABSENCE_POLICIES, formatKz, labourRules, listPacks, getPack, payrollDeadlines, type AbsenceType } from '@kianda/core';
import Link from 'next/link';
import { ClockCard } from '@/components/clock-card';
import { api, currentUser } from '@/lib/api';
import type { AbsenceRow, BalanceRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const pt = (d: string) => d.split('-').reverse().join('/');

export default async function Home() {
  const me = (await currentUser())!;
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const period = today.slice(0, 7);
  const fiscal = listPacks().includes(`AO-${year}`) ? getPack('AO', year) : null;
  const deadlines = fiscal ? payrollDeadlines(period, fiscal) : null;
  const nextHolidays = [...labourRules('AO', year).holidays, ...labourRules('AO', year + 1).holidays].filter((h) => h.date >= today).slice(0, 4);

  const [awaiting, current, balances] = await Promise.all([
    api<AbsenceRow[]>('/v1/absences?awaitingMe=1').catch(() => []),
    api<AbsenceRow[]>(`/v1/absences?from=${today}&to=${today}&status=approved`).catch(() => []),
    api<BalanceRow[]>(`/v1/leave/balances?year=${year}`).catch(() => []),
  ]);
  const mine = balances.find((b) => b.employee.id === me.user.employeeId);
  const obligations = ['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role)
    ? (await api<{ obligations: { status: string; amountMinor: number; paidAt: string | null; reconciled: boolean | null }[] }[]>('/v1/obligations').catch(() => [])).flatMap((r) => r.obligations)
    : [];
  const late = obligations.filter((o) => o.status === 'overdue');
  const soon = obligations.filter((o) => o.status === 'due_soon');
  const proofLimit = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const noProof = ['owner', 'finance'].includes(me.user.role) ? obligations.filter((o) => o.paidAt && o.reconciled === false && o.paidAt < proofLimit) : [];
  const staff = me.user.role !== 'employee';

  return (
    <>
      <h1>Olá, {me.user.name.split(' ')[0]}</h1>
      <p className="sub">{me.company?.name} · {new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Luanda' })}</p>

      {me.user.employeeId && <ClockCard compact />}

      {staff && !fiscal && (
        <div className="alert">
          Ainda não existe pacote fiscal para {year} (OGE {year}). Férias e ausências funcionam normalmente; o processamento salarial de {year} fica bloqueado até a tabela de IRT do ano ser publicada.
        </div>
      )}

      <div className="grid">
        {awaiting.length > 0 && (
          <Link href="/ausencias" className="card kpi" style={{ borderColor: '#f3d9a6' }}>
            <div className="l">Pedidos à espera da sua decisão</div><div className="v" style={{ color: 'var(--amber)' }}>{awaiting.length}</div>
          </Link>
        )}
        {(late.length > 0 || soon.length > 0) && (
          <Link href="/obrigacoes" className="card kpi" style={{ borderColor: late.length ? '#f1c9c1' : '#f3d9a6' }}>
            <div className="l">Obrigações {late.length ? 'em atraso' : 'a vencer'}</div>
            <div className="v" style={{ color: late.length ? 'var(--red)' : 'var(--amber)' }}>{late.length || soon.length}</div>
          </Link>
        )}
        {noProof.length > 0 && (
          <Link href="/conciliacao" className="card kpi" style={{ borderColor: '#f1c9c1' }}>
            <div className="l">Pagamentos sem comprovativo bancário</div>
            <div className="v" style={{ color: 'var(--red)' }}>{noProof.length}</div>
          </Link>
        )}
        {mine && (
          <Link href="/ausencias?s=saldos" className="card kpi">
            <div className="l">As minhas férias {year}</div><div className="v">{mine.available} <span className="muted" style={{ fontSize: 14 }}>de {mine.entitlement + mine.carriedOver} dias</span></div>
          </Link>
        )}
        {staff && (
          <Link href="/ausencias?s=mapa" className="card kpi">
            <div className="l">Ausentes hoje</div><div className="v">{current.length}</div>
          </Link>
        )}
        {staff && fiscal && <div className="card kpi"><div className="l">Prazo INSS ({period})</div><div className="v">{pt(deadlines!.inss)}</div></div>}
        {staff && fiscal && <div className="card kpi"><div className="l">Prazo IRT ({period})</div><div className="v">{pt(deadlines!.irt)}</div></div>}
        {staff && fiscal && <div className="card kpi"><div className="l">Salário mínimo nacional</div><div className="v">{formatKz(fiscal.minimumWage.generalMinor)}</div></div>}
      </div>

      <div className="two">
        {staff ? <div className="card section">
          <h2>Ausentes hoje</h2>
          {current.length ? (
            <table><tbody>{current.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/colaboradores/${a.employee.id}?s=ausencias`}><b>{a.employee.name}</b></Link></td>
                <td><span className="dot" style={{ background: ABSENCE_POLICIES[a.type as AbsenceType]?.color }} />{ABSENCE_POLICIES[a.type as AbsenceType]?.label}</td>
                <td className="num muted">até {pt(a.endDate)}</td>
              </tr>
            ))}</tbody></table>
          ) : <div className="empty">Toda a equipa ao serviço</div>}
        </div> : <div className="card section">
          <h2>Os meus pedidos</h2>
          <div className="empty"><Link href="/ausencias" style={{ color: 'var(--brand)' }}>Pedir férias ou ausência →</Link></div>
        </div>}
        <div className="card section">
          <h2>Próximos feriados nacionais</h2>
          <table><tbody>{nextHolidays.map((h) => (
            <tr key={h.date}><td>{h.name}</td><td className="num">{new Date(`${h.date}T00:00:00Z`).toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td></tr>
          ))}</tbody></table>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>Regras fiscais: {fiscal ? fiscal.version : `sem pacote ${year}`} · Calendário laboral: Lei n.º 12/23</p>
    </>
  );
}
