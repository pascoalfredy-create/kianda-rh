import { PIPELINE, SOURCES, STAGE_LABEL, type Stage } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AddCandidate, OpeningForm } from '../forms';
import { OPENING_STATUS } from '../status';

export const dynamic = 'force-dynamic';

interface Cand { id: string; name: string; stage: Stage; source: keyof typeof SOURCES; rating: number | null; createdAt: string; updatedAt: string; rejectionReason: string | null }
interface Detail { id: string; title: string; status: string; isPublic: boolean; canEdit: boolean; description: string | null; requirements: string | null; candidates: Cand[]; stats: { total: number; hireRate: number; avgDaysToHire: number | null; bySource: Record<string, number> } }

const days = (d: string) => Math.max(0, Math.round((Date.now() - Date.parse(d)) / 86_400_000));

export default async function Vaga({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editar?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const o = await api<Detail & Record<string, unknown>>(`/v1/openings/${id}`);
  const [departments, people] = o.canEdit && sp.editar ? await Promise.all([api<{ id: string; name: string }[]>('/v1/departments'), api<{ id: string; name: string; status: string }[]>('/v1/employees')]) : [[], []];
  const closed = o.candidates.filter((c) => !PIPELINE.includes(c.stage));
  return (
    <>
      <div className="crumb"><Link href="/recrutamento">Recrutamento</Link> / {o.title}</div>
      <div className="page-head">
        <div>
          <h1>{o.title} <span className={OPENING_STATUS[o.status]?.[1]} style={{ fontSize: 13, verticalAlign: 'middle' }}>{OPENING_STATUS[o.status]?.[0]}</span></h1>
          <p className="sub">{o.stats.total} candidato(s) · taxa de contratação {String(o.stats.hireRate).replace(".", ",")}%{o.stats.avgDaysToHire !== null ? ` · ${o.stats.avgDaysToHire} dias até contratar` : ''} · origem: {Object.entries(o.stats.bySource).map(([k, n]) => `${SOURCES[k as keyof typeof SOURCES] ?? k} ${n}`).join(', ') || '—'}</p>
        </div>
        <span className="actions">
          {o.canEdit && !sp.editar && <Link className="btn ghost" href="?editar=1">Editar vaga</Link>}
          {o.status !== 'closed' && <AddCandidate openingId={o.id} />}
        </span>
      </div>
      {sp.editar && o.canEdit && <OpeningForm departments={departments} people={people.filter((p) => p.status === 'active')} init={o as never} />}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PIPELINE.length}, minmax(180px, 1fr))`, gap: 10, overflowX: 'auto', marginBottom: 16 }}>
        {PIPELINE.map((s) => {
          const cs = o.candidates.filter((c) => c.stage === s);
          return (
            <div key={s} className="card" style={{ padding: 10, background: '#fafbfc', minHeight: 160 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 8 }}>{STAGE_LABEL[s]} <span className="muted">({cs.length})</span></div>
              {cs.map((c) => (
                <Link key={c.id} href={`/recrutamento/candidatos/${c.id}`} className="card" style={{ display: 'block', padding: 10, marginBottom: 8 }}>
                  <b>{c.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{SOURCES[c.source] ?? c.source} · há {days(c.createdAt)} dia(s)</div>
                  {c.rating ? <div style={{ color: '#d69e2e' }}>{'★'.repeat(c.rating)}<span style={{ color: '#cbd5e0' }}>{'★'.repeat(5 - c.rating)}</span></div> : null}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      {closed.length > 0 && (
        <div className="card section">
          <h2>Fechados</h2>
          <table className="dense"><tbody>{closed.map((c) => <tr key={c.id}><td><Link href={`/recrutamento/candidatos/${c.id}`}>{c.name}</Link></td><td><span className={c.stage === 'hired' ? 'st approved' : 'tag'}>{STAGE_LABEL[c.stage]}</span></td><td className="muted">{c.rejectionReason ?? ''}</td></tr>)}</tbody></table>
        </div>
      )}
      {(o.description || o.requirements) && (
        <div className="two">
          {o.description && <div className="card section"><h2>Descrição</h2><p style={{ padding: '0 16px 14px', whiteSpace: 'pre-wrap' }}>{o.description}</p></div>}
          {o.requirements && <div className="card section"><h2>Requisitos</h2><p style={{ padding: '0 16px 14px', whiteSpace: 'pre-wrap' }}>{o.requirements}</p></div>}
        </div>
      )}
    </>
  );
}
