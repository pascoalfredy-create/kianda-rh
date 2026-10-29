'use client';

import { PIPELINE, SOURCES, STAGE_LABEL, type Stage } from '@kianda/core';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { send } from '@/lib/client';

export interface PipelineCandidate { id: string; name: string; stage: Stage; rating: number | null; source: string; openingId: string; openingTitle: string; movable: boolean }
export function CandidatePipeline({ candidates, canHire }: { candidates: PipelineCandidate[]; canHire: boolean }) {
  const [rows, setRows] = useState(candidates), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null);
  const moving = useRef(false);
  const router = useRouter();
  useEffect(() => { setRows(candidates); }, [candidates]);
  async function move(id: string, stage: Stage) {
    const c = rows.find(c => c.id === id);
    if (!c?.movable || c.stage === stage || moving.current || stage === 'hired' || c.stage === 'hired') return;
    moving.current = true; setBusy(id); setError('');
    try {
      const r = await send(`/v1/candidates/${encodeURIComponent(id)}/stage`, 'POST', { stage });
      if (!r.ok) setError(r.message ?? 'Não foi possível mudar de fase.');
      else { setRows(rs => rs.map(c => c.id === id ? { ...c, stage } : c)); router.refresh(); }
    } catch { setError('Sem ligação. A candidatura mantém a fase anterior. Tente novamente.'); }
    finally { moving.current = false; setBusy(null); }
  }
  return <>{error && <div className="alert" role="alert">{error}</div>}<div className="candidate-board">{[...PIPELINE, 'hired' as Stage].map(stage => {
    const cs = rows.filter(c => c.stage === stage);
    return <section className="candidate-column" key={stage} aria-label={STAGE_LABEL[stage]} onDragOver={e => { if (stage !== 'hired' && !busy) e.preventDefault(); }} onDrop={e => { e.preventDefault(); void move(e.dataTransfer.getData('text/plain'), stage); }}><h2>{STAGE_LABEL[stage]} <span>{cs.length}</span></h2>{cs.map(c => <div key={c.id} className="candidate-tile" draggable={c.movable && c.stage !== 'hired' && !busy} onDragStart={e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <Link href={`/recrutamento/candidatos/${c.id}`}><b>{c.name}</b></Link><small>{c.openingTitle}</small><div className="candidate-meta"><span className="candidate-stars">{'★'.repeat(c.rating ?? 0)}{'☆'.repeat(5 - (c.rating ?? 0))}</span><small>{SOURCES[c.source as keyof typeof SOURCES] ?? c.source}</small></div>
      {c.movable && c.stage !== 'hired' && <select aria-label={`Mover ${c.name}`} value={c.stage} disabled={!!busy} onChange={e => void move(c.id, e.target.value as Stage)}>{PIPELINE.map(s => <option value={s} key={s}>{STAGE_LABEL[s]}</option>)}</select>}
      {canHire && c.stage === 'offer' && <Link className="btn ghost sm" href={`/colaboradores/novo?candidato=${c.id}`} style={{ marginTop: 8 }}>Admitir…</Link>}
    </div>)}{!cs.length && <div className="muted" style={{ fontSize: 12 }}>Sem candidatos</div>}</section>;
  })}</div><p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Arraste os cartões entre fases ou use o selector em cada cartão. A contratação conclui-se em «Admitir», com a criação da ficha do colaborador.</p></>;
}
