'use client';
import { useRef, useState } from 'react';
import { type atsCompatibility, type CandidateProfile } from '@kianda/core';
import { useMutation } from '@/lib/client';

export function AtsPanel({ id, profile, ats, cvText, cvTextSource, editable }: { id: string; profile: CandidateProfile; ats: ReturnType<typeof atsCompatibility>; cvText: string | null; cvTextSource: string | null; editable: boolean }) {
  const { busy, error, run } = useMutation();
  const [text, setText] = useState(cvText ?? ''), [source, setSource] = useState(cvTextSource ?? ''), [reading, setReading] = useState(false), [readError, setReadError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const list = (value: FormDataEntryValue | null) => [...new Set(String(value ?? '').split(/[,;\n]/).map(v => v.trim()).filter(Boolean))];
  return <section className="card section" aria-label="ATS da candidatura" style={{ margin: '16px 0', minWidth: 0 }}>
    <h2>ATS — compatibilidade com a vaga</h2><div style={{ padding: '0 16px 16px', minWidth: 0 }}>
    <p className="muted">Correspondência documental dos requisitos configurados pelo RH. Os dados são declarados pelo candidato ou extraídos do CV e precisam de confirmação. O ATS não decide a contratação.</p>
    {ats.configured ? <><p><b>{ats.foundWeight}% do peso com evidência encontrada</b> · {ats.unknownWeight}% por confirmar.</p>
      <details className="map-disclosure"><summary>Ver critérios e evidências</summary><div style={{ overflowX: 'auto' }}><table className="dense"><thead><tr><th>Requisito</th><th>Peso</th><th>Correspondência</th><th>Evidência</th></tr></thead><tbody>{ats.rows.map((r, i) => <tr key={i}><td>{r.label}{r.required ? ' · obrigatório' : ''}</td><td>{r.weight}%</td><td>{r.status === 'found' ? 'Encontrada — validar' : r.status === 'below' ? 'Abaixo do mínimo declarado' : 'Informação em falta'}</td><td>{r.evidence ?? 'Solicitar esclarecimento ao candidato.'}<div className="muted">{r.source}</div></td></tr>)}</tbody></table></div></details></> : <p className="warn">Configure os requisitos e pesos ATS em Editar vaga para comparar este perfil.</p>}
    {editable && <details style={{ marginTop: 12 }}><summary>Rever perfil profissional e analisar CV</summary>
      <form className="form" style={{ padding: '12px 0 0' }} onSubmit={async e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        await run(`/v1/candidates/${id}/profile`, 'PATCH', { profile: { currentRole: f.get('currentRole') || null, yearsExperience: f.get('yearsExperience') ? Number(f.get('yearsExperience')) : null, highestEducation: f.get('highestEducation') || null, fieldOfStudy: f.get('fieldOfStudy') || null, skills: list(f.get('skills')), languages: list(f.get('languages')), certifications: list(f.get('certifications')) }, cvText: text.trim() || null, cvTextSource: text.trim() ? source : null });
      }}>
        <label>Função actual<input name="currentRole" maxLength={120} defaultValue={profile.currentRole ?? ''} /></label>
        <label>Anos de experiência<input name="yearsExperience" type="number" min={0} max={80} defaultValue={profile.yearsExperience ?? ''} /></label>
        <label>Nível de formação<input name="highestEducation" maxLength={120} defaultValue={profile.highestEducation ?? ''} /></label>
        <label>Área de formação<input name="fieldOfStudy" maxLength={160} defaultValue={profile.fieldOfStudy ?? ''} /></label>
        <label className="wide">Competências (separadas por vírgula)<input name="skills" defaultValue={profile.skills?.join(', ')} /></label>
        <label className="span2">Idiomas<input name="languages" defaultValue={profile.languages?.join(', ')} /></label>
        <label className="span2">Certificações<input name="certifications" defaultValue={profile.certifications?.join(', ')} /></label>
        <label className="wide">Ler CV para análise (PDF ou Word)<input ref={file} type="file" accept=".pdf,.docx" disabled={busy || reading} onChange={async e => {
          const chosen = e.target.files?.[0]; if (!chosen) return;
          setReading(true); setReadError('');
          try { const { readTemplateDocument } = await import('@/lib/document-import'); const extracted = await readTemplateDocument(chosen); setText(extracted); setSource(chosen.name); }
          catch (err) { setReadError((err as Error).message); if (file.current) file.current.value = ''; }
          finally { setReading(false); }
        }} /></label>
        <p className="muted wide">A leitura é local, sem enviar o CV a serviços de IA. Um PDF digitalizado precisa de OCR ou de dados profissionais preenchidos manualmente. O original fica em CV e documentos; aqui guarda-se apenas o texto revisto para análise.</p>
        {text && <><label className="wide">Texto para análise<textarea aria-label="Texto do CV para ATS" rows={5} value={text} maxLength={30000} onChange={e => setText(e.target.value)} /></label><p className="muted wide">Origem: {source}</p><button type="button" className="btn ghost" disabled={busy || reading} onClick={async () => { if (await run(`/v1/candidates/${id}/profile`, 'PATCH', { cvText: null })) { setText(''); setSource(''); if (file.current) file.current.value = ''; } }}>Remover texto de análise</button></>}
        {(error || readError) && <p className="err wide" role="alert">{error || readError}</p>}
        <div className="form-actions wide"><button className="btn" disabled={busy || reading}>{reading ? 'A ler CV…' : 'Guardar perfil e actualizar ATS'}</button></div>
      </form>
    </details>}
    </div>
  </section>;
}
