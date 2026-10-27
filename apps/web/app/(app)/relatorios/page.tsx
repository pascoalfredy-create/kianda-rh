import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { monthLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Group = 'base' | 'allowances' | 'annual' | 'variable' | 'exit';
interface Month { period: string; headcount: number; hires: number; exits: number; grossMinor: number; employerInssMinor: number; costMinor: number; groups: Record<Group, number>; overtimeHours: number; overtimeMinor: number; absenceDays: number; workingDays: number; absenteeismPct: number }
interface Dept { id: string | null; name: string; costCenter: string; headcount: number; costMinor: number; avgMonthlyCostMinor: number; overtimeMinor: number; absenceDays: number; sharePct: number }
interface Report {
  empty?: boolean; available: string[]; from: string; to: string; months: Month[]; departments: Dept[]; groupLabels: Record<Group, string>;
  totals: { costMinor: number; grossMinor: number; employerInssMinor: number; groups: Record<Group, number>; headcountEnd: number; avgHeadcount: number; hires: number; exits: number; turnoverPct: number; avgMonthlyCostPerHeadMinor: number; overtimeHours: number; overtimeMinor: number; overtimeSharePct: number; absenteeismPct: number };
}

const GROUPS: Group[] = ['base', 'allowances', 'annual', 'variable', 'exit'];
const COLOR: Record<Group | 'inss', string> = { base: '#0f5c4d', allowances: '#4f9a89', annual: '#a9d3c8', variable: '#b7791f', exit: '#c2412d', inss: '#8a92a1' };
const pctFmt = (v: number) => `${String(v.toFixed(1)).replace('.', ',')}%`;
const short = (minor: number) => {
  const kz = minor / 100;
  if (kz >= 1e9) return `${(kz / 1e9).toFixed(1).replace('.', ',')} mM`;
  if (kz >= 1e6) return `${String(Math.round((kz / 1e6) * 10) / 10).replace('.', ',')} M`;
  if (kz >= 1e3) return `${Math.round(kz / 1e3)} mil`;
  return String(Math.round(kz));
};
const mon = (p: string) => monthLabel(p).slice(0, 3) + ' ' + p.slice(2, 4);

/** Escala com passos redondos (1, 2 ou 5 × 10^n) e 3 a 5 divisões. */
function scale(v: number) {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * exp).find((s) => s >= raw)!;
  return { max: Math.ceil(v / step) * step, step };
}

/** Colunas empilhadas do custo mensal por rubrica (+ INSS da empresa); efectivo por baixo de cada mês. */
function CostChart({ months, labels }: { months: Month[]; labels: Record<Group, string> }) {
  const W = 760, H = 260, L = 64, B = 44, T = 12;
  const { max, step } = scale(Math.max(...months.map((m) => m.costMinor)));
  const slot = (W - L - 8) / months.length;
  const bw = Math.min(42, slot * 0.62);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Custo com pessoal por mês e rubrica" style={{ width: '100%', height: 'auto' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#e6e8ec" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8a92a1">{short(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          let acc = 0;
          const parts: [string, number, string][] = [...GROUPS.map((g) => [g, Math.max(0, m.groups[g]), labels[g]] as [string, number, string]), ['inss', m.employerInssMinor, 'INSS da empresa (8%)']];
          return (
            <g key={m.period}>
              {parts.map(([k, v, label]) => {
                if (!v) return null;
                const y0 = y(acc + v), h = y(acc) - y(acc + v);
                acc += v;
                return <rect key={k} x={x} y={y0} width={bw} height={Math.max(0.5, h)} fill={COLOR[k as Group | 'inss']}><title>{`${monthLabel(m.period)} · ${label}: ${formatKz(v)}`}</title></rect>;
              })}
              <text x={x + bw / 2} y={H - B + 16} textAnchor="middle" fontSize="11" fill="#4a5261">{mon(m.period)}</text>
              <text x={x + bw / 2} y={H - B + 31} textAnchor="middle" fontSize="10.5" fill="#8a92a1">{m.headcount} pess.</text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12, color: 'var(--ink2)', marginTop: 6 }}>
        {[...GROUPS.map((g) => [g, labels[g]] as const), ['inss', 'INSS da empresa (8%)'] as const].map(([k, l]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: COLOR[k as Group | 'inss'], display: 'inline-block' }} />{l}</span>
        ))}
      </figcaption>
    </figure>
  );
}

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.de) qs.set('from', sp.de);
  if (sp.ate) qs.set('to', sp.ate);
  const r = await api<Report>(`/v1/reports/people${qs.size ? `?${qs}` : ''}`);
  if (r.empty) {
    return (
      <>
        <h1>Relatórios de pessoas</h1>
        <div className="card empty">Os relatórios usam os processamentos fechados — ainda não há nenhum. <Link href="/processamento" style={{ color: 'var(--brand)' }}>Ir para o processamento →</Link></div>
      </>
    );
  }
  const t = r.totals;
  const xlsxHref = `/api/v1/reports/people?format=xlsx&from=${r.from}&to=${r.to}`;
  const kpi = (l: string, v: string, note?: string, color?: string) => (
    <div className="card kpi"><div className="l">{l}</div><div className="v" style={{ fontSize: 22, color }}>{v}</div>{note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}</div>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relatórios de pessoas</h1>
          <p className="sub">{monthLabel(r.from)} a {monthLabel(r.to)} · processamentos fechados · custo com pessoal = ilíquido + INSS da empresa</p>
        </div>
        <form className="actions" style={{ alignItems: 'center' }}>
          <select name="de" defaultValue={r.from} aria-label="De">{r.available.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}</select>
          <span className="muted">a</span>
          <select name="ate" defaultValue={r.to} aria-label="Até">{r.available.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}</select>
          <button className="btn ghost sm">Ver</button>
          <a className="btn sm" href={xlsxHref}>Exportar Excel</a>
        </form>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
        {kpi('Custo com pessoal', formatKz(t.costMinor), `ilíquido ${formatKz(t.grossMinor)} + INSS ${formatKz(t.employerInssMinor)}`)}
        {kpi('Custo médio mensal por pessoa', formatKz(t.avgMonthlyCostPerHeadMinor))}
        {kpi('Efectivo', String(t.headcountEnd), `média ${String(t.avgHeadcount).replace('.', ',')} · +${t.hires} admissões · −${t.exits} saídas`)}
        {kpi('Rotatividade', pctFmt(t.turnoverPct), 'saídas / efectivo médio', t.turnoverPct > 15 ? 'var(--amber)' : undefined)}
        {kpi('Absentismo', pctFmt(t.absenteeismPct), 'faltas e ausências (sem férias nem licenças parentais)', t.absenteeismPct > 5 ? 'var(--amber)' : undefined)}
        {kpi('Horas extra', formatKz(t.overtimeMinor), `${String(t.overtimeHours).replace('.', ',')} h · ${pctFmt(t.overtimeSharePct)} do ilíquido`, t.overtimeSharePct > 10 ? 'var(--amber)' : undefined)}
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Custo com pessoal por mês</h2>
        <CostChart months={r.months} labels={r.groupLabels} />
      </div>

      <div className="card section" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 14, padding: '12px 16px 0' }}>Por departamento</h2>
        <table>
          <thead><tr><th>Departamento</th><th>Centro de custo</th><th className="num">Efectivo</th><th className="num">Custo</th><th>Peso</th><th className="num">Custo médio mensal</th><th className="num">Horas extra</th><th className="num">Dias de ausência</th></tr></thead>
          <tbody>
            {r.departments.map((d) => (
              <tr key={d.id ?? 'none'}>
                <td><b>{d.name}</b></td><td className="muted">{d.costCenter}</td><td className="num">{d.headcount}</td><td className="num">{formatKz(d.costMinor)}</td>
                <td style={{ minWidth: 120 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ height: 6, width: `${Math.max(2, d.sharePct)}%`, maxWidth: 80, background: 'var(--brand)', borderRadius: 3 }} /><span className="muted">{pctFmt(d.sharePct)}</span></div></td>
                <td className="num">{formatKz(d.avgMonthlyCostMinor)}</td><td className="num">{formatKz(d.overtimeMinor)}</td><td className="num">{String(d.absenceDays).replace('.', ',')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '0 16px 12px', margin: 0 }}>Pelo departamento actual de cada ficha.</p>
      </div>

      <div className="card section" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 14, padding: '12px 16px 0' }}>Mês a mês</h2>
        <table className="dense">
          <thead><tr><th>Mês</th><th className="num">Efectivo</th><th className="num">Entradas / saídas</th><th className="num">Ilíquido</th><th className="num">INSS 8%</th><th className="num">Custo</th><th className="num">Horas extra</th><th className="num">Absentismo</th></tr></thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.period}>
                <td><Link href={`/processamento?mes=${m.period}`}>{monthLabel(m.period)}</Link></td><td className="num">{m.headcount}</td><td className="num">+{m.hires} / −{m.exits}</td>
                <td className="num">{formatKz(m.grossMinor)}</td><td className="num">{formatKz(m.employerInssMinor)}</td><td className="num"><b>{formatKz(m.costMinor)}</b></td>
                <td className="num">{formatKz(m.overtimeMinor)}<div className="muted">{String(m.overtimeHours).replace('.', ',')} h</div></td><td className="num">{pctFmt(m.absenteeismPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Não inclui despesas e ajudas de custo (ver Despesas). O absentismo conta faltas injustificadas, doença, faltas justificadas, casamento, luto e formação, sobre os dias úteis do mês sem feriados.</p>
    </>
  );
}
