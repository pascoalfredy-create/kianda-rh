'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@/lib/client';

interface FileItem { id: string; name: string; mime: string; sizeBytes: number; createdAt: string; url: string }
interface Listing { files: FileItem[]; canUpload: boolean; maxBytes: number }

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace(/\.0$/, '').replace('.', ',')} MB`);
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * Ficheiros anexados a um registo (ficha, documento, ausência, nota de despesas).
 * compact: para células de tabela — só as ligações e um botão de anexar.
 */
export function Attachments({ entity, entityId, compact = false, hint }: { entity: string; entityId: string; compact?: boolean; hint?: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await send<Listing>(`/v1/files?entity=${entity}&entityId=${entityId}`, 'GET');
    if (r.ok) setData(r.data!);
    else setError(r.message ?? 'Erro');
  }, [entity, entityId]);
  useEffect(() => { void load(); }, [load]);

  async function upload(list: FileList | null) {
    const files = list ? [...list] : [];
    if (!files.length || !data) return;
    setError('');
    setBusy(true);
    for (const f of files) {
      if (f.size > data.maxBytes) { setError(`${f.name}: passa o limite de ${size(data.maxBytes)}`); continue; }
      const res = await fetch(`/api/v1/files?entity=${entity}&entityId=${entityId}&name=${encodeURIComponent(f.name)}`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(`${f.name}: ${j.message ?? `erro ${res.status}`}`); }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    await load();
  }

  async function remove(f: FileItem) {
    if (!window.confirm(`Remover ${f.name}?`)) return;
    const r = await send(`/v1/files/${f.id}`, 'DELETE');
    if (!r.ok) setError(r.message ?? 'Erro');
    await load();
  }

  if (!data) return error ? <span className="err">{error}</span> : <span className="muted">…</span>;
  const picker = data.canUpload && (
    <>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
      <button type="button" className={compact ? 'btn ghost sm' : 'btn sm'} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'A enviar…' : compact ? '+ Cópia' : 'Anexar ficheiro'}
      </button>
    </>
  );

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {data.files.map((f) => (
          <span key={f.id} style={{ whiteSpace: 'nowrap' }}>
            <a href={f.url} target="_blank" rel="noopener">📎 {f.name}</a>
            {data.canUpload && <button type="button" className="btn ghost sm" title="Remover" onClick={() => remove(f)}>×</button>}
          </span>
        ))}
        {picker}
        {!data.files.length && !data.canUpload && <span className="muted">—</span>}
        {error && <span className="err">{error}</span>}
      </span>
    );
  }

  return (
    <div
      style={{ display: 'grid', gap: 8 }}
      onDragOver={(e) => { if (data.canUpload) e.preventDefault(); }}
      onDrop={(e) => { if (!data.canUpload) return; e.preventDefault(); void upload(e.dataTransfer.files); }}
    >
      {data.files.length > 0 && (
        <table>
          <tbody>
            {data.files.map((f) => (
              <tr key={f.id}>
                <td><a href={f.url} target="_blank" rel="noopener">📎 {f.name}</a></td>
                <td className="muted">{size(f.sizeBytes)}</td>
                <td className="muted">{new Date(f.createdAt).toLocaleDateString('pt-PT')}</td>
                <td className="num">
                  <a className="btn ghost sm" href={`${f.url}?download=1`}>Descarregar</a>
                  {data.canUpload && <button type="button" className="btn ghost sm" onClick={() => remove(f)}>Remover</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!data.files.length && <div className="muted">Sem ficheiros anexados.</div>}
      {data.canUpload && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {picker}
          <span className="muted">{hint ?? 'PDF, JPG, PNG ou WEBP'} · até {size(data.maxBytes)} cada · pode arrastar para aqui</span>
        </div>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  );
}
