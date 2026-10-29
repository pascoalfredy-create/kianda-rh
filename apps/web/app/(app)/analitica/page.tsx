import { formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { monthLabel } from '@/lib/format';
import { RhBars } from '@/components/rh-bars';

export const dynamic = 'force-dynamic';
interface Analysis { available: string[]; months: string[]; centres: { name: string; departments: string[]; values: Record<string, number>; totalMinor: number }[]; totalMinor: number; locations: { name: string; costMinor: number }[] }
export default async function Analitica({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.de) q.set('from', sp.de); if (sp.ate) q.set('to', sp.ate);
  const data = await api<Analysis>(`/v1/reports/analytics?${q}`);
  return <><div className="page-head"><div><h1>Contabilidade analítica</h1><p className="sub">Custo com pessoal por centro de custo e local de trabalho</p></div>{data.available.length > 0 && <form className="actions"><select name="de" aria-label="De" defaultValue={data.months[0]}>{data.available.map(p => <option key={p} value={p}>{monthLabel(p)}</option>)}</select><select name="ate" aria-label="Até" defaultValue={data.months.at(-1)}>{data.available.map(p => <option key={p} value={p}>{monthLabel(p)}</option>)}</select><button className="btn ghost sm">Ver</button></form>}</div>
    <div className="card"><div className="rh-card-head"><h2>Custo por centro de custo</h2><span className="muted">Ilíquido + INSS da empresa · processamentos fechados</span></div>{data.months.length ? <div className="table-scroll"><table><thead><tr><th>Centro de custo</th>{data.months.map(p => <th key={p} className="num">{monthLabel(p)}</th>)}<th className="num">Total</th><th className="num">Peso</th></tr></thead><tbody>{data.centres.map(c => <tr key={c.name}><td><b>{c.name}</b><small className="muted" style={{ display: 'block' }}>{c.departments.join(', ')}</small></td>{data.months.map(p => <td key={p} className="num">{formatKz(c.values[p] ?? 0)}</td>)}<td className="num"><b>{formatKz(c.totalMinor)}</b></td><td className="num">{data.totalMinor ? `${(c.totalMinor / data.totalMinor * 100).toFixed(1).replace('.', ',')}%` : '—'}</td></tr>)}</tbody><tfoot><tr><td><b>Total</b></td>{data.months.map(p => <td className="num" key={p}><b>{formatKz(data.centres.reduce((s, c) => s + (c.values[p] ?? 0), 0))}</b></td>)}<td className="num"><b>{formatKz(data.totalMinor)}</b></td><td className="num">{data.totalMinor ? '100%' : '—'}</td></tr></tfoot></table></div> : <div className="empty">Ainda não há processamentos fechados neste período. <Link href="/processamento">Ir para o processamento →</Link></div>}</div>
    <div className="card" style={{ marginTop: 16 }}><div className="rh-card-head"><h2>Custo mensal por local de trabalho</h2><span className="muted">Estimativa do quadro actual</span></div><div className="rh-card-body"><RhBars money rows={data.locations.map(l => ({ name: l.name, value: l.costMinor, label: formatKz(l.costMinor) }))} /></div></div>
    <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>O centro de custo segue o departamento actual da ficha. O mapa por local usa a província e a remuneração corrente, sem variáveis mensais nem subsídios anuais.</p>
  </>;
}
