import Link from 'next/link';
import { addDays, formatShiftHours, lastDayOfMonth, luandaDate } from '@kianda/core';
import { api, currentUser } from '@/lib/api';
import { RosterBoard, ShiftTypesEditor } from './forms';
import { chipStyle, dm, pt, weekday, type MineData, type RosterData, type TypesData } from './types';

export const dynamic = 'force-dynamic';

const VIEWS = { semana: ['Semana', 7], quinzena: ['Quinzena', 14], mes: ['Mês', 0] } as const;
type View = keyof typeof VIEWS;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const monday = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Intervalo visível: semana e quinzena começam à segunda; o mês vai do dia 1 ao último. */
function range(view: View, de: string) {
  if (view === 'mes') {
    const from = `${de.slice(0, 7)}-01`, to = lastDayOfMonth(de.slice(0, 7));
    const prev = addDays(from, -1).slice(0, 7) + '-01', next = addDays(to, 1);
    return { from, to, prev, next };
  }
  const n = VIEWS[view][1], from = monday(de);
  return { from, to: addDays(from, n - 1), prev: addDays(from, -n), next: addDays(from, n) };
}

/** Tempo → Planeamento de turnos: escala da equipa, tipos de turno e os meus turnos. */
export default async function Turnos({ searchParams }: { searchParams: Promise<{ v?: string; vista?: string; de?: string }> }) {
  const me = (await currentUser())!;
  const q = await searchParams;
  const role = me.user.role;
  const staff = ['owner', 'hr_admin', 'manager', 'payroll', 'finance'].includes(role);
  const planner = ['owner', 'hr_admin', 'manager'].includes(role);
  const hasSelf = !!me.user.employeeId;
  const tab = q.v === 'tipos' && staff ? 'tipos' : q.v === 'meus' && hasSelf ? 'meus' : staff ? 'escala' : 'meus';
  const view: View = q.vista && q.vista in VIEWS ? q.vista as View : 'semana';
  const today = luandaDate(new Date());
  const de = q.de && ISO.test(q.de) ? q.de : today;
  const r = range(view, de);
  const link = (patch: Record<string, string>) => `?${new URLSearchParams({ v: tab, vista: view, de, ...patch }).toString()}`;
  const tabs = <nav className="tabs">
    {staff && <Link href="?v=escala" className={tab === 'escala' ? 'on' : ''}>Escala</Link>}
    {staff && <Link href="?v=tipos" className={tab === 'tipos' ? 'on' : ''}>Tipos de turno</Link>}
    {hasSelf && staff && <Link href="?v=meus" className={tab === 'meus' ? 'on' : ''}>Os meus turnos</Link>}
  </nav>;
  const head = <div className="page-head">
    <div>
      <h1>{staff ? 'Planeamento de turnos' : 'Os meus turnos'}</h1>
      <p className="sub">{staff ? 'Escala por colaborador e dia: planear, verificar descansos e cobertura, publicar para a equipa' : 'A sua escala publicada: turnos, horas e folgas'}</p>
    </div>
  </div>;

  if (tab === 'tipos') {
    const t = await api<TypesData>('/v1/shifts/types');
    return <>{head}{tabs}<ShiftTypesEditor data={t} /></>;
  }
  if (tab === 'meus') {
    const from = de < today && !q.de ? today : de;
    const m = await api<MineData>(`/v1/shifts/mine?from=${from}&to=${addDays(from, 27)}`);
    return <>{head}{tabs}<MyShifts data={m} prev={`?v=meus&de=${addDays(from, -28)}`} next={`?v=meus&de=${addDays(from, 28)}`} /></>;
  }
  const data = await api<RosterData>(`/v1/shifts/roster?from=${r.from}&to=${r.to}`);
  const label = view === 'mes'
    ? (() => { const s = new Date(`${r.from}T00:00:00Z`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); })()
    : `${pt(r.from)} a ${pt(r.to)}`;
  return <>
    {head}{tabs}
    <div className="page-head no-print" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
      <div className="month-nav">
        <Link className="btn ghost sm" href={link({ de: r.prev })} aria-label="Anterior">←</Link>
        <b>{label}</b>
        <Link className="btn ghost sm" href={link({ de: r.next })} aria-label="Seguinte">→</Link>
        <Link className="btn ghost sm" href={link({ de: today })}>Hoje</Link>
      </div>
      <div className="month-nav">{(Object.keys(VIEWS) as View[]).map(v => <Link key={v} className={`btn sm ${v === view ? '' : 'ghost'}`} href={link({ vista: v })}>{VIEWS[v][0]}</Link>)}</div>
    </div>
    <h2 className="print-only">Escala de turnos · {label}</h2>
    <RosterBoard key={`${r.from}|${r.to}`} data={data} canPlan={planner} copySource={view === 'mes' ? null : { from: r.prev, to: addDays(r.from, -1) }} />
  </>;
}

function MyShifts({ data, prev, next }: { data: MineData; prev: string; next: string }) {
  const byDate = new Map(data.days.map(d => [d.date, d]));
  const all = Array.from({ length: 28 }, (_, i) => addDays(data.from, i));
  const total = data.days.reduce((s, d) => s + d.workMinutes, 0);
  const n = data.days.filter(d => d.kind === 'shift').length;
  return <>
    <div className="grid">
      <div className="card kpi"><div className="l">Próximo turno</div>
        {data.next ? <><div className="v" style={{ fontSize: 18 }}>{weekday(data.next.date)} {dm(data.next.date)} · {data.next.startTime}–{data.next.endTime}</div><div className="muted">{data.next.name}{data.next.date === data.today ? ' · hoje' : ''}</div></> : <><div className="v">—</div><div className="muted">Sem turnos publicados</div></>}
      </div>
      <div className="card kpi"><div className="l">Nas próximas 4 semanas</div><div className="v">{n} turno(s)</div><div className="muted">{formatShiftHours(total)} de trabalho previsto</div></div>
    </div>
    <div className="month-nav" style={{ marginBottom: 12 }}><Link className="btn ghost sm" href={prev}>←</Link><b>{pt(data.from)} a {pt(data.to)}</b><Link className="btn ghost sm" href={next}>→</Link><Link className="btn ghost sm" href="?v=meus">Hoje</Link></div>
    <div className="card">
      <table className="dense fit">
        <thead><tr><th>Dia</th><th>Turno</th><th className="num">Trabalho</th></tr></thead>
        <tbody>{all.map(d => {
          const s = byDate.get(d), hol = data.holidays[d], abs = data.absences[d];
          return <tr key={d} className={d === data.today ? 'row-today' : ''}>
            <td style={{ whiteSpace: 'nowrap' }}><b>{weekday(d)}</b> {dm(d)}{hol && <div className="muted" style={{ whiteSpace: 'normal', fontSize: 12 }}>{hol}</div>}</td>
            <td>{abs ? <span className="tag">{abs}</span> : s?.kind === 'shift' ? <><span className="shift-chip" style={chipStyle(s.color)}>{s.code}</span> <b>{s.startTime}–{s.endTime}</b><div className="muted">{s.name}{s.breakMinutes ? ` · intervalo ${s.breakMinutes} min` : ''}</div></> : s?.kind === 'off' ? <span className="tag">Folga</span> : <span className="muted">—</span>}</td>
            <td className="num">{s?.kind === 'shift' && !abs ? formatShiftHours(s.workMinutes) : ''}</td>
          </tr>;
        })}</tbody>
      </table>
      {!data.days.length && <div className="empty">Ainda não há turnos publicados para estas semanas. Os dias sem turno seguem o seu horário habitual.</div>}
    </div>
  </>;
}
