'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function PayButton({ runId, kind, label }: { runId: string; kind: string; label: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [ref, setRef] = useState('');
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Registar pagamento</button>;
  return (
    <span className="inline-note" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
      <input placeholder="Referência (ex.: n.º da transferência)" value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: 230 }} />
      <button className="btn sm" disabled={busy} onClick={async () => { if (await run(`/v1/payroll-runs/${runId}/payments`, 'POST', { kind, paidOn: date, reference: ref || null })) setOpen(false); }}>Confirmar</button>
      <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
      {error && <span style={{ color: 'var(--red)', width: '100%', textAlign: 'right' }}>{error}</span>}
      <span className="muted" style={{ width: '100%', textAlign: 'right', fontSize: 12 }}>Gera o lançamento “Pagamento {label}” (dívida a débito, banco 43.1 a crédito).</span>
    </span>
  );
}

export function ReverseButton({ runId, kind }: { runId: string; kind: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) return <button className="link" style={{ color: 'var(--ink3)', fontSize: 12.5 }} onClick={() => setOpen(true)}>Estornar</button>;
  return (
    <span className="inline-note">
      <input placeholder="Motivo do estorno" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn danger" disabled={busy || note.trim().length < 3} onClick={() => run(`/v1/payroll-runs/${runId}/payments/${kind}/reverse`, 'POST', { note })}>Estornar</button>
      <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
