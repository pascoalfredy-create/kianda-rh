'use client';

import { useState } from 'react';
import { KiandaMark } from '@/components/kianda-mark';
import { AuthNavigation } from '../../components/auth-navigation';
import { jsonRequest } from '../../lib/json-request';

/** Esqueci a palavra-passe: envia por email uma ligação de uso único (1 hora). Colaboradores com PIN pedem ao RH. */
export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; emailEnabled: boolean } | null>(null);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { res, body } = await jsonRequest('/api/v1/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    setBusy(false);
    if (res.ok) setDone({ message: body.message, emailEnabled: body.emailEnabled === true });
    else setError(body.message ?? (res.status === 429 ? 'Demasiados pedidos. Tente mais tarde.' : 'Não foi possível enviar o pedido.'));
  }

  return (
    <div className="auth-wrap">
      <form onSubmit={submit} className="card auth">
        <AuthNavigation login />
        <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
          <KiandaMark size={34} />
          <div><b style={{ color: 'var(--ink)' }}>Kianda</b><small style={{ color: 'var(--ink3)' }}>RH · Integra · Valora</small></div>
        </div>
        <h1 style={{ fontSize: 19, marginBottom: 6 }}>Recuperar a palavra-passe</h1>
        {done ? (
          <div className="warn" role="status" style={{ marginTop: 10, ...(done.emailEnabled ? { background: 'var(--green-soft, #e8f5ee)', color: '#1d5c3a' } : {}) }}>{done.message}</div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Escreva o email com que entra no Kianda. Se o envio de email estiver activo, receberá uma ligação para definir uma nova palavra-passe.</p>
            <label>Email<input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {error && <div className="alert" role="alert">{error}</div>}
            <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A enviar…' : 'Enviar ligação'}</button>
          </>
        )}
        <p className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 12.5 }}>Entra com PIN ou perdeu o telemóvel da verificação em dois passos? Peça aos Recursos Humanos uma ligação de recuperação.</p>
        <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}><a href="/login">Voltar ao início de sessão</a></p>
      </form>
    </div>
  );
}
