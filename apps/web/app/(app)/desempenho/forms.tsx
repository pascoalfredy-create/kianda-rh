'use client';

import { ratingLabel, reviewScore, SCALE, type Competency, type Objective } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function CycleForm() {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const year = new Date().getFullYear();
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Novo ciclo de avaliação</button>;
  return (
    <form className="card form" style={{ marginBottom: 16 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      if (await run('/v1/review-cycles', 'POST', { name: f.get('name'), periodFrom: f.get('periodFrom'), periodTo: f.get('periodTo'), deadline: f.get('deadline') || null, selfReview: f.get('selfReview') === 'on', competencyWeight: Number(f.get('competencyWeight')) })) setOpen(false);
    }}>
      <label className="span2">Nome<input name="name" required defaultValue={`Avaliação anual ${year}`} /></label>
      <label>Período de<input type="date" name="periodFrom" required defaultValue={`${year}-01-01`} /></label>
      <label>a<input type="date" name="periodTo" required defaultValue={`${year}-12-31`} /></label>
      <label>Prazo para concluir<input type="date" name="deadline" /></label>
      <label>Peso das competências (%)<input type="number" name="competencyWeight" min={0} max={100} defaultValue={60} /></label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="selfReview" defaultChecked /> Com auto-avaliação</label>
      <p className="muted wide">Competências por omissão: qualidade, produtividade, conhecimento técnico, equipa, iniciativa e assiduidade (pesos somam 100%). Os objectivos de cada colaborador são definidos pela chefia na própria avaliação.</p>
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>Criar ciclo</button></div>
    </form>
  );
}

export function CycleActions({ id, status }: { id: string; status: string }) {
  const { busy, error, run } = useMutation();
  return (
    <span className="actions">
      {status === 'draft' && <button className="btn" disabled={busy} onClick={() => { if (window.confirm('Lançar o ciclo? É criada uma avaliação para cada colaborador activo, com a chefia directa como avaliadora.')) void run(`/v1/review-cycles/${id}/launch`, 'POST', {}); }}>Lançar ciclo</button>}
      {status === 'open' && <button className="btn ghost" disabled={busy} onClick={() => { if (window.confirm('Fechar o ciclo? As avaliações por concluir ficam como estão.')) void run(`/v1/review-cycles/${id}/close`, 'POST', {}); }}>Fechar ciclo</button>}
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

function Scale({ value, onChange, disabled }: { value: number | null | undefined; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {SCALE.map((s) => (
        <button key={s.value} type="button" disabled={disabled} title={s.label} onClick={() => onChange(s.value)}
          style={{ width: 34, height: 30, borderRadius: 7, border: '1px solid var(--line)', cursor: disabled ? 'default' : 'pointer', fontWeight: 700, background: value === s.value ? 'var(--brand)' : '#fff', color: value === s.value ? '#fff' : 'var(--ink2)' }}>{s.value}</button>
      ))}
    </span>
  );
}

interface ReviewData {
  id: string; status: string; role: 'self' | 'reviewer' | 'hr';
  objectives: Objective[]; selfScores: Record<string, number>; selfComment: string | null; managerScores: Record<string, number>; managerComment: string | null;
  recommendation: string | null; employeeComment: string | null; finalScore: number | null; rating: string | null;
  cycle: { competencies: Competency[]; competencyWeight: number; selfReview: boolean };
  can: { self: boolean; objectives: boolean; manager: boolean; skipSelf: boolean; acknowledge: boolean; reopen: boolean };
  recommendations: Record<string, string>;
}

export function ReviewForm({ r }: { r: ReviewData }) {
  const { busy, error, run } = useMutation();
  const comps = r.cycle.competencies;
  const [self, setSelf] = useState<Record<string, number>>(r.selfScores ?? {});
  const [selfComment, setSelfComment] = useState(r.selfComment ?? '');
  const [mgr, setMgr] = useState<Record<string, number>>(r.managerScores ?? {});
  const [objs, setObjs] = useState<Objective[]>(r.objectives ?? []);
  const [comment, setComment] = useState(r.managerComment ?? '');
  const [rec, setRec] = useState(r.recommendation ?? 'none');
  const [ack, setAck] = useState('');
  const live = reviewScore(comps, mgr, objs, r.cycle.competencyWeight);
  const showMgr = r.role !== 'self' || ['acknowledgement', 'done'].includes(r.status);
  const objSum = objs.reduce((s, o) => s + (o.weight || 0), 0);

  return (
    <>
      {r.can.objectives && (
        <div className="card section">
          <h2>Objectivos do período {objs.length > 0 && <span className={objSum === 100 ? 'tag future' : 'tag'} style={{ marginLeft: 8 }}>pesos {objSum}%</span>}</h2>
          <table className="dense">
            <tbody>
              {objs.map((o, i) => (
                <tr key={i}>
                  <td><input value={o.title} onChange={(e) => setObjs(objs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} style={{ width: '100%' }} placeholder="Ex.: fecho mensal até dia 5" /></td>
                  <td style={{ width: 110 }}><input type="number" min={0} max={100} value={o.weight} onChange={(e) => setObjs(objs.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} style={{ width: 70 }} /> %</td>
                  <td style={{ width: 40 }}><button className="btn ghost sm" onClick={() => setObjs(objs.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions" style={{ justifyContent: 'flex-start', padding: '10px 16px' }}>
            <button className="btn ghost sm" onClick={() => setObjs([...objs, { title: '', weight: 0 }])}>+ Objectivo</button>
            <button className="btn sm" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/objectives`, 'PUT', { objectives: objs.map((o) => ({ title: o.title, weight: o.weight, result: o.result ?? null, score: o.score ?? null })) })}>Gravar objectivos</button>
          </div>
        </div>
      )}

      <div className="card section">
        <h2>Competências</h2>
        <table className="dense">
          <thead><tr><th>Competência</th><th>Peso</th>{r.cycle.selfReview && <th>Auto-avaliação</th>}{showMgr && <th>Chefia</th>}</tr></thead>
          <tbody>
            {comps.map((k) => (
              <tr key={k.key}>
                <td>{k.label}</td><td className="muted">{k.weight}%</td>
                {r.cycle.selfReview && <td>{r.can.self ? <Scale value={self[k.key]} onChange={(v) => setSelf((s) => ({ ...s, [k.key]: v }))} /> : <b>{self[k.key] ?? '—'}</b>}</td>}
                {showMgr && <td>{r.can.manager ? <Scale value={mgr[k.key]} onChange={(v) => setMgr((s) => ({ ...s, [k.key]: v }))} /> : <b>{mgr[k.key] ?? '—'}</b>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '6px 16px 12px' }}>Escala: {SCALE.map((s) => `${s.value} ${s.label}`).join(' · ')}</p>
      </div>

      {r.can.self && (
        <div className="card form" style={{ gridTemplateColumns: '1fr', marginBottom: 16 }}>
          <label>Comentário (pontos fortes, dificuldades, necessidades de formação)<textarea rows={4} value={selfComment} onChange={(e) => setSelfComment(e.target.value)} /></label>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn ghost" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/self`, 'PUT', { scores: self, comment: selfComment, submit: false })}>Guardar</button>
            <button className="btn" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/self`, 'PUT', { scores: self, comment: selfComment, submit: true })}>Submeter auto-avaliação</button>
          </div>
        </div>
      )}
      {!r.can.self && r.selfComment && <div className="card section"><h2>Comentário do colaborador</h2><p style={{ padding: '0 16px 14px', whiteSpace: 'pre-wrap' }}>{r.selfComment}</p></div>}

      {showMgr && objs.length > 0 && (
        <div className="card section">
          <h2>Resultados dos objectivos</h2>
          <table className="dense">
            <tbody>
              {objs.map((o, i) => (
                <tr key={i}>
                  <td>{o.title} <span className="muted">({o.weight}%)</span></td>
                  <td>{r.can.manager ? <input value={o.result ?? ''} onChange={(e) => setObjs(objs.map((x, j) => (j === i ? { ...x, result: e.target.value } : x)))} placeholder="Resultado alcançado" style={{ width: '100%' }} /> : (o.result ?? '')}</td>
                  <td style={{ width: 200 }}>{r.can.manager ? <Scale value={o.score} onChange={(v) => setObjs((os) => os.map((x, j) => (j === i ? { ...x, score: v } : x)))} /> : <b>{o.score ?? '—'}</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.can.manager && (
        <div className="card form" style={{ gridTemplateColumns: '1fr 260px', marginBottom: 16 }}>
          <label className="wide">Comentário de fecho para o colaborador<textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <label>Recomendação<select value={rec} onChange={(e) => setRec(e.target.value)}>{Object.entries(r.recommendations).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div style={{ alignSelf: 'end' }}>Nota: <b style={{ fontSize: 18 }}>{live.final === null ? '—' : String(live.final).replace('.', ',')}</b> {live.final !== null && <span className="tag">{ratingLabel(live.final)}</span>}<div className="muted" style={{ fontSize: 12 }}>competências {live.competencies === null ? '—' : String(live.competencies).replace('.', ',')} · objectivos {live.objectives === null ? '—' : String(live.objectives).replace('.', ',')}</div></div>
          <div className="actions wide" style={{ justifyContent: 'flex-start' }}>
            <button className="btn ghost" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/manager`, 'PUT', { scores: mgr, objectives: objs.map((o) => ({ result: o.result ?? null, score: o.score ?? null })), comment, recommendation: rec, submit: false })}>Guardar</button>
            <button className="btn" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/manager`, 'PUT', { scores: mgr, objectives: objs.map((o) => ({ result: o.result ?? null, score: o.score ?? null })), comment, recommendation: rec, submit: true })}>Submeter avaliação</button>
          </div>
        </div>
      )}

      {!r.can.manager && showMgr && r.finalScore !== null && (
        <div className="card section">
          <h2>Resultado</h2>
          <div style={{ padding: '0 16px 14px' }}>
            <p>Nota final <b style={{ fontSize: 20 }}>{String(r.finalScore).replace('.', ',')}</b> — <b>{r.rating}</b>{r.recommendation && r.recommendation !== 'none' ? ` · recomendação: ${r.recommendations[r.recommendation]}` : ''}</p>
            {r.managerComment && <p style={{ whiteSpace: 'pre-wrap' }}>{r.managerComment}</p>}
            {r.employeeComment && <p className="muted">Comentário do colaborador: {r.employeeComment}</p>}
          </div>
        </div>
      )}

      {r.can.acknowledge && (
        <div className="card form" style={{ gridTemplateColumns: '1fr' }}>
          <label>O seu comentário (opcional — pode registar concordância ou discordância)<textarea rows={3} value={ack} onChange={(e) => setAck(e.target.value)} /></label>
          <div className="actions" style={{ justifyContent: 'flex-start' }}><button className="btn" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/acknowledge`, 'POST', { comment: ack || null })}>Tomei conhecimento</button></div>
        </div>
      )}
      <div className="actions" style={{ justifyContent: 'flex-start', margin: '10px 0' }}>
        {r.can.skipSelf && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/skip-self`, 'POST', {})}>Dispensar auto-avaliação</button>}
        {r.can.reopen && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/reviews/${r.id}/reopen`, 'POST', {})}>Reabrir avaliação</button>}
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
    </>
  );
}
