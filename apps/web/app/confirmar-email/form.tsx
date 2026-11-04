'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TRIAL_DAYS } from '@kianda/core';
import { AuthNavigation } from '../../components/auth-navigation';
import { KiandaMark } from '../../components/kianda-mark';
import { jsonRequest } from '../../lib/json-request';

export function ConfirmationForm({ token, signedIn }: { token: string | null; signedIn: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<{ email: string; deliveryEnabled: boolean } | null>(null);
  useEffect(() => {
    if (!signedIn || token) return;
    let active = true;
    void jsonRequest('/api/v1/auth/email-verification').then(({ res, body }) => {
      if (!active) return;
      if (res.ok) { setStatus({ email: String(body.email ?? ''), deliveryEnabled: Boolean(body.deliveryEnabled) }); if (!body.required) setConfirmed(true); }
      else setError(body.message ?? 'Não foi possível consultar a confirmação.');
    });
    return () => { active = false; };
  }, [signedIn, token]);
  async function call(path: string, payload: object = {}) {
    setBusy(true); setError(''); setMessage('');
    const result = await jsonRequest(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!result.res.ok) setError(result.body.message ?? 'Não foi possível concluir. Volte a tentar.');
    return result;
  }
  return <div className="auth-wrap"><section className="card auth" aria-labelledby="confirmation-title">
    <AuthNavigation login />
    <div className="logo" style={{ padding: 0, marginBottom: 18 }}><KiandaMark size={34} /><div><b>Kianda</b><small>RH · Integra · Valora</small></div></div>
    <h1 id="confirmation-title" style={{ fontSize: 20 }}>{confirmed ? 'Email confirmado' : 'Confirme o seu email'}</h1>
    {confirmed ? <><p>A sua conta está pronta. Pode experimentar os módulos e escolher os planos e o pagamento dentro da conta.</p><Link className="btn" href={signedIn ? '/modulos' : '/login'}>{signedIn ? 'Entrar nos módulos' : 'Iniciar sessão'}</Link></>
      : token ? <><p>Confirme este endereço para activar a sua conta. A ligação é de uso único e tem validade de 24 horas.</p><button className="btn" disabled={busy} onClick={async () => { const r = await call('/api/v1/public/email-verification', { token }); if (r.res.ok) setConfirmed(true); }}>{busy ? 'A confirmar…' : 'Confirmar o meu email'}</button></>
        : signedIn ? <><p>A conta da empresa foi criada. Abra o email de confirmação{status?.email ? ` de ${status.email}` : ''} e siga a ligação. Verifique também a pasta de spam.</p><p>O mês grátis ({TRIAL_DAYS} dias) começa quando confirmar o email. Durante o teste pode trabalhar e pré-visualizar os documentos; os downloads e a impressão exigem uma subscrição paga.</p>
          {status && !status.deliveryEnabled && <p className="warn">O envio de confirmações está temporariamente indisponível. A conta está guardada; tente novamente mais tarde ou contacte o suporte.</p>}
          <div className="actions"><button type="button" className="btn" disabled={busy} onClick={async () => { const r = await call('/api/v1/auth/email-verification/resend'); if (r.res.ok) setMessage(r.body.message); }}>{busy ? 'A enviar…' : 'Reenviar confirmação'}</button><button type="button" className="btn ghost" onClick={() => window.location.reload()}>Já confirmei o email</button></div></>
          : <p>Abra a ligação recebida por email ou <Link href="/login">inicie sessão</Link> para pedir uma nova confirmação.</p>}
    {message && <p role="status">{message}</p>}{error && <p className="alert" role="alert">{error}</p>}
  </section></div>;
}
