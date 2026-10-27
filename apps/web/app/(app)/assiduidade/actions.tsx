'use client';

import { formatMinutes } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

/** Acrescentar registo manual num dia (chefia/RH). */
export function AddEntry({ employeeId, date }: { employeeId: string; date: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('17:00');
  const [note, setNote] = useState('');
  if (!open) return <button className="link" style={{ color: 'var(--brand)' }} onClick={() => setOpen(true)}>+ registo</button>;
  return (
    <span className="inline-note" style={{ flexWrap: 'wrap' }}>
      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 96 }} />
      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 96 }} />
      <input placeholder="Motivo da correcção" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 180 }} />
      <button className="btn sm" disabled={busy || note.trim().length < 3} onClick={async () => { if (await run('/v1/attendance/entries', 'POST', { employeeId, date, start, end: end || null, note })) setOpen(false); }}>Gravar</button>
      <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

/** Chip de um registo, com edição da saída e remoção (chefia/RH). */
export function EntryChip({ e, editable }: { e: { id: string; in: string; out: string | null; source: string; note: string | null; offlineOut?: boolean }; editable: boolean }) {
  const { busy, error, run } = useMutation();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(e.in);
  const [end, setEnd] = useState(e.out ?? '');
  const [note, setNote] = useState('');
  if (editing) {
    return (
      <span className="inline-note" style={{ flexWrap: 'wrap', margin: '2px 0' }}>
        <input type="time" value={start} onChange={(x) => setStart(x.target.value)} style={{ width: 96 }} />
        <input type="time" value={end} onChange={(x) => setEnd(x.target.value)} style={{ width: 96 }} />
        <input placeholder="Motivo" value={note} onChange={(x) => setNote(x.target.value)} style={{ width: 150 }} />
        <button className="btn sm" disabled={busy || note.trim().length < 3} onClick={async () => { if (await run(`/v1/attendance/entries/${e.id}`, 'PATCH', { start, end: end || null, note })) setEditing(false); }}>Gravar</button>
        <button className="btn danger" disabled={busy || note.trim().length < 3} onClick={() => run(`/v1/attendance/entries/${e.id}?note=${encodeURIComponent(note)}`, 'DELETE')}>Apagar</button>
        <button className="btn ghost sm" onClick={() => setEditing(false)}>×</button>
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
      </span>
    );
  }
  return (
    <span className={`entry-chip ${e.source === 'manual' ? 'manual' : ''} ${e.source === 'offline' || e.offlineOut ? 'offline' : ''}`} title={e.note ?? (e.source === 'web' ? 'Registado pelo colaborador' : '')}>
      {(e.source === 'offline' || e.offlineOut) && <span aria-label="Registado sem rede">📵</span>}
      {e.in} – {e.out ?? <b style={{ color: 'var(--red)' }}>sem saída</b>}
      {editable && <button aria-label="Corrigir" onClick={() => setEditing(true)}>✎</button>}
    </span>
  );
}

/** Aprovar o mês (com possibilidade de aprovar menos horas extra, com motivo). */
export function ApproveMonth({ employeeId, period, overtimeMinutes, openDays }: { employeeId: string; period: string; overtimeMinutes: number; openDays: number }) {
  const { busy, error, run } = useMutation();
  const [hours, setHours] = useState(String(overtimeMinutes / 60));
  const [note, setNote] = useState('');
  const approved = Math.round(Number(hours.replace(',', '.')) * 60);
  const cut = approved < overtimeMinutes;
  return (
    <div className="form card cols4" style={{ marginTop: 16 }}>
      <h3>Aprovar assiduidade de {period}</h3>
      <label>Horas extra registadas<input disabled value={formatMinutes(overtimeMinutes)} /></label>
      <label>Horas extra a pagar<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      <label className="span2">Observações{cut ? ' (obrigatório: aprova menos horas)' : ''}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={cut ? 'Ex.: horas de sábado sem autorização prévia' : 'Opcional'} /></label>
      {openDays > 0 && <div className="preview bad">Há {openDays} dia(s) com saída por registar. Corrija-os na tabela antes de aprovar.</div>}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button className="btn" disabled={busy || openDays > 0 || !Number.isFinite(approved) || (cut && note.trim().length < 3)}
          onClick={() => run('/v1/attendance/approve', 'POST', { employeeId, period, approvedOvertimeMinutes: approved, note: note || undefined })}>
          Aprovar mês
        </button>
      </div>
      <p className="muted wide">Depois de aprovado, o mês fica fechado a correcções e as horas extra aprovadas entram no processamento salarial (+50% até 30 h/mês, +75% acima).</p>
    </div>
  );
}

export function ReopenMonth({ employeeId, period }: { employeeId: string; period: string }) {
  const { busy, error, run } = useMutation();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Reabrir mês</button>;
  return (
    <span className="inline-note">
      <input placeholder="Motivo da reabertura" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn danger" disabled={busy || note.trim().length < 3} onClick={() => run('/v1/attendance/reopen', 'POST', { employeeId, period, note })}>Reabrir</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
