'use client';

import { formatMinutes } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';
import { describeLocation, mapLink } from '@/lib/punch-location';
import type { PunchLocation } from '@/lib/types';

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
export function EntryChip({ e, editable }: { e: { id: string; in: string; out: string | null; source: string; note: string | null; offlineOut?: boolean; clockInLocation?: PunchLocation | null; clockOutLocation?: PunchLocation | null; locationIssue?: boolean }; editable: boolean }) {
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
    <span className={`entry-chip ${e.source === 'manual' ? 'manual' : ''} ${e.source === 'offline' || e.offlineOut || e.locationIssue ? 'offline' : ''}`} title={[e.note ?? (e.source === 'web' ? 'Registado pelo colaborador' : ''), e.clockInLocation && `Entrada: ${describeLocation(e.clockInLocation)}`, e.clockOutLocation && `Saída: ${describeLocation(e.clockOutLocation)}`].filter(Boolean).join(' · ')}>
      {(e.source === 'offline' || e.offlineOut) && <span className="tag" title="Marcado sem rede, com a hora do telemóvel">sem rede</span>}
      {e.locationIssue && <span className="tag terra" title="Marcação fora do local ou sem localização">fora do local</span>}
      {(mapLink(e.clockInLocation) || mapLink(e.clockOutLocation)) && <a href={(mapLink(e.clockInLocation) ?? mapLink(e.clockOutLocation))!} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>mapa</a>}
      {e.in} – {e.out ?? <b style={{ color: 'var(--red)' }}>sem saída</b>}
      {editable && <button aria-label="Corrigir" onClick={() => setEditing(true)}>✎</button>}
    </span>
  );
}

/** Aprovar o mês (com possibilidade de aprovar menos horas extra, com motivo). */
export function ApproveMonth({ employeeId, period, overtimeMinutes, openDays, noRecordDays = 0 }: { employeeId: string; period: string; overtimeMinutes: number; openDays: number; noRecordDays?: number }) {
  const { busy, error, run } = useMutation();
  const [hours, setHours] = useState(String(overtimeMinutes / 60));
  const [note, setNote] = useState('');
  const [noRecord, setNoRecord] = useState<'' | 'absent' | 'present'>('');
  const approved = Math.round(Number(hours.replace(',', '.')) * 60);
  const cut = approved < overtimeMinutes;
  const needsNote = cut || noRecord === 'present';
  return (
    <div className="form card cols4" style={{ marginTop: 16 }}>
      <h3>Aprovar assiduidade de {period}</h3>
      <label>Horas extra registadas<input disabled value={formatMinutes(overtimeMinutes)} /></label>
      <label>Horas extra a pagar<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      <label className="span2">Observações{needsNote ? ' (obrigatório)' : ''}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={cut ? 'Ex.: horas de sábado sem autorização prévia' : 'Opcional'} /></label>
      {noRecordDays > 0 && <fieldset className="wide" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>{noRecordDays} dia(s) útil(eis) sem registo de ponto nem ausência — como classificar?</legend>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="radio" name="noRecord" checked={noRecord === 'absent'} onChange={() => setNoRecord('absent')} /> Falta injustificada (desconta salário e subsídios na folha)</label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="radio" name="noRecord" checked={noRecord === 'present'} onChange={() => setNoRecord('present')} /> Esteve a trabalhar (esqueceu-se de marcar, serviço externo) — indique o motivo</label>
      </fieldset>}
            {openDays > 0 && <div className="preview bad">Há {openDays} dia(s) com saída por registar. Corrija-os na tabela antes de aprovar.</div>}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button className="btn" disabled={busy || openDays > 0 || !Number.isFinite(approved) || (needsNote && note.trim().length < 3) || (noRecordDays > 0 && !noRecord)}
          onClick={() => run('/v1/attendance/approve', 'POST', { employeeId, period, approvedOvertimeMinutes: approved, note: note || undefined, noRecord: noRecordDays > 0 ? noRecord : undefined })}>
          Aprovar mês
        </button>
      </div>
      <p className="muted wide">Depois de aprovado, o mês fica fechado a correcções. As horas extra aprovadas entram no processamento salarial (+50% até 30 h/mês, +75% acima) e, se a empresa os descontar, os atrasos e saídas antecipadas entram como faltas em horas.</p>
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
