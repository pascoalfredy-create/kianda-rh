import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { CycleForm } from './forms';
import { CYCLE_STATUS, REVIEW_STATUS } from './status';

export const dynamic = 'force-dynamic';

interface Item { id: string; cycleName: string; cycleStatus: string; deadline: string | null; employeeName: string; status: string; finalScore: string | null }
interface Cycle { id: string; name: string; periodFrom: string; periodTo: string; status: string; total: number; done: number; deadline: string | null }
const pt = (d: string) => d.split('-').reverse().join('/');

export default async function Desempenho() {
  const me = (await currentUser())!;
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const [{ mine, team }, cycles] = await Promise.all([api<{ mine: Item[]; team: Item[] }>('/v1/reviews'), hr ? api<Cycle[]>('/v1/review-cycles') : Promise.resolve([] as Cycle[])]);
  const focus = cycles.find(c => c.status !== 'draft');
  const summary = focus ? await api<{ reviews: { status: string; finalScore: number | null }[]; distribution: Record<string, number> }>(`/v1/review-cycles/${focus.id}`).catch(() => null) : null;
  const completed = summary?.reviews.filter(r => ['acknowledgement', 'done'].includes(r.status)) ?? [];
  const scores = completed.filter(r => r.finalScore !== null).map(r => Number(r.finalScore)).filter(Number.isFinite);
  const average = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null;
  const List = ({ items, who }: { items: Item[]; who: boolean }) => (
    <table>
      <tbody>
        {items.map((r) => (
          <tr key={r.id}>
            <td><Link href={`/desempenho/${r.id}`}><b>{who ? r.employeeName : r.cycleName}</b></Link>{who && <div className="muted">{r.cycleName}</div>}</td>
            <td><span className={REVIEW_STATUS[r.status]?.[1]}>{REVIEW_STATUS[r.status]?.[0]}</span></td>
            <td className="muted">{r.deadline ? `prazo ${pt(r.deadline)}` : ''}</td>
            <td className="num">{r.finalScore ? <b>{r.finalScore.replace('.', ',')}</b> : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <h1>Desempenho</h1>
      <p className="sub">Ciclos de avaliação por competências e objectivos, com auto-avaliação, avaliação da chefia e conhecimento do colaborador</p>
      {hr && <div className="rh-kpis"><div className="card kpi"><div className="l">Avaliações concluídas</div><div className="v">{completed.length}/{summary?.reviews.length ?? 0}</div><div className="d">{focus?.name ?? 'Sem ciclo lançado'}</div></div><div className="card kpi"><div className="l">Nota média</div><div className="v">{average === null ? '—' : average.toFixed(2).replace('.', ',')}</div><div className="d">Escala 1–5</div></div><div className="card kpi" style={{ gridColumn: 'span 2' }}><div className="l">Distribuição</div><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>{summary ? Object.entries(summary.distribution).map(([label, n]) => <div key={label} style={{ flex: 1, textAlign: 'center' }}><b style={{ fontSize: 20 }}>{n}</b><small className="muted" style={{ display: 'block', fontSize: 11 }}>{label}</small></div>) : <span className="muted">Sem avaliações concluídas</span>}</div></div></div>}
      {team.length > 0 && <div className="card section"><h2>Para avaliar (a minha equipa)</h2><List items={team} who /></div>}
      <div className="card section"><h2>As minhas avaliações</h2>{mine.length ? <List items={mine} who={false} /> : <div className="empty">Sem avaliações em curso.</div>}</div>
      {hr && (
        <>
          <div className="page-head" style={{ marginTop: 24 }}><h2 style={{ margin: 0 }}>Ciclos de avaliação</h2><CycleForm /></div>
          <div className="card">
            <table>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/desempenho/ciclos/${c.id}`}><b>{c.name}</b></Link><div className="muted">{pt(c.periodFrom)} a {pt(c.periodTo)}</div></td>
                    <td><span className={CYCLE_STATUS[c.status]?.[1]}>{CYCLE_STATUS[c.status]?.[0]}</span></td>
                    <td>{c.total ? `${c.done} de ${c.total} concluídas` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!cycles.length && <div className="empty">Ainda não há ciclos.</div>}
          </div>
        </>
      )}
    </>
  );
}
