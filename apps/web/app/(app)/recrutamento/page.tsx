import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { CandidatePipeline, type PipelineCandidate } from './pipeline';
import { AddCandidate } from './forms';
import { OpeningForm } from './forms';

export const dynamic = 'force-dynamic';

interface Opening { id: string; title: string; status: string; isPublic: boolean; departmentName: string | null; hiringManagerName: string | null; positions: number; location: string | null; salaryMinMinor: number | null; salaryMaxMinor: number | null; closesOn: string | null; candidates: Omit<PipelineCandidate, 'openingId' | 'openingTitle' | 'movable'>[]; stats: { total: number; active: number; byStage: Record<string, number>; hireRate: number; avgDaysToHire: number | null } }
const OPENING_STATUS: Record<string, [string, string]> = { draft: ['Rascunho', 'tag'], open: ['Aberta', 'st approved'], on_hold: ['Suspensa', 'st pending'], closed: ['Fechada', 'tag'] };

export default async function Recrutamento({ searchParams }: { searchParams: Promise<{ vaga?: string }> }) {
  const { vaga } = await searchParams;
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'manager'].includes(me.user.role)) redirect('/');
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const openings = await api<Opening[]>('/v1/openings?includeCandidates=1');
  const [departments, people, auth] = hr ? await Promise.all([api<{ id: string; name: string }[]>('/v1/departments'), api<{ id: string; name: string; status: string }[]>('/v1/employees'), api<{ company: { id: string } }>('/v1/auth/me')]) : [[], [], null];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Recrutamento</h1>
          <p className="sub">Vagas, pipeline de candidatos e página de carreiras{auth ? <> — <a href={`/carreiras/${auth.company.id}`} target="_blank" rel="noreferrer">ver a página pública</a></> : null}</p>
        </div>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 16 }}>{hr && <OpeningForm departments={departments} people={people.filter((p) => p.status === 'active')} />}{vaga && openings.some(o => o.id === vaga && o.status !== 'closed') && <AddCandidate openingId={vaga} />}<form><select name="vaga" aria-label="Filtrar vaga" defaultValue={vaga ?? ''}><option value="">Todas as vagas</option>{openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select> <button className="btn ghost sm">Filtrar</button></form></div>
      <div className="vacancy-cards">
        {openings.map((o) => (
          <Link key={o.id} href={`/recrutamento/${o.id}`} className="card kpi" style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: 15 }}>{o.title}</b><span className={OPENING_STATUS[o.status]?.[1]}>{OPENING_STATUS[o.status]?.[0]}</span></div>
            <div className="muted">{[o.departmentName, o.location, o.hiringManagerName && `resp. ${o.hiringManagerName}`].filter(Boolean).join(' · ') || '—'}</div>
            <div><b>{o.stats.active}</b> em processo · {o.stats.total} candidato(s){o.stats.byStage.hired ? ` · ${o.stats.byStage.hired} contratado(s)` : ''}</div>
            {hr && (o.salaryMinMinor || o.salaryMaxMinor) ? <div className="muted">{o.salaryMinMinor ? formatKz(o.salaryMinMinor) : '…'} – {o.salaryMaxMinor ? formatKz(o.salaryMaxMinor) : '…'}</div> : null}
            {o.isPublic && <span className="tag future" style={{ justifySelf: 'start' }}>publicada</span>}
          </Link>
        ))}
      </div>
      {openings.length > 0 && <CandidatePipeline candidates={openings.filter(o => !vaga || o.id === vaga).flatMap(o => o.candidates.map(c => ({ ...c, openingId: o.id, openingTitle: o.title, movable: o.status !== 'closed' })))} canHire={hr} />}
      {!openings.length && <div className="card empty">{hr ? 'Ainda não há vagas. Crie a primeira.' : 'Não é responsável por nenhuma vaga.'}</div>}
    </>
  );
}
