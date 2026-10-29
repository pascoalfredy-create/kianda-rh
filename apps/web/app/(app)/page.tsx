import { ABSENCE_POLICIES, formatKz, labourRules, listPacks, getPack, payrollDeadlines, type AbsenceType } from '@kianda/core';
import Link from 'next/link';
import { AbsenceActions, NewAbsenceForm } from './ausencias/actions';
import type { EmployeeRow } from '@/lib/types';
import type { PersonnelOverview } from '@/lib/personnel';
import { api, currentUser } from '@/lib/api';
import type { AbsenceRow, BalanceRow } from '@/lib/types';
import { PortalHome } from './portal-home';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const pt = (d: string) => d.split('-').reverse().join('/');

export default async function Home() {
  const me = (await currentUser())!;
  if (!me.modules.hr.canAccess) redirect('/modulos');
  if (me.user.role === 'employee' && me.user.employeeId) return <PortalHome name={me.user.name} employeeId={me.user.employeeId} />;
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const period = today.slice(0, 7);
  const fiscal = listPacks().includes(`AO-${year}`) ? getPack('AO', year) : null;
  const deadlines = fiscal ? payrollDeadlines(period, fiscal) : null;
  const nextHolidays = [...labourRules('AO', year).holidays, ...labourRules('AO', year + 1).holidays].filter((h) => h.date >= today).slice(0, 4);

  const decider = ['owner', 'hr_admin', 'manager'].includes(me.user.role);
  const finance = ['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role);
  const [awaiting, current, balances, obligationRuns, expenseApprovals, toReimburse, inbox, overview, people] = await Promise.all([
    api<AbsenceRow[]>('/v1/absences?awaitingMe=1').catch(() => []),
    api<AbsenceRow[]>(`/v1/absences?from=${today}&to=${today}&status=approved`).catch(() => []),
    api<BalanceRow[]>(`/v1/leave/balances?year=${year}`).catch(() => []),
    finance ? api<{ obligations: { status: string; amountMinor: number; paidAt: string | null; reconciled: boolean | null }[] }[]>('/v1/obligations').catch(() => []) : Promise.resolve([]),
    decider ? api<unknown[]>('/v1/expenses?scope=approve').catch(() => []) : Promise.resolve([]),
    ['owner', 'finance'].includes(me.user.role) ? api<{ totalMinor: number }[]>('/v1/expenses?scope=pay').catch(() => []) : Promise.resolve([]),
    ['owner', 'hr_admin'].includes(me.user.role) ? api<{ documents: unknown[]; profiles: unknown[] }>('/v1/portal/inbox').catch(() => ({ documents: [], profiles: [] })) : Promise.resolve({ documents: [], profiles: [] }),
    api<PersonnelOverview>('/v1/reports/overview').catch(() => null),
    api<EmployeeRow[]>('/v1/employees').catch(() => []),
  ]);
  const mine = balances.find(b => b.employee.id === me.user.employeeId);
  const obligations = obligationRuns.flatMap(r => r.obligations);
  const late = obligations.filter(o => o.status === 'overdue'), soon = obligations.filter(o => o.status === 'due_soon');
  const proofLimit = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const noProof = ['owner', 'finance'].includes(me.user.role) ? obligations.filter(o => o.paidAt && o.reconciled === false && o.paidAt < proofLimit) : [];
  const portalPending = inbox.documents.length + inbox.profiles.length;
  const financial = overview?.financial;
  const alerts = people.flatMap(e => e.alerts.map(message => ({ id: e.id, name: e.name, message })));
  const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Luanda' }));
  const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  return (
    <>
      <div className="page-head"><div><h1>{hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite'}, {me.user.name.split(' ')[0]}</h1><p className="sub">{new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Luanda' })} · {me.company?.name}</p></div><div className="actions"><NewAbsenceForm me={{ employeeId: me.user.employeeId, isHr: ['owner', 'hr_admin'].includes(me.user.role) }} people={balances} canRegisterOthers={decider} canApprove={decider} />{['owner', 'hr_admin'].includes(me.user.role) && <Link className="btn" href="/colaboradores?novo=1">+ Novo colaborador</Link>}</div></div>
      {!overview && <div className="warn">Não foi possível carregar o resumo de pessoal. Actualize a página para tentar novamente.</div>}
      {!fiscal && <div className="warn">Sem pacote fiscal publicado para {year}. O processamento salarial desse ano mantém-se bloqueado; as projecções identificam as regras de referência.</div>}
      <div className="rh-kpis">
        <div className="card kpi"><div className="l">Colaboradores activos</div><div className="v">{overview?.active ?? '—'}</div><div className="d">{overview?.fixedTerm ?? '—'} a termo · {overview?.interns ?? '—'} estagiário(s)</div></div>
        <Link href="/ausencias?s=calendario" className="card kpi"><div className="l">Ausentes hoje</div><div className="v">{current.length}</div><div className="d">{current.length ? current.slice(0, 3).map(a => a.employee.name.split(' ')[0]).join(', ') : 'Equipa completa'}</div></Link>
        <div className="card kpi"><div className="l">Massa salarial bruta · {period}</div><div className="v">{financial ? formatKz(financial.grossMinor) : '—'}</div><div className="d">{financial ? `${financial.source === 'estimate' ? `Estimativa do quadro actual (${financial.packVersion ?? 'sem pacote'})` : financial.source === 'draft' ? 'Processamento em rascunho' : 'Processamento fechado'} · custo ${formatKz(financial.costMinor)}` : 'Sem acesso a dados salariais'}</div></div>
        <div className="card kpi"><div className="l">Retenções do mês</div><div className="v">{financial ? formatKz(financial.irtMinor + financial.inssMinor) : '—'}</div><div className="d">{financial ? `IRT ${formatKz(financial.irtMinor)} · INSS ${formatKz(financial.inssMinor)}` : 'Dados reservados ao RH e Finanças'}</div></div>
      </div>
      <div className="rh-columns"><div className="rh-stack">
        <div className="card"><div className="rh-card-head"><h2>Alertas de conformidade</h2><small className="muted">{alerts.length} ponto(s) nas fichas</small></div><div className="rh-card-body">
          {alerts.slice(0, 7).map((a, i) => <Link href={`/colaboradores/${a.id}`} key={`${a.id}-${i}`} className="rh-alert" style={{ display: 'block' }}><b>{a.name}</b> · {a.message}</Link>)}
          {late.length > 0 && <Link className="rh-alert" style={{ display: 'block' }} href="/obrigacoes">{late.length} obrigação(ões) em atraso</Link>}
          {soon.length > 0 && <Link className="rh-alert" style={{ display: 'block' }} href="/obrigacoes">{soon.length} obrigação(ões) a vencer</Link>}
          {noProof.length > 0 && <Link className="rh-alert" style={{ display: 'block' }} href="/conciliacao">{noProof.length} pagamento(s) sem comprovativo bancário</Link>}
          {!alerts.length && !late.length && !soon.length && !noProof.length && <div className="muted">Sem alertas nas fichas e obrigações consultadas.</div>}
        </div></div>
        <div className="card"><div className="rh-card-head"><h2>Pedidos a aprovar</h2><Link className="btn ghost sm" href="/ausencias">Ver todos</Link></div>
          {awaiting.slice(0, 4).map(a => <div className="rh-list-row" key={a.id}><span className="avatar sm">{initials(a.employee.name)}</span><div className="grow"><b>{a.employee.name}</b><small>{ABSENCE_POLICIES[a.type as AbsenceType]?.label} · {pt(a.startDate)} → {pt(a.endDate)} · {a.workingDays} dia(s)</small></div><AbsenceActions id={a.id} canDecide={a.canDecide} canCancel={false} /></div>)}
          {!awaiting.length && <div className="empty">Sem pedidos de ausência pendentes</div>}
          {expenseApprovals.length > 0 && <Link className="rh-list-row" href="/despesas?v=approve">{expenseApprovals.length} nota(s) de despesas para aprovar →</Link>}
          {portalPending > 0 && <Link className="rh-list-row" href="/pedidos">{portalPending} pedido(s) do portal por tratar →</Link>}
          {toReimburse.length > 0 && <Link className="rh-list-row" href="/despesas?v=pay">Reembolsos por pagar: {formatKz(toReimburse.reduce((s, c) => s + c.totalMinor, 0))} →</Link>}
        </div>
      </div><div className="rh-stack">
        <div className="card"><div className="rh-card-head"><h2>Próximos prazos legais</h2></div>{deadlines ? <>{[['INSS', deadlines.inss], ['IRT', deadlines.irt]].map(([label, date]) => <Link className="rh-list-row" href="/obrigacoes" key={label}><span className="st pending">{pt(date!)}</span><div className="grow"><b>{label}</b><small>Período {period}</small></div></Link>)}</> : <div className="empty">Sem pacote fiscal do ano</div>}</div>
        <div className="card"><div className="rh-card-head"><h2>Feriados nacionais</h2><Link href="/ausencias?s=feriados" className="muted">Ver todos</Link></div>{nextHolidays.map(h => <div className="rh-list-row" key={h.date}><span className="st pending">{pt(h.date)}</span><div className="grow">{h.name}</div></div>)}</div>
        <div className="card"><div className="rh-card-head"><h2>Aniversários (30 dias)</h2></div>{overview?.birthdays.length ? overview.birthdays.map(e => <Link className="rh-list-row" href={`/colaboradores/${e.id}`} key={e.id}><span className="avatar sm">{initials(e.name)}</span><div className="grow"><b>{e.name}</b><small>{new Date(`${e.date}T12:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</small></div></Link>) : <div className="empty">Nenhum nos próximos 30 dias</div>}</div>
        {mine && <Link href="/ausencias?s=saldos" className="card kpi"><div className="l">As minhas férias {year}</div><div className="v">{mine.available} dias</div></Link>}
      </div></div>
      <p className="muted" style={{ marginTop: 6 }}>Regras fiscais: {fiscal ? fiscal.version : `sem pacote ${year}`} · Calendário laboral: Lei n.º 12/23</p>
    </>
  );
}
