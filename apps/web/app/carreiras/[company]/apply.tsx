'use client';

import { useState } from 'react';

export function ApplyForm({ company, openingId }: { company: string; openingId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (msg?.ok) return <div className="warn" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>{msg.text}</div>;
  return (
    <form className="form" style={{ padding: 0, marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true); setMsg(null);
      const res = await fetch(`/api/v1/public/careers/${company}/openings/${openingId}/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: f.get('name'), email: f.get('email'), phone: f.get('phone'), cvUrl: f.get('cvUrl') || null, coverLetter: f.get('coverLetter') || null, consent: f.get('consent') === 'on', website: f.get('website') || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      setBusy(false);
      setMsg(res.ok ? { ok: true, text: j.message } : { ok: false, text: j.issues?.map((i: { message: string }) => i.message).join(' · ') || j.message || 'Não foi possível enviar' });
    }}>
      <label className="span2">Nome completo<input name="name" required /></label>
      <label>Email<input name="email" type="email" required /></label>
      <label>Telefone<input name="phone" required /></label>
      <label className="wide">Ligação para o CV (Google Drive, OneDrive, LinkedIn…)<input name="cvUrl" type="url" placeholder="https://" /></label>
      <label className="wide">Apresentação (opcional)<textarea name="coverLetter" rows={4} /></label>
      <input name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
      <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}><input type="checkbox" name="consent" required /> Autorizo o tratamento dos meus dados para este processo de recrutamento.</label>
      <div className="form-actions wide">{msg && <span className="err">{msg.text}</span>}<button className="btn" disabled={busy}>Enviar candidatura</button></div>
    </form>
  );
}
