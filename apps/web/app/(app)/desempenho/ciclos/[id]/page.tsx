import type { Competency } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import { CycleActions } from '../../forms';
import { CYCLE_STATUS, REVIEW_STATUS } from '../../status';

export const dynamic = 'force-dynamic';

interface Detail { id: string; name: string; periodFrom: string; periodTo: string; deadline: string | null; status: string; selfReview: boolean; competencyWeight: number; competencies: Competency[]; distribution: Record<string, number>; reviews: { id: string; employeeName: string; number: string; jobTitle: string; reviewerName: string; status: string; finalScore: number | null; rating: string; recommendation: string | null }[] }
const pt = (d: string) => d.split('-').reverse().join('/');
const REC: Record<string, string> = { raise: 'Aumento', promotion: 'Promoção', training: 'Formação', improvement_plan: 'Plano de melhoria' };

export default async function Ciclo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api<Detail>(`/v1/review-cycles/${id}`);
  const max = Math.max(1, ...Object.values(c.distribution));
  const done = c.reviews.filter((r) => ['acknowledgement', 'done'].includes(r.status)).length;
  return (
    <>
      <div className="crumb"><Link href="/desempenho">Desempenho</Link> / {c.name}</div>
      <div className="page-head">
        <div>
          <h1>{c.name} <span className={CYCLE_STATUS[c.status]?.[1]} style={{ fontSize: 13, verticalAlign: 'middle' }}>{CYCLE_STATUS[c.status]?.[0]}</span></h1>
          <p className="sub">{pt(c.periodFrom)} a {pt(c.periodTo)}{c.deadline ? ` · prazo ${pt(c.deadline)}` : ''} · {c.competencyWeight}% competências, {100 - c.competencyWeight}% objectivos · {c.selfReview ? 'com' : 'sem'} auto-avaliação</p>
        </div>
        <CycleActions id={c.id} status={c.status} />
      </div>
      {c.status !== 'draft' && (
        <div className="two" style={{ alignItems: 'start' }}>
          <div className="card kpi"><div className="l">Concluídas</div><div className="v">{done} de {c.reviews.length}</div><div className="muted">{c.reviews.filter((r) => r.status === 'self').length} em auto-avaliação · {c.reviews.filter((r) => r.status === 'manager').length} com a chefia</div></div>
          <div className="card section">
            <h2>Distribuição das classificações</h2>
            <div style={{ padding: '0 16px 14px', display: 'grid', gap: 6 }}>
              {Object.entries(c.distribution).map(([l, n]) => (
                <div key={l} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 30px', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span>{l}</span><span style={{ height: 10, borderRadius: 5, background: 'var(--brand)', width: `${(n / max) * 100}%`, minWidth: n ? 6 : 0 }} /><b>{n}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {c.status === 'draft' && (
        <div className="card section">
          <h2>Competências</h2>
          <table className="dense"><tbody>{c.competencies.map((k) => <tr key={k.key}><td>{k.label}</td><td className="num">{k.weight}%</td></tr>)}</tbody></table>
          <p className="muted" style={{ padding: '6px 16px 12px' }}>Ao lançar, é criada uma avaliação por colaborador activo admitido até {pt(c.periodTo)}; a avaliadora é a chefia directa (sem chefia: o RH).</p>
        </div>
      )}
      {c.reviews.length > 0 && (
        <div className="card">
          <table>
            <thead><tr><th>Colaborador</th><th>Avaliador</th><th>Situação</th><th className="num">Nota</th><th>Recomendação</th></tr></thead>
            <tbody>
              {c.reviews.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/desempenho/${r.id}`}><b>{r.number} · {r.employeeName}</b></Link><div className="muted">{r.jobTitle}</div></td>
                  <td>{r.reviewerName}</td>
                  <td><span className={REVIEW_STATUS[r.status]?.[1]}>{REVIEW_STATUS[r.status]?.[0]}</span></td>
                  <td className="num">{r.finalScore !== null ? <><b>{String(r.finalScore).replace('.', ',')}</b> <span className="muted">{r.rating}</span></> : '—'}</td>
                  <td>{r.recommendation && REC[r.recommendation] ? <span className="tag">{REC[r.recommendation]}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
