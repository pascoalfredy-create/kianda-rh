'use client';

import { use, useEffect, useState } from 'react';

interface Info { kind: 'invite' | 'reset'; company: string; companyCode: string; role: string; roleLabel: string; name: string | null; number: string | null; email: string | null; phone: string | null; hasPin: boolean; pinAllowed: boolean; expiresAt: string }

/** Aceitar um convite ou recuperar o acesso: escolhe email + palavra-passe ou PIN. */
export default function Acesso({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [failure, setFailure] = useState('');
  const [method, setMethod] = useState<'password' | 'pin'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/v1/public/access/${token}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setFailure(j.message ?? 'Ligação inválida');
      setInfo(j);
      setMethod(j.pinAllowed && (!j.email || j.hasPin) ? 'pin' : 'password');
    });
  }, [token]);
  if (failure) return <div className="auth-wrap"><div className="card auth"><h1 style={{ fontSize: 19 }}>Ligação indisponível</h1><p>{failure}</p><a href="/login">Ir para o início de sessão</a></div></div>;
  if (!info) return <div className="auth-wrap"><div className="card auth">A carregar…</div></div>;
  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (method === 'password' && f.get('password') !== f.get('password2')) return setError('As palavras-passe não coincidem');
        if (method === 'pin' && f.get('pin') !== f.get('pin2')) return setError('Os PINs não coincidem');
        setBusy(true); setError('');
        const res = await fetch(`/api/v1/public/access/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(method === 'password' ? { method, email: f.get('email'), password: f.get('password') } : { method, pin: f.get('pin'), phone: f.get('phone') || null }) });
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(j.issues?.map((i: { message: string }) => i.message).join(' · ') || j.message || 'Não foi possível concluir');
        try { localStorage.setItem('kianda_company_code', info.companyCode); } catch { /* sem armazenamento */ }
        window.location.assign('/');
      }}>
        <div className="logo" style={{ padding: 0, marginBottom: 14 }}>
          <div className="mark">K</div>
          <div><b style={{ color: 'var(--ink)' }}>Kianda RH</b><small style={{ color: 'var(--ink3)' }}>{info.company}</small></div>
        </div>
        <h1 style={{ fontSize: 19, marginBottom: 4 }}>{info.kind === 'invite' ? `Bem-vindo(a)${info.name ? `, ${info.name.split(' ')[0]}` : ''}` : 'Recuperar acesso'}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{info.kind === 'invite' ? `Foi convidado(a) para a ${info.company} como ${info.roleLabel.toLowerCase()}. Escolha como vai entrar.` : 'Defina uma nova forma de entrar.'}</p>
        {info.pinAllowed && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className={method === 'pin' ? 'btn sm' : 'btn ghost sm'} onClick={() => setMethod('pin')}>PIN (sem email)</button>
            <button type="button" className={method === 'password' ? 'btn sm' : 'btn ghost sm'} onClick={() => setMethod('password')}>Email e palavra-passe</button>
          </div>
        )}
        {method === 'password' ? (
          <>
            <label>Email<input name="email" type="email" required defaultValue={info.email ?? ''} autoComplete="username" /></label>
            <label>Palavra-passe<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
            <label>Confirmar palavra-passe<input name="password2" type="password" required autoComplete="new-password" /></label>
            <p className="muted" style={{ fontSize: 12.5 }}>Pelo menos 10 caracteres, com letras e números.</p>
          </>
        ) : (
          <>
            <div className="warn" style={{ margin: '0 0 12px' }}>Para entrar vai usar: código da empresa <b>{info.companyCode}</b> + {info.number ? <>o seu n.º <b>{info.number}</b> ou </> : null}o seu telefone + o PIN.</div>
            {!info.phone && <label>Telefone<input name="phone" inputMode="tel" placeholder="9XX XXX XXX" /></label>}
            <label>PIN (6 dígitos)<input name="pin" type="password" inputMode="numeric" required minLength={6} maxLength={6} autoComplete="new-password" /></label>
            <label>Confirmar PIN<input name="pin2" type="password" inputMode="numeric" required maxLength={6} autoComplete="new-password" /></label>
            <p className="muted" style={{ fontSize: 12.5 }}>Não use datas de nascimento nem sequências como 123456.</p>
          </>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A guardar…' : 'Guardar e entrar'}</button>
        <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 10 }}>Ligação válida até {new Date(info.expiresAt).toLocaleDateString('pt-PT')}.</p>
      </form>
    </div>
  );
}
