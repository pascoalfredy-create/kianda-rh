'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function PasswordForm() {
  const { busy, error, setError, run } = useMutation();
  const [ok, setOk] = useState('');
  return (
    <form className="card form" style={{ maxWidth: 520, gridTemplateColumns: '1fr' }} onSubmit={async (e) => {
      e.preventDefault();
      setOk('');
      const f = new FormData(e.currentTarget);
      if (f.get('next') !== f.get('next2')) return setError('A confirmação não coincide');
      if (await run('/v1/auth/password', 'POST', { current: f.get('current'), next: f.get('next') })) { setOk('Palavra-passe alterada.'); (e.target as HTMLFormElement).reset(); }
    }}>
      <h3>Alterar palavra-passe</h3>
      <label>Palavra-passe actual<input name="current" type="password" required autoComplete="current-password" /></label>
      <label>Nova palavra-passe<input name="next" type="password" required minLength={10} autoComplete="new-password" /></label>
      <label>Confirmar nova palavra-passe<input name="next2" type="password" required autoComplete="new-password" /></label>
      <div className="form-actions">{error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}<button className="btn" disabled={busy}>Alterar</button></div>
    </form>
  );
}
