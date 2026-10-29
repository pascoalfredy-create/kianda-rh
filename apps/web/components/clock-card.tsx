'use client';

import { formatMinutes } from '@kianda/core';
import { useCallback, useEffect, useState } from 'react';
import { send } from '@/lib/client';
import { enqueuePunch, flushPunches, isNetworkError, pendingPunches } from '@/lib/offline-punch';

const ME_CACHE = 'kianda_me_cache';

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
export function ClockCard({ compact, inline }: { compact?: boolean; inline?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState('');
  const [info, setInfo] = useState('');
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await send<Me>('/v1/attendance/me', 'GET');
      if (r.ok) {
        setMe(r.data!);
        try { localStorage.setItem(ME_CACHE, JSON.stringify(r.data)); } catch { /* sem armazenamento */ }
      } else setError(r.message ?? '');
    } catch {
      // Sem rede: último estado conhecido + marcações por enviar.
      try {
        const cached = JSON.parse(localStorage.getItem(ME_CACHE) ?? 'null') as Me | null;
        if (cached) {
          const q = pendingPunches();
          setMe({ ...cached, open: q.length ? q[q.length - 1]!.action === 'in' : cached.open });
        } else setError('Sem rede e sem dados guardados neste telemóvel — abra a app uma vez com rede.');
      } catch { /* sem cache */ }
      setInfo('Sem rede — pode registar o ponto na mesma; fica guardado no telemóvel.');
    }
    setPending(pendingPunches().length);
  }, []);

  const sync = useCallback(async () => {
    if (!pendingPunches().length) return;
    const r = await flushPunches();
    if (r.sent) setInfo(`${r.sent} registo(s) feitos sem rede foram enviados.`);
    if (r.rejected.length) setError(r.rejected.map((x) => `Registo de ${new Date(x.punch.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' })}: ${x.message}`).join(' · '));
    await load();
  }, [load]);

  useEffect(() => {
    void sync().then(load);
    const online = () => { setInfo(''); void sync(); };
    window.addEventListener('online', online);
    window.addEventListener('kianda:punch', load);
    const t = setInterval(load, 60_000);
    const tick = () => setClock(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Luanda' }));
    tick();
    const c = setInterval(tick, 1000);
    return () => { clearInterval(t); clearInterval(c); window.removeEventListener('online', online); window.removeEventListener('kianda:punch', load); };
  }, [load, sync]);

  async function punch(action: 'in' | 'out') {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const r = await send('/v1/attendance/clock', 'POST', { action });
      if (!r.ok) setError(r.message ?? 'Erro');
      await load();
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const p = enqueuePunch(action);
      setMe((m) => (m ? { ...m, open: action === 'in' } : m));
      setPending(pendingPunches().length);
      setInfo(`Sem rede: ${action === 'in' ? 'entrada' : 'saída'} guardada no telemóvel às ${new Date(p.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' })}. É enviada sozinha quando houver rede (a chefia confirma a hora).`);
    }
    window.dispatchEvent(new Event('kianda:punch'));
    setBusy(false);
  }

  if (!me && error) return inline || compact ? null : <div className="card section"><h2>Registo de ponto</h2><div className="empty">{error}</div></div>;
  if (!me && inline) return <span className="muted">A carregar ponto…</span>;
  if (!me) return <div className="card clock"><div className="muted">A carregar…</div></div>;

  if (inline) return <div className="clock-inline">
    <div><small>{me.open ? 'Em serviço' : 'Hora de Luanda'}</small><b>{me.open ? formatMinutes(me.workedMinutes) : clock}</b></div>
    <button className="btn sm" disabled={busy} onClick={() => punch(me.open ? 'out' : 'in')}>{me.open ? 'Registar saída' : 'Registar entrada'}</button>
    {(error || info || pending > 0 || me.forgottenDays.length > 0) && <details className="clock-inline-notes"><summary aria-label="Avisos do ponto">!</summary><div role="status">{error && <p>{error}</p>}{info && <p>{info}</p>}{pending > 0 && <p>{pending} registo(s) por enviar. <button className="btn ghost sm" onClick={() => void sync()}>Enviar agora</button></p>}{me.forgottenDays.length > 0 && <p>Saída por registar: {me.forgottenDays.map(pt).join(', ')}.</p>}</div></details>}
  </div>;

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
      {info && <div className="muted" role="status" style={{ marginTop: 8 }}>{info}</div>}
      {pending > 0 && <div className="warn" style={{ marginTop: 8, marginBottom: 0 }}>📵 {pending} registo(s) por enviar.{' '}<button className="link" onClick={() => void sync()}>Enviar agora</button></div>}
      {me.forgottenDays.length > 0 && (
        <div className="warn" style={{ marginTop: 10, marginBottom: 0 }}>
          Ficou por registar a saída em {me.forgottenDays.map(pt).join(', ')}. Peça à sua chefia para corrigir.
        </div>
      )}
      {!compact && me.entries.length > 0 && (
        <div className="clock-entries">
          {me.entries.map((e) => (
            <span key={e.id} className="tag">{e.in} – {e.out ?? '…'}{e.source === 'manual' ? ' (corrigido)' : e.source === 'offline' ? ' (sem rede)' : ''}</span>
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{pending > 0 ? "Registos sem rede ficam com a hora do telemóvel e são confirmados pela chefia." : "A hora registada é a do servidor (hora de Luanda), não a do seu dispositivo; sem rede, fica a do telemóvel, confirmada pela chefia."}</p>
    </div>
  );
}
