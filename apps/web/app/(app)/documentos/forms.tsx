'use client';

import { DOCUMENT_CATEGORY, documentBlocks, type DocumentCategory } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { send, useMutation } from '@/lib/client';

interface Tpl { key: string; title: string; category: DocumentCategory; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[]; source: string; version: string; body: string }

function Preview({ text }: { text: string }) {
  return (
    <div style={{ padding: '20px 26px', fontSize: 13.5 }}>
      {documentBlocks(text).map((b, i) => b.type === 'title' ? <h3 key={i} style={{ textAlign: 'center', textTransform: 'uppercase' }}>{b.text}</h3>
        : b.type === 'signatures' ? <div key={i} className="muted" style={{ marginTop: 20 }}>Assinaturas: {b.labels.filter(Boolean).join(' · ')}</div>
          : <p key={i} style={{ lineHeight: 1.6 }}>{b.spans.map((s, j) => s.bold ? <b key={j}>{s.text}</b> : <span key={j} style={/\[[\w.]+\]/.test(s.text) ? undefined : undefined}>{s.text}</span>)}</p>)}
    </div>
  );
}

export function IssueForm({ templates, employees, initialEmployee, initialTemplate }: { initialTemplate?: string; templates: Tpl[]; employees: { id: string; name: string; number: string }[]; initialEmployee?: string }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(initialEmployee ?? '');
  const [key, setKey] = useState(templates.find(t => t.key === initialTemplate)?.key ?? templates[0]?.key ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pv, setPv] = useState<{ text: string; missingLabels: string[]; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tpl = templates.find((t) => t.key === key);
  useEffect(() => {
    if (!employeeId || !key) { setPv(null); return; }
    const t = setTimeout(async () => {
      const r = await send<{ text: string; missingLabels: string[]; version: string }>('/v1/documents/preview', 'POST', { employeeId, templateKey: key, inputs });
      if (r.ok) { setPv(r.data!); setError(''); } else setError(r.message ?? 'Erro');
    }, 250);
    return () => clearTimeout(t);
  }, [employeeId, key, inputs]);
  async function issue() {
    setBusy(true); setError('');
    const r = await send<{ id: string }>('/v1/documents', 'POST', { employeeId, templateKey: key, inputs });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'Erro');
    router.push(`/documentos/${r.data!.id}`);
  }
  const groups = [...new Set(templates.map((t) => t.category))];
  return (
    <div className="two" style={{ alignItems: 'start' }}>
      <div className="card form" style={{ gridTemplateColumns: '1fr' }}>
        <label>Colaborador
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— escolha —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.number} · {e.name}</option>)}
          </select>
        </label>
        <label>Documento
          <select value={key} onChange={(e) => { setKey(e.target.value); setInputs({}); }}>
            {groups.map((g) => <optgroup key={g} label={DOCUMENT_CATEGORY[g]}>{templates.filter((t) => t.category === g).map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}</optgroup>)}
          </select>
        </label>
        {tpl && <p className="muted">{tpl.description} <span className="tag">{tpl.source === 'empresa' ? tpl.version : `Kianda ${tpl.version}`}</span></p>}
        {tpl?.inputs.map((i) => (
          <label key={i.key}>{i.label}{i.required ? ' *' : ''}
            <input value={inputs[i.key] ?? ''} placeholder={i.placeholder} onChange={(e) => setInputs({ ...inputs, [i.key]: e.target.value })} />
          </label>
        ))}
        {pv && pv.missingLabels.length > 0 && <div className="warn">Falta: {pv.missingLabels.join(', ')}. Complete a ficha do colaborador ou os campos acima.</div>}
        {error && <div className="alert">{error}</div>}
        <button className="btn" disabled={busy || !pv || pv.missingLabels.length > 0} onClick={issue}>Emitir documento</button>
      </div>
      <div className="card section">
        <h2>Pré-visualização</h2>
        {pv ? <Preview text={pv.text} /> : <div className="empty">Escolha o colaborador e o documento.</div>}
      </div>
    </div>
  );
}

export function TemplateEditor({ tpl, fields }: { tpl: Tpl; fields: { key: string; label: string }[] }) {
  const { busy, error, run } = useMutation();
  const [title, setTitle] = useState(tpl.title);
  const [bodyText, setBody] = useState(tpl.body);
  const [ok, setOk] = useState('');
  return (
    <div className="two" style={{ alignItems: 'start' }}>
      <div className="card form" style={{ gridTemplateColumns: '1fr' }}>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Texto do modelo
          <textarea value={bodyText} onChange={(e) => setBody(e.target.value)} rows={26} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5 }} />
        </label>
        <p className="muted">Campos entre chavetas duplas; <code>{'{{#se campo}}…{{/se}}'}</code> só mostra o texto se o campo tiver valor; <code># </code> no início = título; <code>**negrito**</code>; <code>--- assinaturas: A | B</code>. Campos <code>pedido.*</code> são pedidos na emissão.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" disabled={busy} onClick={async () => { setOk(''); if (await run(`/v1/document-templates/${tpl.key}`, 'PUT', { title, body: bodyText })) setOk('Nova versão gravada.'); }}>Gravar nova versão</button>
          {tpl.source === 'empresa' && <button className="btn ghost" disabled={busy} onClick={async () => { if (window.confirm('Voltar ao modelo do Kianda? As versões da empresa ficam no histórico.') && await run(`/v1/document-templates/${tpl.key}/reset`, 'POST', {})) window.location.reload(); }}>Voltar ao modelo do Kianda</button>}
          {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
          {ok && <span style={{ color: 'var(--brand)' }}>{ok}</span>}
        </div>
      </div>
      <div className="card section">
        <h2>Campos disponíveis</h2>
        <table className="dense"><tbody>{fields.map((f) => <tr key={f.key}><td><code style={{ fontSize: 12 }}>{`{{${f.key}}}`}</code></td><td className="muted">{f.label}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) return <button className="btn danger" onClick={() => setOpen(true)}>Anular…</button>;
  return (
    <form className="actions" onSubmit={async (e) => { e.preventDefault(); await run(`/v1/documents/${id}/revoke`, 'POST', { note }); }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo da anulação" required style={{ width: 260 }} />
      <button className="btn danger" disabled={busy}>Confirmar</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </form>
  );
}

export function PrintBtn() {
  return <button className="btn ghost" onClick={() => window.print()}>Imprimir</button>;
}
