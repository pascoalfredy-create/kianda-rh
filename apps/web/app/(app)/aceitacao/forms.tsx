'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACK_CATEGORIES, ACK_CATEGORY_LABELS, type AckCategory } from '@kianda/core';
import { send, useMutation } from '@/lib/client';
import type { AckDocDetail } from './types';

type People = { id: string; name: string; number: string; departmentId?: string | null }[];

/** Novo documento: começa como rascunho (texto e/ou PDF), com destinatários e prazo. */
export function NewAckDocument() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Novo documento</button>;
  return (
    <div className="card section" style={{ width: '100%' }}>
      <h2>Novo documento para aceitação</h2>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true); setError('');
        const r = await send<{ id: string }>('/v1/ack-documents', 'POST', { title: f.get('title'), category: f.get('category'), body: '', audience: { all: true, departmentIds: [], employeeIds: [] } });
        setBusy(false);
        if (!r.ok) return setError(r.message ?? 'Erro');
        router.push(`/aceitacao/${r.data!.id}`);
      }}>
        <label className="span2">Título<input name="title" required minLength={3} maxLength={160} placeholder="Ex.: Regulamento interno" /></label>
        <label>Tipo<select name="category" defaultValue="regulamento">{ACK_CATEGORIES.map(c => <option key={c} value={c}>{ACK_CATEGORY_LABELS[c]}</option>)}</select></label>
        <p className="muted wide">O documento fica em rascunho: escreva o texto ou anexe o PDF, escolha os destinatários e publique.</p>
        <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>Criar rascunho</button></div>
      </form>
    </div>
  );
}

/** Rascunho: texto, tipo, destinatários e prazo (o PDF anexa-se ao lado). */
export function DraftEditor({ doc, people }: { doc: AckDocDetail; people: People }) {
  const { busy, error, run } = useMutation();
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState<AckCategory>(doc.category);
  const [body, setBody] = useState(doc.body);
  const [dueDate, setDueDate] = useState(doc.dueDate ?? '');
  const [mode, setMode] = useState<'all' | 'some'>(doc.audience.all ? 'all' : 'some');
  const [departmentIds, setDepartmentIds] = useState<string[]>(doc.audience.departmentIds);
  const [employeeIds, setEmployeeIds] = useState<string[]>(doc.audience.employeeIds);
  const [saved, setSaved] = useState(false);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => { set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]); setSaved(false); };
  const payload = () => ({ title, category, body, dueDate: dueDate || null, audience: { all: mode === 'all', departmentIds: mode === 'all' ? [] : departmentIds, employeeIds: mode === 'all' ? [] : employeeIds } });
  return (
    <div className="card section">
      <h2>Rascunho · versão {doc.version}</h2>
      <div className="form">
        <label className="span2">Título<input value={title} onChange={e => { setTitle(e.target.value); setSaved(false); }} maxLength={160} /></label>
        <label>Tipo<select value={category} onChange={e => { setCategory(e.target.value as AckCategory); setSaved(false); }}>{ACK_CATEGORIES.map(c => <option key={c} value={c}>{ACK_CATEGORY_LABELS[c]}</option>)}</select></label>
        <label>Aceitar até (opcional)<input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); setSaved(false); }} /></label>
        <label className="wide">Texto do documento<textarea value={body} onChange={e => { setBody(e.target.value); setSaved(false); }} rows={12} maxLength={60000} placeholder="Escreva aqui o texto, ou deixe em branco e anexe o PDF." /></label>
        <fieldset className="wide" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Destinatários</legend>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="radio" name="mode" checked={mode === 'all'} onChange={() => { setMode('all'); setSaved(false); }} style={{ width: 'auto' }} />Todos os colaboradores activos (e os admitidos depois)</label>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}><input type="radio" name="mode" checked={mode === 'some'} onChange={() => { setMode('some'); setSaved(false); }} style={{ width: 'auto' }} />Departamentos ou colaboradores escolhidos</label>
          {mode === 'some' && <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 8 }}>
            <div><b style={{ fontSize: 13 }}>Departamentos</b>{doc.departments.length ? doc.departments.map(d => <label key={d.id} style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={departmentIds.includes(d.id)} onChange={() => toggle(departmentIds, setDepartmentIds, d.id)} style={{ width: 'auto' }} />{d.name}</label>) : <p className="muted">Sem departamentos.</p>}</div>
            <div><b style={{ fontSize: 13 }}>Colaboradores</b><div style={{ maxHeight: 220, overflowY: 'auto' }}>{people.map(p => <label key={p.id} style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={employeeIds.includes(p.id)} onChange={() => toggle(employeeIds, setEmployeeIds, p.id)} style={{ width: 'auto' }} />{p.number} · {p.name}</label>)}</div></div>
          </div>}
        </fieldset>
        <div className="form-actions wide">{error && <span className="err">{error}</span>}{saved && <span className="muted">Rascunho gravado.</span>}
          <button type="button" className="btn ghost" disabled={busy} onClick={async () => { if (await run(`/v1/ack-documents/${doc.id}`, 'PATCH', payload())) setSaved(true); }}>Gravar rascunho</button>
          <button type="button" className="btn" disabled={busy} onClick={async () => {
            if (!window.confirm('Publicar? Depois de publicado, o texto e os anexos ficam congelados e os destinatários recebem o pedido de aceitação.')) return;
            if (await run(`/v1/ack-documents/${doc.id}`, 'PATCH', payload())) await run(`/v1/ack-documents/${doc.id}/publish`, 'POST');
          }}>Publicar para aceitação</button>
        </div>
      </div>
    </div>
  );
}

export function DocumentActions({ doc, people }: { doc: AckDocDetail; people: People }) {
  const router = useRouter();
  const { busy, error, run } = useMutation();
  const [adding, setAdding] = useState(false);
  const missing = people.filter(p => !doc.recipients.some(r => r.employeeId === p.id));
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
      {doc.status === 'draft' && <button className="btn ghost sm" disabled={busy} onClick={async () => { if (window.confirm('Eliminar este rascunho e os anexos?') && await run(`/v1/ack-documents/${doc.id}`, 'DELETE')) router.push('/aceitacao'); }}>Eliminar rascunho</button>}
      {doc.status === 'published' && <>
        <button className="btn sm" disabled={busy} onClick={() => run<{ id: string }>(`/v1/ack-documents/${doc.id}/new-version`, 'POST', undefined, d => d && router.push(`/aceitacao/${d.id}`))}>Criar nova versão</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => setAdding(!adding)}>Acrescentar destinatários</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => { if (window.confirm('Arquivar? Os pedidos ainda por aceitar são anulados; as aceitações ficam no registo.')) void run(`/v1/ack-documents/${doc.id}/archive`, 'POST'); }}>Arquivar</button>
      </>}
      {error && <span className="err">{error}</span>}
      {adding && <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }} onSubmit={async (e) => {
        e.preventDefault();
        const ids = [...new FormData(e.currentTarget).getAll('employeeId')].map(String);
        if (ids.length && await run(`/v1/ack-documents/${doc.id}/recipients`, 'POST', { employeeIds: ids })) setAdding(false);
      }}>
        <select name="employeeId" multiple aria-label="Colaboradores a acrescentar" style={{ minWidth: 280, minHeight: 120 }}>{missing.map(p => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select>
        <button className="btn sm">Acrescentar</button>
      </form>}
    </div>
  );
}

/** O colaborador confirma que leu e aceita o conteúdo exacto que tem no ecrã. */
export function AcceptForm({ requestId, contentSha256 }: { requestId: string; contentSha256: string }) {
  const { busy, error, run } = useMutation();
  const [checked, setChecked] = useState(false);
  return (
    <div className="card section" style={{ borderColor: 'var(--brand)' }}>
      <h2>Tomada de conhecimento e aceitação</h2>
      <div style={{ padding: '4px 16px 16px', display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
          <span>Declaro que li o documento acima, incluindo os anexos, que tomei conhecimento do seu conteúdo e que o aceito.</span></label>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Ficam registados a data e a hora, o seu utilizador, o endereço de rede, o navegador e o conteúdo exacto aceite.</p>
        <div>{error && <span className="err">{error} </span>}<button className="btn" disabled={busy || !checked} onClick={() => run(`/v1/acknowledgements/${requestId}/accept`, 'POST', { confirm: true, contentSha256 })}>Aceitar</button></div>
      </div>
    </div>
  );
}
