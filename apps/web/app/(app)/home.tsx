import { ABSENCE_POLICIES, formatKz, labourRules, listPacks, getPack, payrollDeadlines, type AbsenceType } from '@kianda/core';
import Link from 'next/link';
import { AbsenceActions, NewAbsenceForm } from './ausencias/actions';
import type { EmployeeRow } from '@/lib/types';
import type { PersonnelOverview } from '@/lib/personnel';
import { api, currentUser } from '@/lib/api';
import type { AbsenceRow, BalanceRow } from '@/lib/types';
import { PortalHome } from './portal-home';
import { redirect } from 'next/navigation';
import { PushSettings } from '@/components/push-settings';
import { capitalise, dateRange, daysBetween, firstName, greeting, joinPt, longDate, luandaNow, monthName, nextWorkingDay, plural, relativeDay, shortDate, weekday } from '@/lib/humane';


export default async function Home() {
  const me = (await currentUser())!;
  if (!me.modules.hr.canAccess) redirect('/modulos');
  if (me.user.role === 'employee' && me.user.employeeId) return <PortalHome name={me.user.name} employeeId={me.user.employeeId} />;
  const today = luandaNow().date;
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
  const now = luandaNow();
  const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  const holidaySet = new Set(nextHolidays.map(h => h.date));
  const canHire = ['owner', 'hr_admin'].includes(me.user.role);
  const monthLabel = monthName(period);
  // Resumo do dia numa frase: o que espera por si, quem está fora e como vão os salários.
  const waiting = awaiting.length + expenseApprovals.length + portalPending;
  const outText = current.length === 1
    ? `${firstName(current[0]!.employee.name)} está ${current[0]!.type === 'vacation' ? 'de férias' : 'ausente'} até ${relativeDay(current[0]!.endDate, now.date) === 'hoje' ? 'hoje' : `dia ${Number(current[0]!.endDate.slice(8))}`}`
    : current.length > 1 ? `${current.length} pessoas estão fora hoje` : '';
  const payText = financial && finance
    ? financial.source === 'estimate' ? `os salários de ${monthLabel} ainda não foram preparados` : financial.source === 'draft' ? `o processamento de ${monthLabel} está em rascunho` : `os salários de ${monthLabel} estão fechados`
    : '';
  const summary = [
    waiting ? `Há ${plural(waiting, 'pedido', 'pedidos')} à sua espera.` : 'Não há pedidos à sua espera.',
    capitalise(joinPt([outText, payText])) + (outText || payText ? '.' : ''),
  ].filter(s => s.trim() && s !== '.').join(' ');
  const corrections = [
    ...alerts.slice(0, 7).map((a, i) => <Link href={`/colaboradores/${a.id}`} key={`${a.id}-${i}`} className="rh-alert" style={{ display: 'block' }}><b>{a.name}</b>: {a.message}</Link>),
    late.length > 0 && <Link key="late" className="rh-alert" style={{ display: 'block' }} href="/obrigacoes">{plural(late.length, 'pagamento ao Estado está', 'pagamentos ao Estado estão')} em atraso</Link>,
    soon.length > 0 && <Link key="soon" className="rh-alert" style={{ display: 'block' }} href="/obrigacoes">{plural(soon.length, 'pagamento ao Estado vence', 'pagamentos ao Estado vencem')} nos próximos dias</Link>,
    noProof.length > 0 && <Link key="proof" className="rh-alert" style={{ display: 'block' }} href="/conciliacao">Falta o comprovativo bancário de {plural(noProof.length, 'pagamento', 'pagamentos')}</Link>,
  ].filter(Boolean);
  const teamNote = overview ? (overview.fixedTerm || overview.interns ? joinPt([overview.fixedTerm ? `${overview.fixedTerm} a termo` : '', overview.interns ? `${overview.interns} em estágio` : '']) : 'todos sem termo') : '';
  return (
    <>
      <div className="today-meta"><span>{capitalise(longDate(now.date))} · {now.time} em Luanda</span></div>
      <div className="page-head today-head">
        <div>
          <h1>{greeting(now.hour)}, {firstName(me.user.name)}.</h1>
          <p className="today-summary">{summary}</p>
        </div>
        <div className="actions"><NewAbsenceForm me={{ employeeId: me.user.employeeId, isHr: canHire }} people={balances} canRegisterOthers={decider} canApprove={decider} />{canHire && <Link className="btn" href="/colaboradores?novo=1">Admitir alguém</Link>}</div>
      </div>
      <PushSettings compact />
      {!overview && <div className="warn">Não conseguimos carregar o resumo da equipa. Actualize a página dentro de momentos.</div>}
      {!fiscal && <div className="warn">As regras fiscais de {year} ainda não foram publicadas no Kianda. Até lá não é possível processar salários desse ano.</div>}

      <div className="today-grid">
        <section className="card today-decide">
          <div className="rh-card-head"><h2>Para decidir</h2>{waiting > 0 && <Link className="muted" href="/ausencias">Ver todos os pedidos</Link>}</div>
          {awaiting.slice(0, 4).map(a => <div className="rh-list-row" key={a.id}>
            <span className="avatar">{initials(a.employee.name)}</span>
            <div className="grow"><b>{a.employee.name} pediu {a.type === 'vacation' ? 'férias' : (ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? 'uma ausência').toLocaleLowerCase('pt-PT')}</b><small>{capitalise(dateRange(a.startDate, a.endDate))} · {plural(a.workingDays, 'dia útil', 'dias úteis')}</small></div>
            <AbsenceActions id={a.id} canDecide={a.canDecide} canCancel={false} />
          </div>)}
          {expenseApprovals.length > 0 && <Link className="rh-list-row" href="/despesas?v=approve"><div className="grow"><b>{plural(expenseApprovals.length, 'nota de despesas', 'notas de despesas')} para aprovar</b></div><span className="muted">Abrir</span></Link>}
          {portalPending > 0 && <Link className="rh-list-row" href="/pedidos"><div className="grow"><b>{plural(portalPending, 'pedido da equipa', 'pedidos da equipa')} por tratar</b><small>Declarações e alterações de dados pessoais</small></div><span className="muted">Abrir</span></Link>}
          {toReimburse.length > 0 && <Link className="rh-list-row" href="/despesas?v=pay"><div className="grow"><b>Reembolsos por pagar</b><small>{formatKz(toReimburse.reduce((s, c) => s + c.totalMinor, 0))}</small></div><span className="muted">Abrir</span></Link>}
          {!waiting && !toReimburse.length && <div className="empty">Nada à sua espera. Quando alguém pedir férias ou entregar despesas, aparece aqui.</div>}
        </section>
        <section className="card today-out">
          <div className="rh-card-head"><h2>Fora hoje</h2><Link className="muted" href="/ausencias?s=calendario">Calendário</Link></div>
          {current.slice(0, 5).map(a => <div className="rh-list-row" key={a.id}><span className="avatar terra">{initials(a.employee.name)}</span><div className="grow"><b>{a.employee.name}</b><small>{a.type === 'vacation' ? 'Férias' : ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? 'Ausência'}, volta {relativeDay(nextWorkingDay(a.endDate, holidaySet), now.date) === 'amanhã' ? 'amanhã' : `${weekday(nextWorkingDay(a.endDate, holidaySet))} dia ${Number(nextWorkingDay(a.endDate, holidaySet).slice(8))}`}</small></div></div>)}
          <div className="empty" style={{ textAlign: 'left', padding: '12px 20px 16px' }}>{current.length ? `${overview ? `Os outros ${Math.max(0, overview.active - current.length)} estão ao serviço.` : ''}` : 'Está toda a equipa ao serviço.'}</div>
        </section>
      </div>

      {overview && <section className="card figures">
        <div><span>Equipa</span><b>{overview.active}</b><small>{teamNote}</small></div>
        {financial && <>
          <div><span>Salários de {monthLabel}</span><b>{formatKz(financial.grossMinor)}</b><small>{financial.source === 'estimate' ? 'brutos, por preparar' : financial.source === 'draft' ? 'brutos, em rascunho' : 'brutos, processamento fechado'}</small></div>
          <div><span>Custo para a empresa</span><b>{formatKz(financial.costMinor)}</b><small>com o INSS da empresa</small></div>
          <div><span>A entregar ao Estado</span><b>{formatKz(financial.irtMinor + financial.inssMinor)}</b><small>{formatKz(financial.irtMinor)} de IRT e {formatKz(financial.inssMinor)} de INSS</small></div>
        </>}
        {mine && <div><span>As minhas férias</span><b>{mine.available} dias</b><small><Link href="/ausencias?s=saldos">por gozar em {year}</Link></small></div>}
      </section>}

      {corrections.length > 0 && <section className="card section"><div className="rh-card-head"><h2>Para corrigir</h2><small className="muted">{plural(corrections.length, 'ponto', 'pontos')}</small></div><div className="rh-card-body">{corrections}</div></section>}

      <div className="today-grid even">
        <section className="card">
          <div className="rh-card-head"><h2>Prazos</h2><Link className="muted" href="/obrigacoes">IRT e INSS</Link></div>
          {deadlines ? ([['INSS', deadlines.inss, 'Pagar'], ['IRT', deadlines.irt, 'Entregar']] as const).map(([label, date, verb]) => {
            const n = daysBetween(now.date, date);
            return <Link className="rh-list-row" href="/obrigacoes" key={label}><span className={`counter ${n <= 7 ? 'soon' : ''}`}><b>{n}</b><small>{n === 1 ? 'dia' : 'dias'}</small></span><div className="grow"><b>{label} de {monthLabel}</b><small>{verb} até {shortDate(date)}</small></div></Link>;
          }) : <div className="empty">Sem regras fiscais do ano.</div>}
        </section>
        <section className="card">
          <div className="rh-card-head"><h2>Nas próximas semanas</h2><Link className="muted" href="/ausencias?s=feriados">Feriados</Link></div>
          {nextHolidays.slice(0, 3).map(h => <div className="rh-list-row" key={h.date}><div className="grow"><b>{capitalise(longDate(h.date, now.date))}</b><small>{h.name} · {relativeDay(h.date, now.date)}</small></div></div>)}
          {overview?.birthdays.slice(0, 3).map(e => <Link className="rh-list-row" href={`/colaboradores/${e.id}`} key={e.id}><div className="grow"><b>{e.name} faz anos</b><small>{capitalise(longDate(e.date, now.date))} · {relativeDay(e.date, now.date)}</small></div></Link>)}
          {!overview?.birthdays.length && <div className="empty" style={{ textAlign: 'left', padding: '12px 20px 16px' }}>Ninguém faz anos nos próximos 30 dias.</div>}
        </section>
      </div>
    </>
  );
}
