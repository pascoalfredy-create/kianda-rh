import { formatKz, SOURCES, STAGE_LABEL, type CandidateProfile, type Stage } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import { EventForm, Rating, StageActions } from '../../forms';
import { DeleteCandidate } from '@/components/privacy-actions';
import { Attachments } from '@/components/attachments';

export const dynamic = 'force-dynamic';

interface Ev { id: string; kind: string; fromStage: Stage | null; toStage: Stage | null; text: string | null; scheduledAt: string | null; actorName: string | null; createdAt: string }
interface Cand { id: string; name: string; email: string | null; phone: string | null; source: keyof typeof SOURCES; stage: Stage; rating: number | null; cvUrl: string | null; coverLetter: string | null; profile: CandidateProfile; expectedSalaryMinor: number | null; availableFrom: string | null; rejectionReason: string | null; employeeId: string | null; consentAt: string | null; createdAt: string; opening: { id: string; title: string; status: string }; events: Ev[]; canHire: boolean }
const dt = (d: string) => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });

export default async function Candidato({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api<Cand>(`/v1/candidates/${id}`);
  return (
    <>
      <div className="crumb"><Link href="/recrutamento">Recrutamento</Link> / <Link href={`/recrutamento/${c.opening.id}`}>{c.opening.title}</Link> / {c.name}</div>
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <p className="sub"><span className={c.stage === 'hired' ? 'st approved' : c.stage === 'rejected' ? 'st rejected' : 'st pending'}>{STAGE_LABEL[c.stage]}</span> · {SOURCES[c.source] ?? c.source} · candidatura em {dt(c.createdAt)}</p>
        </div>
        <Rating id={c.id} value={c.rating} />
      </div>
      {c.stage !== 'hired' && c.opening.status !== 'closed' && <StageActions id={c.id} stage={c.stage} canHire={c.canHire} />}
      {c.opening.status === 'closed' && <p className="warn">A vaga está fechada. O RH pode reabri-la para retomar o processo.</p>}
      {!c.employeeId && <div style={{ margin: '0 0 14px' }}><DeleteCandidate id={c.id} back={`/recrutamento/${c.opening.id}`} /></div>}
      {c.employeeId && <div className="warn">Contratado. <Link href={`/colaboradores/${c.employeeId}`}>Abrir a ficha do colaborador</Link>.</div>}
      {c.rejectionReason && <div className="warn">Motivo: {c.rejectionReason}</div>}
      <div className="two" style={{ alignItems: 'start' }}>
        <div className="card section">
          <h2>Dados</h2>
          <dl className="dl">
            <div><dt>Email</dt><dd>{c.email ?? '—'}</dd></div>
            <div><dt>Telefone</dt><dd>{c.phone ?? '—'}</dd></div>
            {c.profile.currentRole && <div><dt>Função actual</dt><dd>{c.profile.currentRole}</dd></div>}
            {c.profile.yearsExperience != null && <div><dt>Experiência</dt><dd>{c.profile.yearsExperience} ano(s)</dd></div>}
            {c.profile.highestEducation && <div><dt>Formação</dt><dd>{c.profile.highestEducation}</dd></div>}
            {c.profile.fieldOfStudy && <div><dt>Área de formação</dt><dd>{c.profile.fieldOfStudy}</dd></div>}
            {c.profile.linkedinUrl && <div><dt>Perfil profissional</dt><dd><a href={c.profile.linkedinUrl} target="_blank" rel="noopener noreferrer">Abrir perfil</a></dd></div>}
            <div><dt>Pretensão salarial</dt><dd>{c.expectedSalaryMinor ? formatKz(c.expectedSalaryMinor) : '—'}</dd></div>
            <div><dt>Disponível a partir de</dt><dd>{c.availableFrom ? c.availableFrom.split('-').reverse().join('/') : '—'}</dd></div>
            <div><dt>CV</dt><dd>{c.cvUrl ? <a href={c.cvUrl} target="_blank" rel="noreferrer noopener">Abrir CV</a> : '—'}</dd></div>
            <div><dt>Consentimento</dt><dd>{c.consentAt ? `dado em ${dt(c.consentAt)}` : 'registado pelo RH'}</dd></div>
          </dl>
          <h2>CV e documentos</h2><div style={{ padding: '0 16px 16px' }}><Attachments entity="candidate" entityId={c.id} hint="Ficheiros desta candidatura" /></div>
          {c.coverLetter && <><h2>Apresentação</h2><p style={{ padding: '0 16px 14px', whiteSpace: 'pre-wrap' }}>{c.coverLetter}</p></>}
        </div>
        <div className="card section">
          <h2>Histórico</h2>
          <div style={{ padding: '0 16px' }}><EventForm id={c.id} /></div>
          <table className="dense">
            <tbody>
              {c.events.map((e) => (
                <tr key={e.id}>
                  <td style={{ width: 120 }} className="muted">{dt(e.createdAt)}</td>
                  <td>
                    {e.kind === 'stage' && <b>{e.fromStage ? `${STAGE_LABEL[e.fromStage]} → ` : ''}{e.toStage ? STAGE_LABEL[e.toStage] : ''}</b>}
                    {e.kind === 'interview' && <b>Entrevista em {dt(e.scheduledAt!)}</b>}
                    {e.text && <div>{e.text}</div>}
                    <div className="muted" style={{ fontSize: 12 }}>{e.actorName ?? ''}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
