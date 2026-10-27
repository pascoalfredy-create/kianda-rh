'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function LoginForm() {
  const next = useSearchParams().get('voltar') ?? '/';
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
  useEffect(() => { try { const c = localStorage.getItem('kianda_company_code'); if (c) { setCode(c); setMode('pin'); } } catch { /* sem armazenamento */ } }, []);
  const go = () => window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');

  async function call(url: string, payload: object) {
    setBusy(true);
    setError('');
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    return { res, body };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ticket) {
      const { res, body } = await call('/api/v1/auth/login/2fa', { ticket, code: otp });
      if (res.ok) return go();
      if (body.error === 'bilhete_expirado') setTicket('');
      return setError(body.message ?? 'Código incorrecto');
    }
    const { res, body } = mode === 'email'
      ? await call('/api/v1/auth/login', { email, password, ...(companyNif ? { companyNif } : {}) })
      : await call('/api/v1/auth/login-pin', { companyCode: code.trim(), identifier, pin });
    if (res.ok && body.twoFactor) return setTicket(body.ticket);
    // Navegação completa: o layout raiz tem de ser re-renderizado com a sessão.
    if (res.ok) {
      try { if (mode === 'pin') localStorage.setItem('kianda_company_code', code.trim().toUpperCase()); } catch { /* sem armazenamento */ }
      return go();
    }
    if (body.error === 'varias_empresas') setAskNif(true);
    setError(body.message ?? 'Não foi possível iniciar sessão.');
  }

  const tab = (m: 'email' | 'pin', label: string) => (
    <button type="button" onClick={() => { setMode(m); setError(''); }} style={{ flex: 1, padding: '8px 0', border: 0, borderBottom: `2px solid ${mode === m ? 'var(--brand)' : 'transparent'}`, background: 'none', fontWeight: 600, color: mode === m ? 'var(--brand)' : 'var(--ink2)', cursor: 'pointer' }}>{label}</button>
  );

  return (
    <form onSubmit={submit} className="card auth">
      <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
        <div className="mark">K</div>
        <div><b style={{ color: 'var(--ink)' }}>Kianda RH</b><small style={{ color: 'var(--ink3)' }}>Gestão de Pessoas · Angola</small></div>
      </div>
      <h1 style={{ fontSize: 19, marginBottom: 14 }}>{ticket ? 'Verificação em dois passos' : 'Iniciar sessão'}</h1>
      {ticket ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Abra a aplicação autenticadora no telemóvel e escreva o código de 6 dígitos da Kianda RH.</p>
          <label>Código<input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} required value={otp} onChange={(e) => setOtp(e.target.value)} /></label>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', marginBottom: 14, borderBottom: '1px solid var(--line)' }}>{tab('email', 'Email')}{tab('pin', 'Código da empresa + PIN')}</div>
          {mode === 'email' ? (
            <>
              <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label>Palavra-passe<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              {askNif && <label>NIF da empresa<input inputMode="numeric" value={companyNif} onChange={(e) => setCompanyNif(e.target.value)} /></label>}
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
      {!ticket && <p className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 12.5 }}>Esqueceu-se do acesso? Peça aos Recursos Humanos uma ligação de recuperação.</p>}
      {!ticket && <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}>Empresa nova? <a href="/registo">Criar conta — 7 dias grátis</a></p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-wrap">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
