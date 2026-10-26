'use client';

import { SOURCES, STAGE_LABEL, type Stage } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

const num = (v: FormDataEntryValue | null) => { const t = String(v ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return t === '' ? null : Number(t); };

export function OpeningForm({ departments, people, init }: { departments: { id: string; name: string }[]; people: { id: string; name: string }[]; init?: Record<string, unknown> & { id: string } }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(Boolean(init));
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Nova vaga</button>;
  const v = (k: string) => (init?.[k] as string | undefined) ?? '';
  return (
    <form className="card form" style={{ marginBottom: 16 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const payload = {
        title: f.get('title'), departmentId: f.get('departmentId') || null, hiringManagerId: f.get('hiringManagerId') || null, location: f.get('location') || null,
        contractType: f.get('contractType'), positions: Number(f.get('positions') || 1), salaryMin: num(f.get('salaryMin')), salaryMax: num(f.get('salaryMax')),
        description: f.get('description') || null, requirements: f.get('requirements') || null, status: f.get('status'), isPublic: f.get('isPublic') === 'on', closesOn: f.get('closesOn') || null,
      };
      if (await run(init ? `/v1/openings/${init.id}` : '/v1/openings', init ? 'PATCH' : 'POST', payload) && !init) setOpen(false);
    }}>
      <h3>{init ? 'Editar vaga' : 'Nova vaga'}</h3>
      <label className="span2">Título<input name="title" required defaultValue={v('title')} placeholder="Ex.: Contabilista sénior" /></label>
      <label>Departamento<select name="departmentId" defaultValue={v('departmentId')}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Chefia responsável<select name="hiringManagerId" defaultValue={v('hiringManagerId')}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Local<input name="location" defaultValue={v('location')} placeholder="Luanda" /></label>
      <label>Contrato<select name="contractType" defaultValue={v('contractType') || 'indefinite'}><option value="indefinite">Tempo indeterminado</option><option value="fixed_term">Tempo determinado</option><option value="internship">Estágio</option></select></label>
      <label>Lugares<input name="positions" type="number" min={1} defaultValue={String(init?.positions ?? 1)} /></label>
      <label>Salário mínimo (Kz)<input name="salaryMin" inputMode="decimal" defaultValue={init?.salaryMinMinor ? String(Number(init.salaryMinMinor) / 100) : ''} /></label>
      <label>Salário máximo (Kz)<input name="salaryMax" inputMode="decimal" defaultValue={init?.salaryMaxMinor ? String(Number(init.salaryMaxMinor) / 100) : ''} /></label>
      <label>Candidaturas até<input name="closesOn" type="date" defaultValue={v('closesOn')} /></label>
      <label>Estado<select name="status" defaultValue={v('status') || 'draft'}><option value="draft">Rascunho</option><option value="open">Aberta</option><option value="on_hold">Suspensa</option><option value="closed">Fechada</option></select></label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="isPublic" defaultChecked={Boolean(init?.isPublic)} /> Publicar na página de carreiras</label>
      <label className="wide">Descrição<textarea name="description" rows={4} defaultValue={v('description')} /></label>
      <label className="wide">Requisitos<textarea name="requirements" rows={4} defaultValue={v('requirements')} /></label>
      <p className="muted wide">O intervalo salarial é interno: não aparece na página de carreiras.</p>
      <div className="form-actions wide">
        {error && <span className="err">{error}</span>}
        {!init && <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>}
        <button className="btn" disabled={busy}>{init ? 'Gravar' : 'Criar vaga'}</button>
      </div>
    </form>
  );
}

export function AddCandidate({ openingId }: { openingId: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>+ Candidato</button>;
  return (
    <form className="card form" style={{ marginBottom: 14 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      if (await run(`/v1/openings/${openingId}/candidates`, 'POST', { name: f.get('name'), email: f.get('email') || null, phone: f.get('phone') || null, source: f.get('source'), cvUrl: f.get('cvUrl') || null, expectedSalary: num(f.get('expectedSalary')), note: f.get('note') || null })) setOpen(false);
    }}>
      <label className="span2">Nome<input name="name" required /></label>
      <label>Email<input name="email" type="email" /></label>
      <label>Telefone<input name="phone" /></label>
      <label>Origem<select name="source" defaultValue="referral">{Object.entries(SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Pretensão salarial (Kz)<input name="expectedSalary" inputMode="decimal" /></label>
      <label className="span2">Ligação para o CV<input name="cvUrl" type="url" placeholder="https://…" /></label>
      <label className="wide">Nota<input name="note" placeholder="Ex.: indicado pelo Edson; experiência em armazém" /></label>
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>Adicionar</button></div>
    </form>
  );
}

const ORDER: Stage[] = ['applied', 'screening', 'interview', 'assessment', 'offer'];

export function StageActions({ id, stage, canHire }: { id: string; stage: Stage; canHire: boolean }) {
  const { busy, error, run } = useMutation();
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const i = ORDER.indexOf(stage);
  const go = (s: Stage, r?: string) => run(`/v1/candidates/${id}/stage`, 'POST', { stage: s, reason: r ?? null });
  return (
    <div className="card" style={{ padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        {i > 0 && <button className="btn ghost sm" disabled={busy} onClick={() => go(ORDER[i - 1]!)}>← {STAGE_LABEL[ORDER[i - 1]!]}</button>}
        {i >= 0 && i < ORDER.length - 1 && <button className="btn sm" disabled={busy} onClick={() => go(ORDER[i + 1]!)}>Avançar para {STAGE_LABEL[ORDER[i + 1]!]} →</button>}
        {canHire && <a className="btn sm" href={`/colaboradores/novo?candidato=${id}`}>Admitir…</a>}
        {i >= 0 && <button className="btn danger" onClick={() => setReject(true)}>Recusar…</button>}
        {i >= 0 && <button className="btn ghost sm" disabled={busy} onClick={() => go('withdrawn', 'Desistência do candidato')}>Desistiu</button>}
        {(stage === 'rejected' || stage === 'withdrawn') && <button className="btn ghost sm" disabled={busy} onClick={() => go('screening')}>Reabrir candidatura</button>}
      </div>
      {reject && (
        <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); if (await go('rejected', reason)) setReject(false); }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (fica no histórico interno)" required style={{ width: 360 }} />
          <button className="btn danger" disabled={busy}>Confirmar recusa</button>
        </form>
      )}
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}

export function Rating({ id, value }: { id: string; value: number | null }) {
  const { run } = useMutation();
  return (
    <span style={{ fontSize: 20, letterSpacing: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => <button key={n} title={`${n}/5`} onClick={() => run(`/v1/candidates/${id}`, 'PATCH', { rating: n })} style={{ border: 0, background: 'none', cursor: 'pointer', color: value && n <= value ? '#d69e2e' : '#cbd5e0', fontSize: 20, padding: 0 }}>★</button>)}
    </span>
  );
}

export function EventForm({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  const [kind, setKind] = useState<'comment' | 'interview'>('comment');
  return (
    <form className="form" style={{ gridTemplateColumns: '160px 1fr 200px auto' }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const at = String(f.get('at') || '');
      if (await run(`/v1/candidates/${id}/events`, 'POST', { kind, text: f.get('text'), scheduledAt: kind === 'interview' && at ? `${at}:00+01:00` : null })) (e.target as HTMLFormElement).reset();
    }}>
      <select value={kind} onChange={(e) => setKind(e.target.value as 'comment')}><option value="comment">Comentário</option><option value="interview">Entrevista</option></select>
      <input name="text" required placeholder={kind === 'interview' ? 'Ex.: entrevista técnica com o Edson' : 'Impressões, referências, próximos passos…'} />
      {kind === 'interview' ? <input name="at" type="datetime-local" required /> : <span />}
      <button className="btn" disabled={busy}>Registar</button>
      {error && <span className="err wide">{error}</span>}
    </form>
  );
}
