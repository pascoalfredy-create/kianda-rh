'use client';

import { formatMinutes } from '@kianda/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@/lib/client';
import { enqueuePunch, flushPunches, isNetworkError, pendingPunches } from '@/lib/offline-punch';
import { canScanQr, currentFix, describeLocation } from '@/lib/punch-location';
import type { PunchLocation } from '@/lib/types';

const ME_CACHE = 'kianda_me_cache';

interface Me {
  today: string;
  now: string;
  open: boolean;
  workedMinutes: number;
  entries: { id: string; in: string; out: string | null; source: string; clockInLocation?: PunchLocation | null; clockOutLocation?: PunchLocation | null; locationIssue?: boolean }[];
  forgottenDays: string[];
  /** Ponto com localização (regra da empresa); ausente em respostas antigas guardadas no telemóvel. */
  location?: { mode: 'off' | 'record' | 'alert' | 'block'; workplace: string | null; kiosk: boolean };
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
  const [kiosk, setKiosk] = useState('');
  const [kioskOpen, setKioskOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

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
    // Localização só no instante da marcação e só se a empresa usa o ponto com localização; com o código do quiosque não é precisa.
    const code = kiosk.trim() || undefined;
    const needsLocation = !!me?.location && me.location.mode !== 'off' && !code;
    if (needsLocation) setInfo('A obter a localização…');
    const location = needsLocation ? await currentFix() : null;
    if (needsLocation) setInfo('');
    const extra = { ...(location ? { location } : {}), ...(code ? { kiosk: code } : {}) };
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const r = await send('/v1/attendance/clock', 'POST', { action, ...extra });
      if (!r.ok) setError(r.message ?? 'Erro');
      else { setKiosk(''); setKioskOpen(false); }
      await load();
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const p = enqueuePunch(action, extra);
      setKiosk(''); setKioskOpen(false);
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
      {me.location && me.location.mode !== 'off' && (
        <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
          A sua localização só é guardada no momento em que marca{me.location.workplace ? ` · Local de trabalho: ${me.location.workplace}` : ''}.
          {me.location.kiosk && <>{' '}<button className="link" onClick={() => setKioskOpen(!kioskOpen)}>{kioskOpen ? 'Usar o GPS' : 'Usar o código do quiosque'}</button></>}
        </div>
      )}
      {kioskOpen && (
        <div className="inline-note" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <input aria-label="Código do quiosque" inputMode="numeric" autoComplete="off" maxLength={120} placeholder="Código de 6 dígitos" value={kiosk} onChange={(e) => setKiosk(e.target.value.replace(/\s/g, ''))} style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 280 }} />
          {canScanQr() && <button className="btn ghost sm" type="button" onClick={() => setScanning(true)}>Ler QR com a câmara</button>}
          <span className="muted" style={{ fontSize: 12 }}>Depois carregue em Registar entrada ou saída.</span>
        </div>
      )}
      {scanning && <QrScanner onResult={(text) => { setKiosk(text); setScanning(false); }} onClose={() => setScanning(false)} />}
      {error && <div className="err" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
      {info && <div className="muted" role="status" style={{ marginTop: 8 }}>{info}</div>}
      {pending > 0 && <div className="warn" style={{ marginTop: 8, marginBottom: 0 }}>{pending === 1 ? 'Uma marcação feita sem rede ainda não foi enviada.' : `${pending} marcações feitas sem rede ainda não foram enviadas.`}{' '}<button className="link" onClick={() => void sync()}>Enviar agora</button></div>}
      {me.forgottenDays.length > 0 && (
        <div className="warn" style={{ marginTop: 10, marginBottom: 0 }}>
          Ficou por registar a saída em {me.forgottenDays.map(pt).join(', ')}. Peça à sua chefia para corrigir.
        </div>
      )}
      {!compact && me.entries.length > 0 && (
        <div className="clock-entries">
          {me.entries.map((e) => (
            <span key={e.id} className="tag" title={[describeLocation(e.clockInLocation), describeLocation(e.clockOutLocation)].filter(Boolean).join(' · ') || undefined}>{e.in} – {e.out ?? '…'}{e.source === 'manual' ? ' (corrigido)' : e.source === 'offline' ? ' (sem rede)' : ''}{e.locationIssue ? ' (fora do local)' : ''}</span>
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{pending > 0 ? "As marcações sem rede ficam com a hora do telemóvel e a chefia confirma-as." : "Conta a hora de Luanda. Sem rede, guardamos no telemóvel e enviamos depois."}</p>
    </div>
  );
}

/** Leitor do QR do quiosque (câmara traseira + BarcodeDetector). Pára a câmara ao fechar ou ao ler. */
function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(onResult);
  done.current = onResult;
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          const hit = found.find((f) => f.rawValue.startsWith('kianda-ponto:'));
          if (hit) done.current(hit.rawValue); else timer = setTimeout(tick, 300);
        };
        void tick();
      } catch { setProblem('Não foi possível abrir a câmara. Escreva o código de 6 dígitos.'); }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="card" style={{ marginTop: 8, padding: 10, textAlign: 'center' }}>
      {problem ? <p className="muted">{problem}</p> : <video ref={video} playsInline muted style={{ width: '100%', maxWidth: 320, borderRadius: 8 }} />}
      <div><button className="btn ghost sm" type="button" onClick={onClose}>Fechar câmara</button></div>
    </div>
  );
}
