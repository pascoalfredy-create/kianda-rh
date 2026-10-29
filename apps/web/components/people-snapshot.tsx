import { formatKz } from '@kianda/core';
import type { PersonnelOverview } from '@/lib/personnel';
import { RhBars } from './rh-bars';

export function PeopleSnapshot({ data, absenteeism }: { data: PersonnelOverview | null; absenteeism?: number | null }) {
  if (!data?.demographics) return <div className="warn">Não foi possível carregar os indicadores do quadro actual.</div>;
  const d = data.demographics;
  return <>
    <div className="rh-kpis"><div className="card kpi"><div className="l">Equilíbrio de género</div><div className="v">{data.active ? `${Math.round(d.women / data.active * 100)}% F` : '—'}</div><div className="d">{d.women} mulheres · {d.men} homens{d.unspecified ? ` · ${d.unspecified} sem indicação` : ''}</div></div><div className="card kpi"><div className="l">Antiguidade média</div><div className="v">{d.avgTenureYears === null ? '—' : `${d.avgTenureYears.toFixed(1).replace('.', ',')} anos`}</div></div><div className="card kpi"><div className="l">Salário base mediano</div><div className="v">{d.medianBaseMinor === null ? '—' : formatKz(d.medianBaseMinor)}</div><div className="d">Rácio máx./mín.: {d.salaryRatio === null ? '—' : `${d.salaryRatio.toFixed(1).replace('.', ',')}×`}</div></div><div className="card kpi"><div className="l">Absentismo no período</div><div className="v">{absenteeism == null ? '—' : `${absenteeism.toFixed(2).replace('.', ',')}%`}</div><div className="d">Processamentos fechados</div></div></div>
    <div className="two" style={{ marginBottom: 16 }}><div className="card"><div className="rh-card-head"><h2>Efectivo por departamento</h2><span className="muted">Quadro actual</span></div><div className="rh-card-body"><RhBars rows={data.departments.map(d => ({ name: d.name, value: d.headcount, label: String(d.headcount) }))} /></div></div><div className="card"><div className="rh-card-head"><h2>Custo mensal por departamento</h2><span className="muted">Estimativa do quadro actual</span></div><div className="rh-card-body"><RhBars money rows={data.departments.map(d => ({ name: d.name, value: d.costMinor ?? 0, label: formatKz(d.costMinor ?? 0) }))} /></div></div></div>
  </>;
}
