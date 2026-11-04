'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@/lib/client';

export function Publication({ id, publicPath, status, isPublic, acceptingApplications, canEdit }: { id: string; publicPath: string; status: string; isPublic: boolean; acceptingApplications: boolean; canEdit: boolean }) {
  const { busy, error, run } = useMutation();
  const [url, setUrl] = useState(publicPath), [message, setMessage] = useState('');
  const link = useRef<HTMLInputElement>(null);
  useEffect(() => { setUrl(new URL(publicPath, window.location.origin).href); }, [publicPath]);
  async function change(next: string, publish: boolean) {
    setMessage('');
    await run(`/v1/openings/${id}`, 'PATCH', { status: next, isPublic: publish }, () => setMessage(publish ? 'Vaga publicada. Pode copiar a ligação e partilhá-la.' : 'Publicação actualizada. A ligação deixa de aceitar novas candidaturas.'));
  }
  return <section className="card" aria-label="Publicação e candidaturas" style={{ padding: 16, marginBottom: 16 }}>
    <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Portal de candidatura</h2>
    <p className="muted">{acceptingApplications ? 'Publicada: qualquer candidato pode abrir esta ligação e enviar o CV, sem criar uma conta Kianda.' : isPublic && status === 'open' ? 'O prazo de candidatura terminou. Actualize a data na edição da vaga para voltar a receber candidaturas.' : 'Publique a vaga para activar esta ligação. As candidaturas recebidas entram automaticamente no quadro.'}</p>
    <label>Ligação da vaga<input ref={link} aria-label="Ligação da vaga" value={url} readOnly onFocus={e => e.currentTarget.select()} /></label>
    <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
      {acceptingApplications && <><button type="button" className="btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setMessage('Ligação copiada.'); } catch { link.current?.focus(); link.current?.select(); setMessage('Seleccione e copie a ligação apresentada acima.'); } }}>Copiar ligação</button><a className="btn ghost sm" href={publicPath} target="_blank" rel="noopener noreferrer">Abrir portal de candidatura</a></>}
      {canEdit && <>
        {!acceptingApplications && <button className="btn sm" disabled={busy} onClick={() => change('open', true)}>{status === 'closed' ? 'Reabrir e publicar' : status === 'on_hold' ? 'Retomar e publicar' : 'Publicar vaga'}</button>}
        {acceptingApplications && <button className="btn ghost sm" disabled={busy} onClick={() => change('on_hold', false)}>Suspender candidaturas</button>}
        {status !== 'closed' && <button className="btn ghost sm" disabled={busy} onClick={() => change('closed', false)}>Fechar vaga</button>}
      </>}
    </div>
    {message && <p role="status">{message}</p>}{error && <p className="err" role="alert">{error}</p>}
  </section>;
}
