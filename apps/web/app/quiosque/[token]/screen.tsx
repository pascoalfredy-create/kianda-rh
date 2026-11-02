'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface Screen { company: string; workplace: string; code: string; qr: string; expiresInSeconds: number; active: boolean }

/** Pede o código ao servidor quando a janela termina (o segredo nunca chega ao aparelho do quiosque). */
export function KioskScreen({ token }: { token: string }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [qr, setQr] = useState('');
  const [left, setLeft] = useState(0);
  const [error, setError] = useState('');
  const [clock, setClock] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/public/kiosk/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (stopped) return;
        if (!res.ok) { setError(data.message ?? 'Quiosque indisponível.'); setScreen(null); timer = setTimeout(load, 30_000); return; }
        setError(''); setScreen(data as Screen); setLeft((data as Screen).expiresInSeconds);
        setQr(await QRCode.toDataURL((data as Screen).qr, { margin: 1, width: 360, errorCorrectionLevel: 'M' }));
        timer = setTimeout(load, Math.max(1, (data as Screen).expiresInSeconds) * 1000 + 300);
      } catch {
        if (!stopped) { setError('Sem rede. A tentar de novo…'); timer = setTimeout(load, 5_000); }
      }
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => {
      setLeft((v) => Math.max(0, v - 1));
      setClock(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Luanda' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg)' }}>
      <div className="card" style={{ padding: 28, width: 'min(520px, 100%)', textAlign: 'center' }}>
        <div className="muted">Kianda · ponto</div>
        {screen ? (
          <>
            <h1 style={{ margin: '6px 0 2px' }}>{screen.workplace}</h1>
            <div className="muted" style={{ marginBottom: 16 }}>{screen.company} · {clock}</div>
            {qr && <img src={qr} alt="QR do ponto" width={300} height={300} style={{ width: 'min(300px, 70vw)', height: 'auto', imageRendering: 'pixelated' }} />}
            <div aria-live="polite" style={{ fontSize: 'clamp(40px, 11vw, 64px)', fontWeight: 700, letterSpacing: 8, fontVariantNumeric: 'tabular-nums', margin: '10px 0 4px' }}>{screen.code.slice(0, 3)} {screen.code.slice(3)}</div>
            <div className="muted">Muda dentro de {left} s</div>
            <p style={{ marginTop: 16, fontSize: 14 }}>No telemóvel: <b>Assiduidade → Usar o código do quiosque</b>, leia o QR ou escreva o código e registe a entrada ou a saída.</p>
            {!screen.active && <p className="warn" style={{ marginTop: 10 }}>A regra do ponto com localização está desligada nesta empresa: o código não é necessário.</p>}
          </>
        ) : <p style={{ marginTop: 16 }}>{error || 'A carregar…'}</p>}
      </div>
    </main>
  );
}
