'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send, useMutation } from '@/lib/client';

/** Ex-colaborador: eliminar os dados pessoais não obrigatórios (Lei 22/11), com confirmação pelo n.º. */
export function MinimizeEmployee({ id, number }: { id: string; number: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  if (!open) return <button className="btn danger" onClick={() => setOpen(true)}>Eliminar dados pessoais (Lei 22/11)</button>;
  return (
    <div className="warn" style={{ display: 'grid', gap: 8 }}>
      <div><b>Eliminação irreversível</b> dos contactos, morada, IBAN, contacto de emergência, data de nascimento, documentos registados, pedidos do portal e do acesso. Ficam o nome, n.º, BI, NIF, n.º INSS, contratos, recibos e lançamentos — obrigatórios para a AGT, o INSS e a contabilidade.</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Escreva ${number} para confirmar`} style={{ width: 230 }} />
        <button className="btn danger" disabled={busy || confirm !== number} onClick={() => run(`/v1/privacy/employees/${id}/minimize`, 'POST', { confirm })}>Eliminar</button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>Cancelar</button>
        {error && <span className="err">{error}</span>}
      </div>
    </div>
  );
}

/** Candidato: eliminação total. */
export function DeleteCandidate({ id, back }: { id: string; back: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <span>
      <button className="btn danger" disabled={busy} onClick={async () => {
        if (!window.confirm('Eliminar definitivamente este candidato e todo o histórico? (Lei 22/11)')) return;
        setBusy(true);
        const r = await send(`/v1/privacy/candidates/${id}`, 'DELETE');
        setBusy(false);
        if (!r.ok) return setError(r.message ?? 'Erro');
        router.push(back);
        router.refresh();
      }}>Eliminar dados do candidato</button>
      {error && <span className="err" style={{ marginLeft: 8 }}>{error}</span>}
    </span>
  );
}

/** Consola: exportar e eliminar uma empresa cancelada (confirmação pelo NIF). */
export function PurgeCompany({ id, nif, cancelled }: { id: string; nif: string; cancelled: boolean }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <a className="link" style={{ color: 'var(--brand)' }} href={`/api/v1/platform/companies/${id}/export`}>Exportar dados</a>
      {cancelled && (open ? (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="NIF para confirmar" style={{ width: 150, height: 30 }} />
          <button className="btn danger" disabled={busy || confirm !== nif} onClick={() => run(`/v1/platform/companies/${id}/purge`, 'POST', { confirmNif: confirm })}>Eliminar tudo</button>
        </span>
      ) : <button className="link" style={{ color: 'var(--red)' }} onClick={() => setOpen(true)}>Eliminar empresa…</button>)}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
