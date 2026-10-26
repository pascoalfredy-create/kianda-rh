'use client';

import Link from 'next/link';
import { useState } from 'react';
import { send, useMutation } from '@/lib/client';

interface Tpl { key: string; title: string; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[] }

export function RequestDeclaration({ templates, autoIssue }: { templates: Tpl[]; autoIssue: boolean }) {
  const [key, setKey] = useState(templates[0]?.key ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; documentId?: string } | null>(null);
  const tpl = templates.find((t) => t.key === key);
  return (
    <form className="form" style={{ gridTemplateColumns: '1fr' }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setResult(null);
      const r = await send<{ status: string; documentId?: string; documentNumber?: string; missingInProfile?: string[] }>('/v1/document-requests', 'POST', { templateKey: key, inputs });
      setBusy(false);
      if (!r.ok) return setResult({ ok: false, text: r.message ?? 'Erro' });
      setInputs({});
      if (r.data!.status === 'issued') setResult({ ok: true, text: `Declaração ${r.data!.documentNumber} emitida.`, documentId: r.data!.documentId });
      else setResult({ ok: true, text: `Pedido enviado ao RH.${r.data!.missingInProfile?.length ? ` Atenção: faltam dados na sua ficha (${r.data!.missingInProfile.join(', ')}).` : ''}` });
    }}>
      <label>Declaração
        <select value={key} onChange={(e) => { setKey(e.target.value); setInputs({}); }}>{templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}</select>
      </label>
      {tpl && <p className="muted" style={{ margin: 0 }}>{tpl.description}</p>}
      {tpl?.inputs.map((i) => <label key={i.key}>{i.label}<input value={inputs[i.key] ?? ''} placeholder={i.placeholder} required={i.required} onChange={(e) => setInputs({ ...inputs, [i.key]: e.target.value })} /></label>)}
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" disabled={busy || !key}>{autoIssue ? 'Emitir declaração' : 'Pedir ao RH'}</button>
        {result && <span style={{ color: result.ok ? 'var(--brand)' : 'var(--red)' }}>{result.text} {result.documentId && <Link href={`/documentos/${result.documentId}`}>Abrir →</Link>}</span>}
      </div>
    </form>
  );
}

const FIELDS: [string, string, string?][] = [
  ['phone', 'Telefone'], ['email', 'Email pessoal', 'email'], ['address', 'Morada'], ['maritalStatus', 'Estado civil'],
  ['emergencyContactName', 'Contacto de emergência'], ['emergencyContactPhone', 'Telefone de emergência'], ['iban', 'IBAN (conta para o salário)'], ['bank', 'Banco'],
];

export function ProfileRequestForm({ current }: { current: Record<string, string | null> }) {
  const { busy, error, run } = useMutation();
  const [ok, setOk] = useState('');
  return (
    <form className="card form" onSubmit={async (e) => {
      e.preventDefault();
      setOk('');
      const f = new FormData(e.currentTarget);
      const changes: Record<string, string | null> = {};
      for (const [k] of FIELDS) { const v = String(f.get(k) ?? '').trim(); if (v !== (current[k] ?? '')) changes[k] = v || null; }
      if (await run('/v1/profile-requests', 'POST', { changes, note: f.get('note') || null })) setOk('Pedido enviado ao RH. A ficha muda quando for aprovado.');
    }}>
      {FIELDS.map(([k, label, type]) => <label key={k} className={k === 'address' || k === 'iban' ? 'span2' : undefined}>{label}<input name={k} type={type ?? 'text'} defaultValue={current[k] ?? ''} /></label>)}
      <label className="wide">Nota para o RH (opcional)<input name="note" placeholder="Ex.: mudei de banco em Outubro" /></label>
      <p className="muted wide">Por segurança, nenhuma alteração (em especial o IBAN) é aplicada sem aprovação do RH. O IBAN é validado antes de enviar.</p>
      <div className="form-actions wide">{error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}<button className="btn" disabled={busy}>Pedir alteração</button></div>
    </form>
  );
}

export function CancelRequest({ id }: { id: string }) {
  const { busy, run } = useMutation();
  return <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/profile-requests/${id}/cancel`, 'POST', {})}>Retirar</button>;
}

export function DecisionButtons({ approvePath, rejectPath, approveLabel }: { approvePath: string; rejectPath: string; approveLabel: string }) {
  const { busy, error, run } = useMutation();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  return (
    <span className="actions">
      {!rejecting && <button className="btn sm" disabled={busy} onClick={() => run(approvePath, 'POST', {})}>{approveLabel}</button>}
      {!rejecting && <button className="btn ghost sm" onClick={() => setRejecting(true)}>Recusar…</button>}
      {rejecting && (
        <form className="actions" onSubmit={async (e) => { e.preventDefault(); await run(rejectPath, 'POST', { note }); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo" required style={{ width: 220 }} />
          <button className="btn danger" disabled={busy}>Recusar</button>
        </form>
      )}
      {error && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}
