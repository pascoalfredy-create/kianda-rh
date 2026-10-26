'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const next = useSearchParams().get('voltar') ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyNif, setCompanyNif] = useState('');
  const [askNif, setAskNif] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, ...(companyNif ? { companyNif } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    // Navegação completa: o layout raiz tem de ser re-renderizado com a sessão.
    if (res.ok) return window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');
    if (body.error === 'varias_empresas') setAskNif(true);
    setError(body.message ?? 'Não foi possível iniciar sessão.');
  }

  return (
    <form onSubmit={submit} className="card auth">
      <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
        <div className="mark">K</div>
        <div><b style={{ color: 'var(--ink)' }}>Kianda RH</b><small style={{ color: 'var(--ink3)' }}>Gestão de Pessoas · Angola</small></div>
      </div>
      <h1 style={{ fontSize: 19, marginBottom: 14 }}>Iniciar sessão</h1>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Palavra-passe<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {askNif && <label>NIF da empresa<input inputMode="numeric" value={companyNif} onChange={(e) => setCompanyNif(e.target.value)} /></label>}
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A entrar…' : 'Entrar'}</button>
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
