'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { send, useMutation } from '@/lib/client';

export function TwoFactor({ enabled, recommended }: { enabled: boolean; recommended: boolean }) {
  const { busy, error, setError, run } = useMutation();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState('');
  const [disabling, setDisabling] = useState(false);
  useEffect(() => { if (setup) void QRCode.toDataURL(setup.uri, { margin: 1, width: 200 }).then(setQr); }, [setup]);
  return (
    <div className="card section" style={{ maxWidth: 620 }}>
      <h2>Verificação em dois passos {enabled ? <span className="st approved" style={{ marginLeft: 8 }}>activa</span> : recommended ? <span className="st pending" style={{ marginLeft: 8 }}>recomendada para o seu perfil</span> : null}</h2>
      <div style={{ padding: '0 16px 16px', display: 'grid', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>Além da palavra-passe, a entrada pede um código de 6 dígitos gerado no seu telemóvel (Google Authenticator, Microsoft Authenticator ou semelhante). Protege a conta mesmo que alguém descubra a palavra-passe.</p>
        {!enabled && !setup && <button className="btn" style={{ justifySelf: 'start' }} disabled={busy} onClick={async () => { setError(''); const r = await send<{ secret: string; uri: string }>('/v1/auth/2fa/setup', 'POST', {}); if (r.ok) setSetup(r.data!); else setError(r.message ?? 'Erro'); }}>Activar</button>}
        {!enabled && setup && (
          <form style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await run('/v1/auth/2fa/enable', 'POST', { code: f.get('code') }); }}>
            {qr && <img src={qr} alt="Código QR" width={200} height={200} />}
            <div style={{ display: 'grid', gap: 8 }}>
              <span>1. Na aplicação, adicione uma conta lendo o código QR<br />(ou escreva a chave: <code>{setup.secret}</code>)</span>
              <span>2. Escreva o código de 6 dígitos que aparece:</span>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required style={{ width: 140 }} />
              <button className="btn" disabled={busy} style={{ justifySelf: 'start' }}>Confirmar e activar</button>
            </div>
          </form>
        )}
        {enabled && !disabling && <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={() => setDisabling(true)}>Desactivar…</button>}
        {enabled && disabling && (
          <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await run('/v1/auth/2fa/disable', 'POST', { password: f.get('password'), code: f.get('code') }); }}>
            <input name="password" type="password" placeholder="Palavra-passe" required />
            <input name="code" inputMode="numeric" placeholder="Código actual" required style={{ width: 130 }} />
            <button className="btn danger" disabled={busy}>Desactivar</button>
          </form>
        )}
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
    </div>
  );
}
