'use client';
import { DocumentPrintButton } from '@/components/document-export';


import { DOCUMENT_CATEGORY, documentBlocks, renderTemplate, type DocumentCategory } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { send, useMutation } from '@/lib/client';
import { readTemplateDocument } from '@/lib/document-import';
import { useClearWorkspace, useWorkspaceState } from '@/components/workspace-state';

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
  const draftKey = `document:issue:${initialEmployee ?? ''}:${initialTemplate ?? ''}:`;
  const clearDraft = useClearWorkspace(draftKey);
  const [employeeId, setEmployeeId] = useWorkspaceState(`${draftKey}employee`, initialEmployee ?? '');
  const [key, setKey] = useWorkspaceState(`${draftKey}template`, templates.find(t => t.key === initialTemplate)?.key ?? templates[0]?.key ?? '');
  const [inputs, setInputs] = useWorkspaceState<Record<string, string>>(`${draftKey}inputs`, {});
  const [pv, setPv] = useState<{ text: string; missingLabels: string[]; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tpl = templates.find((t) => t.key === key);
  useEffect(() => {
    if (!employeeId || !key) { setPv(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await send<{ text: string; missingLabels: string[]; version: string }>('/v1/documents/preview', 'POST', { employeeId, templateKey: key, inputs });
      if (cancelled) return;
      if (r.ok) { setPv(r.data!); setError(''); } else setError(r.message ?? 'Erro');
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [employeeId, key, inputs]);
  async function issue() {
    setBusy(true); setError('');
    const r = await send<{ id: string }>('/v1/documents', 'POST', { employeeId, templateKey: key, inputs });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'Erro');
    clearDraft(); router.push(`/documentos/${r.data!.id}`);
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
        {tpl && <p className="muted">{tpl.description} <span className="tag">{tpl.source === 'empresa' ? tpl.version : 'Kianda'}</span></p>}
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
  const draftKey = `document:template:${tpl.key}:${tpl.version}:`;
  const clearDraft = useClearWorkspace(draftKey);
  const [title, setTitle] = useWorkspaceState(`${draftKey}title`, tpl.title);
  const [bodyText, setBody] = useWorkspaceState(`${draftKey}body`, tpl.body);
  const [ok, setOk] = useState('');
  const [source, setSource] = useWorkspaceState<{ name: string; previousBody: string } | null>(`${draftKey}source`, null);
  const [importBusy, setImportBusy] = useState(false), [importError, setImportError] = useState('');
  const [ready, setReady] = useState(false);
  const [replaceText, setReplaceText] = useState(''), [field, setField] = useState(fields[0]?.key ?? '');
  const input = useRef<HTMLInputElement>(null), reading = useRef<AbortController | null>(null);
  useEffect(() => { setReady(true); return () => reading.current?.abort(); }, []);
  const example = renderTemplate(bodyText, Object.fromEntries([...fields.map(f => [f.key, `[${f.label}]`]), ...tpl.inputs.map(i => [i.key, `[${i.label}]`])]));
  return (
    <div className="two" style={{ alignItems: 'start' }}>
      <div className="card form" style={{ gridTemplateColumns: '1fr' }}>
        <div>
          <label>Importar modelo da empresa<input ref={input} type="file" accept=".docx,.doc,.pdf,.txt" disabled={!ready || busy || importBusy} onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return;
            reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
            setImportBusy(true); setImportError(''); setOk('');
            try {
              const text = await readTemplateDocument(file, { signal: controller.signal });
              if (controller.signal.aborted) return;
              setSource(s => ({ name: file.name, previousBody: s?.previousBody ?? bodyText })); setBody(text);
            } catch (err) { if (!controller.signal.aborted) setImportError((err as Error).message); }
            finally { if (!controller.signal.aborted) setImportBusy(false); if (input.current) input.current.value = ''; }
          }} /></label>
          <p className="muted">Word DOCX, PDF com texto seleccionável ou TXT, até 10 MB. Importa o texto e as cláusulas, sem a paginação nem as imagens originais. Reveja o texto e associe os dados variáveis aos campos do Kianda. O documento final usa o papel timbrado configurado pela empresa.</p>
          {importBusy && <p role="status">A ler o modelo… <button type="button" className="btn ghost sm" onClick={() => { reading.current?.abort(); setImportBusy(false); if (input.current) input.current.value = ''; }}>Cancelar leitura</button></p>}
          {source && <p role="status">Ficheiro: {source.name} <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { reading.current?.abort(); setImportBusy(false); setBody(source.previousBody); setSource(null); setImportError(''); setOk(''); }}>Remover importação</button></p>}
          {importError && <p className="alert" role="alert">{importError}</p>}
        </div>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Texto do modelo
          <textarea aria-label="Texto do modelo" value={bodyText} disabled={importBusy || busy} onChange={(e) => setBody(e.target.value)} rows={26} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5 }} />
        </label>
        <p className="muted">Campos entre chavetas duplas; <code>{'{{#se campo}}…{{/se}}'}</code> só mostra o texto se o campo tiver valor; <code># </code> no início = título; <code>**negrito**</code>; <code>--- assinaturas: A | B</code>. Campos <code>pedido.*</code> são pedidos na emissão.</p>
        <label>Texto a transformar num campo<input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="Ex.: o nome escrito no contrato importado" /></label>
        <label>Campo do Kianda<select value={field} onChange={e => setField(e.target.value)}>{fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
        <button type="button" className="btn ghost" disabled={!replaceText || !bodyText.includes(replaceText) || !field || busy || importBusy} onClick={() => { setBody(bodyText.replaceAll(replaceText, `{{${field}}}`)); setReplaceText(''); setOk(''); }}>Substituir pelo campo</button>
        <p className="muted">Ao emitir, o Kianda conserva as cláusulas deste modelo e preenche os campos com os dados de cada colaborador. A importação só entra em uso depois de gravar a nova versão.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" disabled={busy || importBusy} onClick={async () => { setOk(''); if (await run(`/v1/document-templates/${tpl.key}`, 'PUT', { title, body: bodyText, sourceFileName: source?.name ?? null })) { clearDraft(); setSource(null); setOk('Nova versão gravada e em uso na empresa.'); } }}>Gravar nova versão</button>
          {tpl.source === 'empresa' && <button className="btn ghost" disabled={busy} onClick={async () => { if (window.confirm('Voltar ao modelo do Kianda? As versões da empresa ficam no histórico.') && await run(`/v1/document-templates/${tpl.key}/reset`, 'POST', {})) window.location.reload(); }}>Voltar ao modelo do Kianda</button>}
          {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
          {ok && <span style={{ color: 'var(--brand)' }}>{ok}</span>}
        </div>
      </div>
      <div className="card section">
        <details className="map-disclosure"><summary><span>Pré-visualização do modelo</span><span className="map-show">Ver</span><span className="map-hide">Recolher</span></summary><Preview text={example.text} /></details>
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
  return <DocumentPrintButton className="btn ghost">Imprimir</DocumentPrintButton>;
}
