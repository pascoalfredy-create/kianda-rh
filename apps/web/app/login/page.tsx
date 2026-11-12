'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { KiandaMark } from '@/components/kianda-mark';
import { AuthNavigation } from '../../components/auth-navigation';
import { jsonRequest } from '../../lib/json-request';
import { returnPath } from '../../lib/return-path';
import { PasswordInput } from '../../components/password-input';

function LoginForm() {
  const search = useSearchParams();
  const next = search.get('voltar') ?? '/';
  const platform = search.get('area') === 'plataforma';
  const [mode, setMode] = useState<'email' | 'pin'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyNif, setCompanyNif] = useState('');
  const [askNif, setAskNif] = useState(false);
  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [ticket, setTicket] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Código da empresa lembrado neste telemóvel (só depois de carregar, para não divergir do servidor).
  useEffect(() => { if (!platform) try { const c = localStorage.getItem('kianda_company_code'); if (c) { setCode(c); setMode('pin'); } } catch { /* sem armazenamento */ } }, [platform]);
  const go = (verify = false, admin = false) => window.location.assign(verify ? '/confirmar-email' : admin ? '/plataforma' : returnPath(next));

  async function call(url: string, payload: object) {
    setBusy(true);
    setError('');
    const { res, body } = await jsonRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    return { res, body };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ticket) {
      const { res, body } = await call('/api/v1/auth/login/2fa', { ticket, code: otp });
      if (res.ok) return go(body.requiresEmailVerification, body.platformAdmin);
      if (body.error === 'bilhete_expirado') setTicket('');
      return setError(body.message ?? 'Código incorrecto');
    }
    const { res, body } = platform || mode === 'email'
      ? await call('/api/v1/auth/login', { email, password, ...(platform ? { area: 'plataforma' } : companyNif ? { companyNif } : {}) })
      : await call('/api/v1/auth/login-pin', { companyCode: code.trim(), identifier, pin });
    if (res.ok && body.twoFactor) return setTicket(body.ticket);
    // Navegação completa: o layout raiz tem de ser re-renderizado com a sessão.
    if (res.ok) {
      try { if (!platform && mode === 'pin') localStorage.setItem('kianda_company_code', code.trim().toUpperCase()); } catch { /* sem armazenamento */ }
      return go(body.requiresEmailVerification, body.platformAdmin);
    }
    if (body.error === 'varias_empresas') setAskNif(true);
    setError(body.message ?? 'Não foi possível iniciar sessão.');
  }

  const tab = (m: 'email' | 'pin', label: string) => (
    <button type="button" onClick={() => { setMode(m); setError(''); }} style={{ flex: 1, padding: '8px 0', border: 0, borderBottom: `2px solid ${mode === m ? 'var(--brand)' : 'transparent'}`, background: 'none', fontWeight: 600, color: mode === m ? 'var(--brand)' : 'var(--ink2)', cursor: 'pointer' }}>{label}</button>
  );

  return (
    <form onSubmit={submit} className="card auth">
      <AuthNavigation />
      <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
        <KiandaMark size={34} />
        <div><b style={{ color: 'var(--ink)' }}>Kianda</b><small style={{ color: 'var(--ink3)' }}>{platform ? 'Administração da plataforma' : 'RH · Integra · Valora'}</small></div>
      </div>
      <h1 style={{ fontSize: 19, marginBottom: 14 }}>{ticket ? 'Verificação em dois passos' : platform ? 'Entrar na administração' : 'Iniciar sessão'}</h1>
      {ticket ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Abra a aplicação autenticadora no telemóvel e escreva o código de 6 dígitos do Kianda.</p>
          <label>Código<input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} required value={otp} onChange={(e) => setOtp(e.target.value)} /></label>
        </>
      ) : (
        <>
          {!platform && <div style={{ display: 'flex', marginBottom: 14, borderBottom: '1px solid var(--line)' }}>{tab('email', 'Email')}{tab('pin', 'Código da empresa + PIN')}</div>}
          {platform || mode === 'email' ? (
            <>
              <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label>Palavra-passe<PasswordInput aria-label="Palavra-passe" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              {!platform && askNif && <label>NIF da empresa<input inputMode="numeric" value={companyNif} onChange={(e) => setCompanyNif(e.target.value)} /></label>}
            </>
          ) : (
            <>
              <label>Código da empresa<input autoCapitalize="characters" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex.: P2N3HT" /></label>
              <label>N.º de colaborador ou telefone<input inputMode="tel" autoComplete="username" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></label>
              <label>PIN<input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} required value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            </>
          )}
        </>
      )}
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A entrar…' : ticket ? 'Confirmar' : 'Entrar'}</button>
      {ticket && <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setTicket(''); setOtp(''); setError(''); }}>Voltar ao início de sessão</button>}
      {!ticket && <p className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 12.5 }}>{platform || mode === 'email' ? <a href={platform ? '/recuperar?area=plataforma' : '/recuperar'}>Esqueceu-se da palavra-passe?</a> : 'Esqueceu-se do PIN? Peça aos Recursos Humanos uma ligação de recuperação.'}</p>}
      {!ticket && !platform && <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}>Empresa nova? <a href="/registo">Criar conta — um mês grátis</a></p>}
      {!ticket && <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}><a href={platform ? '/login' : '/login?area=plataforma'}>{platform ? 'Entrar numa conta de empresa' : 'Entrar na administração'}</a></p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-wrap">
      <Suspense fallback={<div className="card auth"><AuthNavigation /><p role="status">A carregar o início de sessão…</p></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
