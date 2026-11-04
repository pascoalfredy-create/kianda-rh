'use client';

import { parseAmount, WORD_MIME } from '@kianda/core';
import { useRef, useState } from 'react';
import { jsonRequest } from '@/lib/json-request';

export function ApplyForm({ company, openingId }: { company: string; openingId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; reference?: string } | null>(null);
  const [cv, setCv] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null), sending = useRef(false);
  if (msg?.ok) return <div role="status" className="warn" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><h3>Candidatura recebida</h3><p>{msg.text}</p>{msg.reference && <p>Referência: <b>{msg.reference}</b>. Guarde esta referência.</p>}</div>;
  return (
    <form className="form" style={{ padding: 0, marginTop: 10 }} onSubmit={async (e) => {
      e.preventDefault();
      if (sending.current) return;
      const f = new FormData(e.currentTarget);
      const salary = String(f.get('expectedSalary') || '').trim(), parsedSalary = salary ? parseAmount(salary) : null;
      if (salary && (parsedSalary === null || parsedSalary < 0)) return setMsg({ ok: false, text: 'Indique uma pretensão salarial válida.' });
      if (!cv && !String(f.get('cvUrl') || '').trim()) return setMsg({ ok: false, text: 'Anexe o CV ou indique uma ligação para o currículo.' });
      const data = new FormData();
      data.set('data', JSON.stringify({
        name: f.get('name'), email: String(f.get('email') || '').trim(), phone: f.get('phone'), cvUrl: f.get('cvUrl') || null, coverLetter: f.get('coverLetter') || null,
        expectedSalary: parsedSalary === null ? null : parsedSalary / 100, availableFrom: f.get('availableFrom') || null,
        profile: { currentRole: f.get('currentRole') || null, yearsExperience: f.get('yearsExperience') ? Number(f.get('yearsExperience')) : null, highestEducation: f.get('highestEducation') || null, fieldOfStudy: f.get('fieldOfStudy') || null, linkedinUrl: f.get('linkedinUrl') || null },
        consent: f.get('consent') === 'on', website: f.get('website') || undefined,
      }));
      if (cv) data.set('cv', cv, cv.name);
      sending.current = true;
      setBusy(true); setMsg(null);
      try {
        const { res, body: j } = await jsonRequest(`/api/v1/public/careers/${encodeURIComponent(company)}/openings/${encodeURIComponent(openingId)}/apply`, { method: 'POST', body: data });
        setMsg(res.ok ? { ok: true, text: j.message, reference: j.reference } : { ok: false, text: j.issues?.map((i: { message: string }) => i.message).join(' · ') || j.message || 'Não foi possível enviar' });
      } finally { setBusy(false); sending.current = false; }
    }}>
      <fieldset disabled={busy} className="wide" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
      <label className="span2">Nome completo<input name="name" required minLength={3} maxLength={120} autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label>Telefone<input name="phone" type="tel" required minLength={9} maxLength={30} autoComplete="tel" /></label>
      <div className="wide"><label>Currículo (CV)<input ref={input} name="cv" type="file" accept={`.pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,${WORD_MIME}`} onChange={e => {
        const file = e.currentTarget.files?.[0] ?? null;
        if (file && file.size > 5 * 1024 * 1024) { setMsg({ ok: false, text: 'O CV deve ter até 5 MB.' }); e.currentTarget.value = ''; setCv(null); return; }
        setCv(file); setMsg(null);
      }} /></label><small className="muted">PDF, Word (.docx) ou imagem · até 5 MB. Pode anexar um ficheiro ou usar uma ligação abaixo.</small>{cv && <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 6 }}><span>{cv.name}</span><button type="button" className="btn ghost sm" onClick={() => { setCv(null); if (input.current) input.current.value = ''; }}>Remover CV</button></div>}</div>
      <label className="wide">Ligação para o CV (em alternativa)<input name="cvUrl" type="url" maxLength={2000} placeholder="https://…" /></label>
      <label className="wide">Apresentação (opcional)<textarea name="coverLetter" rows={4} maxLength={3000} /></label>
      <details className="wide"><summary style={{ cursor: 'pointer' }}>Dados profissionais (opcional)</summary><div className="form" style={{ padding: '12px 0 0' }}>
        <label>Função actual<input name="currentRole" maxLength={120} /></label>
        <label>Anos de experiência<input name="yearsExperience" type="number" min={0} max={80} step={1} /></label>
        <label>Nível de formação<select name="highestEducation" defaultValue=""><option value="">—</option>{['Ensino secundário', 'Ensino técnico', 'Licenciatura', 'Pós-graduação', 'Mestrado', 'Doutoramento'].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Área de formação<input name="fieldOfStudy" maxLength={160} /></label>
        <label className="span2">Perfil profissional online<input name="linkedinUrl" type="url" maxLength={2000} placeholder="https://…" /></label>
        <label>Pretensão salarial (Kz)<input name="expectedSalary" inputMode="decimal" /></label>
        <label>Disponível a partir de<input name="availableFrom" type="date" /></label>
      </div></details>
      <input name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden />
      <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}><input type="checkbox" name="consent" required /> Autorizo o tratamento dos meus dados para este processo de recrutamento.</label>
      <p className="muted wide">A candidatura é enviada à empresa responsável pela vaga. Consulte os <a href="/termos" target="_blank" rel="noopener noreferrer">termos e privacidade</a>.</p>
      <div className="form-actions wide">{msg && <span className="err" role="alert">{msg.text}</span>}<button className="btn" disabled={busy}>{busy ? 'A enviar…' : 'Enviar candidatura'}</button></div>
      </fieldset>
    </form>
  );
}
