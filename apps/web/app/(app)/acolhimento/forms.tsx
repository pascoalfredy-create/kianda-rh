'use client';

import { useState } from 'react';
import { CHECKLIST_KIND_LABELS, CHECKLIST_LINK_LABELS, TASK_RESPONSIBLE_LABELS, TASK_RESPONSIBLES, luandaDate, type ChecklistKind, type TaskResponsible } from '@kianda/core';
import { useMutation } from '@/lib/client';
import type { TemplateData } from './types';

/** Iniciar uma lista manualmente (colaboradores admitidos antes desta funcionalidade, ou modelo sem criação automática). */
export function StartChecklistForm({ employees }: { employees: { id: string; name: string; number: string }[] }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <p style={{ marginTop: 12 }}><button className="btn ghost sm" onClick={() => setOpen(true)}>Iniciar uma lista manualmente</button></p>;
  return (
    <div className="card section">
      <h2>Iniciar uma lista</h2>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await run('/v1/checklists', 'POST', { employeeId: f.get('employeeId'), kind: f.get('kind'), referenceDate: f.get('referenceDate') })) setOpen(false);
      }}>
        <label>Colaborador<select name="employeeId" required defaultValue="">{[<option key="" value="" disabled>Escolha…</option>, ...employees.map(e => <option key={e.id} value={e.id}>{e.number} · {e.name}</option>)]}</select></label>
        <label>Tipo<select name="kind" defaultValue="onboarding">{(['onboarding', 'offboarding'] as const).map(k => <option key={k} value={k}>{CHECKLIST_KIND_LABELS[k]}</option>)}</select></label>
        <label>Data de referência<input name="referenceDate" type="date" required defaultValue={luandaDate(new Date())} /></label>
        <p className="muted wide">As tarefas e os prazos vêm do modelo da empresa (separador Modelos). A saída de um colaborador com cessação registada já tem a sua lista.</p>
        <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>Iniciar lista</button></div>
      </form>
    </div>
  );
}

type Item = TemplateData['items'][number];
/** Modelo da empresa: tarefas, responsável, prazo em dias e criação automática. */
export function TemplateEditor({ template }: { template: TemplateData }) {
  const { busy, error, run } = useMutation();
  const [name, setName] = useState(template.name);
  const [autoStart, setAutoStart] = useState(template.autoStart);
  const [items, setItems] = useState<Item[]>(template.items);
  const [saved, setSaved] = useState(false);
  const change = (i: number, patch: Partial<Item>) => { setSaved(false); setItems(items.map((it, j) => j === i ? { ...it, ...patch } : it)); };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= items.length) return; const next = [...items]; [next[i], next[j]] = [next[j]!, next[i]!]; setItems(next); setSaved(false); };
  const label = CHECKLIST_KIND_LABELS[template.kind as ChecklistKind];
  return (
    <div className="card section" aria-label={`Modelo de ${label.toLowerCase()}`}>
      <h2>Modelo · {label}</h2>
      <div className="form" style={{ alignItems: 'end' }}>
        <label className="span2">Nome do modelo<input value={name} onChange={e => { setName(e.target.value); setSaved(false); }} maxLength={120} /></label>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'center' }}><input type="checkbox" checked={autoStart} onChange={e => { setAutoStart(e.target.checked); setSaved(false); }} style={{ width: 'auto' }} />{template.kind === 'onboarding' ? 'Criar automaticamente na admissão' : 'Criar automaticamente ao registar a cessação'}</label>
      </div>
      <div className="table-scroll">
        <table className="dense">
          <thead><tr><th style={{ width: '50%' }}>Tarefa</th><th>Responsável</th><th>Prazo (dias)</th><th aria-label="Acções" /></tr></thead>
          <tbody>{items.map((it, i) => <tr key={i}>
            <td><input aria-label={`Tarefa ${i + 1}`} value={it.title} onChange={e => change(i, { title: e.target.value })} maxLength={200} style={{ width: '100%' }} />{it.link && <div className="muted" style={{ fontSize: 12 }}>{CHECKLIST_LINK_LABELS[it.link]}</div>}</td>
            <td><select aria-label={`Responsável da tarefa ${i + 1}`} value={it.responsible} onChange={e => change(i, { responsible: e.target.value as TaskResponsible })}>{TASK_RESPONSIBLES.map(r => <option key={r} value={r}>{TASK_RESPONSIBLE_LABELS[r]}</option>)}</select></td>
            <td><input aria-label={`Prazo da tarefa ${i + 1}`} type="number" min={-365} max={365} step={1} value={it.offsetDays} onChange={e => change(i, { offsetDays: Math.trunc(Number(e.target.value) || 0) })} style={{ width: 84 }} /></td>
            <td className="num" style={{ whiteSpace: 'nowrap' }}>
              <button type="button" className="btn ghost sm" aria-label="Subir" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="btn ghost sm" aria-label="Descer" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
              <button type="button" className="btn ghost sm" aria-label={`Retirar a tarefa ${i + 1}`} onClick={() => { setItems(items.filter((_, j) => j !== i)); setSaved(false); }}>✕</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="form-actions" style={{ padding: '12px 16px', justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => { setItems([...items, { title: '', responsible: 'hr', offsetDays: 0 }]); setSaved(false); }}>Acrescentar tarefa</button>
        <span>{error && <span className="err">{error}</span>}{saved && <span className="muted">Modelo gravado.</span>} <button className="btn" disabled={busy} onClick={async () => { if (await run(`/v1/checklist-templates/${template.kind}`, 'PUT', { name, autoStart, items })) setSaved(true); }}>Gravar modelo</button></span>
      </div>
    </div>
  );
}

/** Marcar/desmarcar uma tarefa, com nota opcional. */
export function TaskToggle({ checklistId, taskId, done, note, disabled }: { checklistId: string; taskId: string; done: boolean; note: string | null; disabled: boolean }) {
  const { busy, error, run } = useMutation();
  const [text, setText] = useState(note ?? '');
  const [editing, setEditing] = useState(false);
  const path = `/v1/checklists/${checklistId}/tasks/${taskId}`;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {editing && <input aria-label="Nota da tarefa" value={text} onChange={e => setText(e.target.value)} maxLength={500} placeholder="Nota (opcional)" style={{ minWidth: 180 }} />}
      {!disabled && !done && !editing && <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Nota</button>}
      {!disabled && <button type="button" className={`btn sm ${done ? 'ghost' : ''}`} disabled={busy} onClick={async () => { if (await run(path, 'PATCH', { done: !done, ...(editing ? { note: text.trim() || null } : {}) })) setEditing(false); }}>{done ? 'Desmarcar' : 'Marcar como feita'}</button>}
      {error && <span className="err">{error}</span>}
    </span>
  );
}

export function AddTaskForm({ checklistId }: { checklistId: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Acrescentar tarefa a esta lista</button>;
  return (
    <form className="form" style={{ padding: '8px 16px 16px' }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      if (await run(`/v1/checklists/${checklistId}/tasks`, 'POST', { title: f.get('title'), responsible: f.get('responsible'), dueDate: f.get('dueDate') })) setOpen(false);
    }}>
      <label className="span2">Tarefa<input name="title" required maxLength={200} /></label>
      <label>Responsável<select name="responsible" defaultValue="hr">{TASK_RESPONSIBLES.map(r => <option key={r} value={r}>{TASK_RESPONSIBLE_LABELS[r]}</option>)}</select></label>
      <label>Prazo<input name="dueDate" type="date" required defaultValue={luandaDate(new Date())} /></label>
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>Acrescentar</button></div>
    </form>
  );
}

export function DeleteTask({ checklistId, taskId }: { checklistId: string; taskId: string }) {
  const { busy, error, run } = useMutation();
  return <>{error && <span className="err">{error}</span>}<button type="button" className="btn ghost sm" aria-label="Retirar tarefa" disabled={busy} onClick={() => { if (window.confirm('Retirar esta tarefa da lista?')) void run(`/v1/checklists/${checklistId}/tasks/${taskId}`, 'DELETE'); }}>✕</button></>;
}

export function CancelChecklist({ checklistId }: { checklistId: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Anular lista</button>;
  return (
    <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await run(`/v1/checklists/${checklistId}/cancel`, 'POST', { reason: f.get('reason') }); }}>
      <input name="reason" aria-label="Motivo da anulação" placeholder="Motivo" required minLength={3} maxLength={300} />
      <button className="btn sm" disabled={busy}>Confirmar anulação</button><button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Voltar</button>
      {error && <span className="err">{error}</span>}
    </form>
  );
}
