'use client';

import { formatKz } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function RegimeForm({ employeeId, scheduleId, anchor, schedules }: { employeeId: string; scheduleId: string | null; anchor: string | null; schedules: { id: string; name: string; kind: 'weekly' | 'cycle'; anchorDate: string | null; description: string }[] }) {
  const { busy, error, run } = useMutation();
  const [sid, setSid] = useState(scheduleId ?? '');
  const [a, setA] = useState(anchor ?? '');
  const [ok, setOk] = useState('');
  const sel = schedules.find((s) => s.id === sid);
  return (
    <div className="form" style={{ borderTop: '1px solid var(--line)' }}>
      <label>Regime
        <select value={sid} onChange={(e) => { setSid(e.target.value); setOk(''); }}>
          <option value="">Horário normal da empresa</option>
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {sel?.kind === 'cycle' && (
        <label>Início do ciclo deste colaborador{sel.anchorDate ? ' (opcional)' : ''}
          <input type="date" value={a} onChange={(e) => setA(e.target.value)} />
        </label>
      )}
      {sel && <div className="wide muted">{sel.description}{sel.kind === 'cycle' ? ' — o início do ciclo é o primeiro dia de trabalho da rotação (equipas diferentes começam em dias diferentes).' : ''}</div>}
      <div className="form-actions">
        {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
        <button className="btn" disabled={busy} onClick={() => run(`/v1/work-regime/${employeeId}`, 'PUT', { scheduleId: sid || null, scheduleAnchor: sel?.kind === 'cycle' && a ? a : null }, () => setOk('Regime guardado'))}>Guardar regime</button>
      </div>
    </div>
  );
}

export function AssignAllowance({ employeeId, types }: { employeeId: string; types: { id: string; code: string; label: string; calc: 'fixed' | 'base_pct' | 'per_day'; valueMinor: number | null; bps: number | null }[] }) {
  const { busy, error, run } = useMutation();
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [own, setOwn] = useState('');
  const [start, setStart] = useState(new Date(Date.now() + 3_600_000).toISOString().slice(0, 8) + '01');
  const [end, setEnd] = useState('');
  const t = types.find((x) => x.id === typeId);
  const def = t ? (t.calc === 'base_pct' ? `${String((t.bps ?? 0) / 100).replace('.', ',')}%` : formatKz(t.valueMinor ?? 0)) : '';
  const n = Number(own.replace(/\s/g, '').replace(',', '.'));
  return (
    <div className="form" style={{ borderTop: '1px solid var(--line)' }}>
      <label>Subsídio
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>{types.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      </label>
      <label>{t?.calc === 'base_pct' ? 'Percentagem própria (%)' : t?.calc === 'per_day' ? 'Valor por dia próprio (Kz)' : 'Valor mensal próprio (Kz)'}
        <input inputMode="decimal" value={own} onChange={(e) => setOwn(e.target.value)} placeholder={`catálogo: ${def}`} />
      </label>
      <label>Desde<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label>Até (opcional)<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button className="btn" disabled={busy || !typeId || !start} onClick={() => run(`/v1/work-regime/${employeeId}/allowances`, 'POST', {
          typeId, startDate: start, endDate: end || null,
          ...(own && n > 0 ? (t?.calc === 'base_pct' ? { pct: n } : { value: n }) : {}),
        }, () => { setOwn(''); setEnd(''); })}>Atribuir subsídio</button>
      </div>
    </div>
  );
}

export function AllowanceActions({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  const [end, setEnd] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="link" style={{ color: 'var(--brand)' }} onClick={() => setOpen(true)}>Terminar</button>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ height: 30 }} />
      <button className="btn ghost" style={{ height: 30 }} disabled={busy || !end} onClick={() => run(`/v1/employee-allowances/${id}`, 'PATCH', { endDate: end })}>Terminar</button>
      <button className="btn danger" disabled={busy} onClick={() => run(`/v1/employee-allowances/${id}`, 'DELETE')}>Apagar</button>
      {error && <span className="err" style={{ maxWidth: 260, whiteSpace: 'normal', textAlign: 'left' }}>{error}</span>}
    </span>
  );
}
