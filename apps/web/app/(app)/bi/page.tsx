import { formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import type { PersonnelOverview } from '@/lib/personnel';
import { PeopleSnapshot } from '@/components/people-snapshot';
import { RhBars } from '@/components/rh-bars';
import { monthLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Painel de indicadores com as mesmas fontes e componentes já usados nos mapas de RH. */
export default async function Bi() {
  const me = (await currentUser())!;
  if (!me.modules.hr.canAccess) redirect('/modulos');
  if (!['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role)) redirect('/');
  const overview = await api<PersonnelOverview>('/v1/reports/overview');
  const f = overview.financial;
  const source = f?.source === 'estimate' ? 'Estimativa do quadro actual' : f?.source === 'draft' ? 'Processamento em rascunho' : 'Processamento fechado';
  return <>
    <div className="page-head"><div><h1>Painel BI</h1><p className="sub">Gestão de pessoas · {me.company?.name}</p></div></div>
    <div className="rh-kpis">
      <div className="card kpi"><div className="l">Colaboradores activos</div><div className="v">{overview.active}</div><div className="d">{overview.fixedTerm} a termo · {overview.interns} estagiário(s)</div></div>
      <div className="card kpi"><div className="l">Massa salarial bruta</div><div className="v">{f ? formatKz(f.grossMinor) : '—'}</div><div className="d">{f ? `${monthLabel(f.period)} · ${source}` : 'Sem dados salariais disponíveis'}</div></div>
      <div className="card kpi"><div className="l">Custo com pessoal</div><div className="v">{f ? formatKz(f.costMinor) : '—'}</div><div className="d">{f ? source : 'Sem dados disponíveis'}</div></div>
      <div className="card kpi"><div className="l">Retenções do mês</div><div className="v">{f ? formatKz(f.irtMinor + f.inssMinor) : '—'}</div><div className="d">{f ? `IRT ${formatKz(f.irtMinor)} · INSS ${formatKz(f.inssMinor)}` : 'Sem dados disponíveis'}</div></div>
    </div>
    <PeopleSnapshot data={overview} />
    <div className="two">
      <div className="card"><div className="rh-card-head"><h2>Efectivo por local de trabalho</h2><span className="muted">Quadro actual</span></div><div className="rh-card-body"><RhBars rows={overview.locations.map(l => ({ name: l.name, value: l.headcount, label: String(l.headcount) }))} /></div></div>
      <div className="card"><div className="rh-card-head"><h2>Custo mensal por local de trabalho</h2><span className="muted">Estimativa do quadro actual</span></div><div className="rh-card-body"><RhBars money rows={overview.locations.map(l => ({ name: l.name, value: l.costMinor, label: formatKz(l.costMinor) }))} /></div></div>
    </div>
  </>;
}
