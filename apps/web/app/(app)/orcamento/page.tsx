import { formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { monthLabel } from '@/lib/format';
import { BudgetActions, BudgetGrid, BudgetPlanner, type Assumptions, type Dept } from './forms';

export const dynamic = 'force-dynamic';

interface CmpMonth { period: string; budgetMinor: number; actualMinor: number | null; varianceMinor: number | null; variancePct: number | null; budgetHeadcount: number; actualHeadcount: number | null }
interface Data {
  year: number; years: number[]; closed: string[]; departments: Dept[]; defaults: Assumptions;
  budget: null | { id: string; status: 'draft' | 'approved'; assumptions: Assumptions; notes: string | null; approvedAt: string | null; updatedAt: string };
  lines?: { period: string; departmentId: string | null; costMinor: number; headcount: number }[];
  comparison?: {
    months: CmpMonth[];
    departments: { departmentId: string | null; budgetYearMinor: number; budgetToDateMinor: number; actualToDateMinor: number; varianceMinor: number; variancePct: number | null }[];
    totals: { budgetYearMinor: number; budgetToDateMinor: number; actualToDateMinor: number; varianceMinor: number; variancePct: number | null; forecastMinor: number; closedMonths: number };
  };
}

const pctFmt = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? undefined : v > 0 ? 'var(--red)' : 'var(--brand)');

function scale(v: number) {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * exp).find((s) => s >= raw)!;
  return { max: Math.ceil(v / step) * step, step };
}
const short = (minor: number) => { const kz = minor / 100; return kz >= 1e6 ? `${String(Math.round((kz / 1e6) * 10) / 10).replace('.', ',')} M` : kz >= 1e3 ? `${Math.round(kz / 1e3)} mil` : String(Math.round(kz)); };

/** Orçado (claro) vs real (escuro) por mês; o real só existe nos meses com processamento fechado. */
function Chart({ months }: { months: CmpMonth[] }) {
  const W = 760, H = 240, L = 60, B = 30, T = 10;
  const { max, step } = scale(Math.max(...months.map((m) => Math.max(m.budgetMinor, m.actualMinor ?? 0))));
  const slot = (W - L - 8) / 12;
  const bw = Math.min(16, slot * 0.36);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Orçado e real por mês" style={{ width: '100%', height: 'auto' }}>
        {Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((t) => (
          <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#e6e8ec" /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8a92a1">{short(t)}</text></g>
        ))}
        {months.map((m, i) => {
          const cx = L + i * slot + slot / 2;
          return (
            <g key={m.period}>
              <rect x={cx - bw - 1} y={y(m.budgetMinor)} width={bw} height={y(0) - y(m.budgetMinor)} fill="#a9d3c8"><title>{`${monthLabel(m.period)} · orçado ${formatKz(m.budgetMinor)}`}</title></rect>
              {m.actualMinor !== null && <rect x={cx + 1} y={y(m.actualMinor)} width={bw} height={y(0) - y(m.actualMinor)} fill={m.actualMinor > m.budgetMinor * 1.005 ? '#c2412d' : '#0f5c4d'}><title>{`${monthLabel(m.period)} · real ${formatKz(m.actualMinor)} (${pctFmt(m.variancePct)})`}</title></rect>}
              <text x={cx} y={H - B + 16} textAnchor="middle" fontSize="11" fill="#4a5261">{monthLabel(m.period).slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ink2)' }}>
        {[['#a9d3c8', 'Orçado'], ['#0f5c4d', 'Real dentro do orçado'], ['#c2412d', 'Real acima do orçado']].map(([c, l]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}</span>)}
      </figcaption>
    </figure>
  );
}

export default async function Orcamento({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const canEdit = ['owner', 'hr_admin', 'finance'].includes(me.user.role);
  const isOwner = me.user.role === 'owner';
  const sp = await searchParams;
  const d = await api<Data>(`/v1/budgets${sp.ano ? `?year=${encodeURIComponent(sp.ano)}` : ''}`);
  const now = new Date().getFullYear();
  const years = [...new Set([now - 1, now, now + 1, ...d.years, d.year])].sort();
  const dname = (id: string | null) => d.departments.find((x) => x.id === id)?.name ?? 'Sem departamento';
  const b = d.budget;
  const c = d.comparison;
  const kpi = (l: string, v: string, note?: string, color?: string) => (
    <div className="card kpi"><div className="l">{l}</div><div className="v" style={{ fontSize: 21, color }}>{v}</div>{note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}</div>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Orçamento de pessoal {d.year}</h1>
          <p className="sub">Custo com pessoal previsto (ilíquido + INSS da empresa) por mês e departamento, comparado com os processamentos fechados{b ? <> · <span className={`st ${b.status === 'approved' ? 'approved' : 'pending'}`}>{b.status === 'approved' ? 'Aprovado' : 'Rascunho'}</span></> : null}</p>
        </div>
        <div className="actions" style={{ alignItems: 'center' }}>
          <form><select name="ano" defaultValue={d.year} aria-label="Ano">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select> <button className="btn ghost sm">Ver</button></form>
          {b && <BudgetActions id={b.id} status={b.status} isOwner={isOwner} canEdit={canEdit} />}
        </div>
      </div>

      {!b && (canEdit
        ? <BudgetPlanner init={d.defaults} departments={d.departments} />
        : <div className="card empty">Ainda não há orçamento para {d.year}.</div>)}

      {b && c && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
            {kpi('Orçado no ano', formatKz(c.totals.budgetYearMinor))}
            {kpi(`Real (${c.totals.closedMonths} ${c.totals.closedMonths === 1 ? 'mês fechado' : 'meses fechados'})`, formatKz(c.totals.actualToDateMinor), `orçado nesses meses ${formatKz(c.totals.budgetToDateMinor)}`)}
            {kpi('Desvio acumulado', `${c.totals.varianceMinor > 0 ? '+' : ''}${formatKz(c.totals.varianceMinor)}`, `${pctFmt(c.totals.variancePct)} · positivo = acima do orçado`, tone(c.totals.variancePct))}
            {kpi('Previsão de fecho do ano', formatKz(c.totals.forecastMinor), `real dos meses fechados + orçado dos restantes · ${pctFmt(c.totals.budgetYearMinor ? ((c.totals.forecastMinor - c.totals.budgetYearMinor) / c.totals.budgetYearMinor) * 100 : null)} vs orçado`, tone(c.totals.budgetYearMinor ? ((c.totals.forecastMinor - c.totals.budgetYearMinor) / c.totals.budgetYearMinor) * 100 : null))}
          </div>

          <div className="card" style={{ padding: 16, marginTop: 14 }}><h2 style={{ fontSize: 14, marginTop: 0 }}>Orçado vs real</h2><Chart months={c.months} /></div>

          <div className="card section" style={{ marginTop: 14 }}>
            <table className="dense">
              <thead><tr><th>Mês</th><th className="num">Orçado</th><th className="num">Real</th><th className="num">Desvio</th><th className="num">%</th><th className="num">Efectivo orç. / real</th></tr></thead>
              <tbody>
                {c.months.map((m) => (
                  <tr key={m.period}>
                    <td>{monthLabel(m.period)}</td><td className="num">{formatKz(m.budgetMinor)}</td>
                    <td className="num">{m.actualMinor === null ? <span className="muted">—</span> : formatKz(m.actualMinor)}</td>
                    <td className="num" style={{ color: tone(m.variancePct) }}>{m.varianceMinor === null ? '' : `${m.varianceMinor > 0 ? '+' : ''}${formatKz(m.varianceMinor)}`}</td>
                    <td className="num" style={{ color: tone(m.variancePct) }}>{m.variancePct === null ? '' : pctFmt(m.variancePct)}</td>
                    <td className="num">{String(m.budgetHeadcount).replace('.', ',')} / {m.actualHeadcount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card section" style={{ marginTop: 14 }}>
            <h2 style={{ fontSize: 14, padding: '12px 16px 0' }}>Por departamento (meses fechados)</h2>
            <table className="dense">
              <thead><tr><th>Departamento</th><th className="num">Orçado no ano</th><th className="num">Orçado (fechados)</th><th className="num">Real</th><th className="num">Desvio</th><th className="num">%</th></tr></thead>
              <tbody>
                {c.departments.map((x) => (
                  <tr key={x.departmentId ?? 'none'}>
                    <td><b>{dname(x.departmentId)}</b></td><td className="num">{formatKz(x.budgetYearMinor)}</td><td className="num">{formatKz(x.budgetToDateMinor)}</td><td className="num">{formatKz(x.actualToDateMinor)}</td>
                    <td className="num" style={{ color: tone(x.variancePct) }}>{x.varianceMinor > 0 ? '+' : ''}{formatKz(x.varianceMinor)}</td><td className="num" style={{ color: tone(x.variancePct) }}>{pctFmt(x.variancePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ padding: '0 16px 12px', margin: 0 }}>O real usa o departamento actual de cada ficha.</p>
          </div>

          <div style={{ marginTop: 14 }}>
            <BudgetGrid budgetId={b.id} year={d.year} departments={d.departments} lines={d.lines ?? []} editable={canEdit && b.status === 'draft'} />
          </div>
          {canEdit && b.status === 'draft' && <div style={{ marginTop: 14 }}><BudgetPlanner init={{ ...d.defaults, ...b.assumptions }} departments={d.departments} budgetId={b.id} /></div>}
          {b.status === 'approved' && <p className="muted">Aprovado em {b.approvedAt ? new Date(b.approvedAt).toLocaleDateString('pt-PT') : ''}. Para alterar, o proprietário reabre o orçamento.</p>}
        </>
      )}
    </>
  );
}
