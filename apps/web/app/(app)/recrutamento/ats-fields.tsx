'use client';
import { useState } from 'react';
import { atsCriteriaProblems, type AtsCriterion } from '@kianda/core';

export function AtsFields({ initial = [] }: { initial?: AtsCriterion[] }) {
  const [criteria, setCriteria] = useState(initial);
  const change = (index: number, patch: Partial<AtsCriterion>) => setCriteria(criteria.map((c, i) => i === index ? { ...c, ...patch } : c));
  return <details className="wide" style={{ minWidth: 0 }}><summary>ATS — requisitos e pesos profissionais ({criteria.length})</summary>
    <input type="hidden" name="atsCriteria" value={JSON.stringify(criteria)} />
    <p className="muted">Configure critérios objectivos da vaga. Os pesos devem somar 100%. A análise apresenta evidência documental e informação em falta; a decisão é da equipa de recrutamento.</p>
    {criteria.map((c, i) => <fieldset key={i} className="form" style={{ padding: 10, margin: '10px 0', minWidth: 0 }}>
      <label>Tipo de critério<select aria-label={`Tipo do critério ${i + 1}`} value={c.kind} onChange={e => change(i, { kind: e.target.value as AtsCriterion['kind'], ...(e.target.value === 'experience' ? { minimumYears: 1 } : {}) })}>
        <option value="skill">Competência</option><option value="experience">Experiência</option><option value="education">Formação</option><option value="language">Idioma</option><option value="certification">Certificação</option>
      </select></label>
      <label>Requisito profissional<input aria-label={`Requisito ${i + 1}`} value={c.label} maxLength={160} onChange={e => change(i, { label: e.target.value })} placeholder={c.kind === 'experience' ? 'Experiência na função' : 'Ex.: Excel, Contabilidade, Inglês…'} /></label>
      <label>Peso (%)<input aria-label={`Peso do critério ${i + 1}`} type="number" min={1} max={100} value={c.weight} onChange={e => change(i, { weight: Number(e.target.value) })} /></label>
      {c.kind === 'experience' && <label>Anos mínimos<input type="number" min={0} max={80} value={c.minimumYears ?? 0} onChange={e => change(i, { minimumYears: Number(e.target.value) })} /></label>}
      <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={c.required} onChange={e => change(i, { required: e.target.checked })} /> Obrigatório — confirmar na avaliação</label>
      <button type="button" className="btn ghost sm" onClick={() => setCriteria(criteria.filter((_, n) => i !== n))}>Remover critério {i + 1}</button>
    </fieldset>)}
    {criteria.length < 12 && <button type="button" className="btn ghost sm" onClick={() => setCriteria([...criteria, { kind: 'skill', label: '', weight: criteria.length ? 10 : 100, required: false }])}>Adicionar critério ATS</button>}
    {atsCriteriaProblems(criteria).map(p => <p key={p} className="err">{p}</p>)}
  </details>;
}
