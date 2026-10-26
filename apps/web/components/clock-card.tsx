'use client';

import { formatMinutes } from '@kianda/core';
import { useCallback, useEffect, useState } from 'react';
import { send } from '@/lib/client';

interface Me {
  today: string;
  now: string;
  open: boolean;
  workedMinutes: number;
  entries: { id: string; in: string; out: string | null; source: string }[];
  forgottenDays: string[];
}

const pt = (d: string) => d.split('-').reverse().join('/');

/** Registo de ponto: a hora registada é sempre a do servidor (não a do telemóvel). */
export function ClockCard({ compact }: { compact?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState('');

  const load = useCallback(async () => {
    const r = await send<Me>('/v1/attendance/me', 'GET');
    if (r.ok) setMe(r.data!); else setError(r.message ?? '');
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const tick = () => setClock(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Luanda' }));
    tick();
    const c = setInterval(tick, 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);

  async function punch(action: 'in' | 'out') {
    setBusy(true);
    setError('');
    const r = await send('/v1/attendance/clock', 'POST', { action });
    setBusy(false);
    if (!r.ok) setError(r.message ?? 'Erro');
    await load();
  }

  if (!me && error) return compact ? null : <div className="card section"><h2>Registo de ponto</h2><div className="empty">{error}</div></div>;
  if (!me) return <div className="card clock"><div className="muted">A carregar…</div></div>;

  return (
    <div className={`card clock ${compact ? 'compact' : ''}`}>
      <div className="clock-head">
        <div>
          <div className="clock-time">{clock}</div>
          <div className="muted">{new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Luanda' })}</div>
        </div>
        <div className="clock-state">
          <span className={`st ${me.open ? 'approved' : 'cancelled'}`}>{me.open ? 'Em serviço' : 'Fora de serviço'}</span>
          <div className="muted" style={{ marginTop: 4 }}>Hoje: <b>{formatMinutes(me.workedMinutes)}</b></div>
        </div>
      </div>
      <div className="clock-actions">
        <button className="btn big" disabled={busy || me.open} onClick={() => punch('in')}>Registar entrada</button>
        <button className="btn big ghost" disabled={busy || !me.open} onClick={() => punch('out')}>Registar saída</button>
      </div>
      {error && <div className="err" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
      {me.forgottenDays.length > 0 && (
        <div className="warn" style={{ marginTop: 10, marginBottom: 0 }}>
          Ficou por registar a saída em {me.forgottenDays.map(pt).join(', ')}. Peça à sua chefia para corrigir.
        </div>
      )}
      {!compact && me.entries.length > 0 && (
        <div className="clock-entries">
          {me.entries.map((e) => (
            <span key={e.id} className="tag">{e.in} – {e.out ?? '…'}{e.source === 'manual' ? ' (corrigido)' : ''}</span>
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>A hora registada é a do servidor (hora de Luanda), não a do seu dispositivo.</p>
    </div>
  );
}
