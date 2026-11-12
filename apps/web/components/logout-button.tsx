'use client';

import { useState } from 'react';
import { endSession } from '@/lib/session-client';

export function LogoutButton({ label = 'Terminar sessão' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
    <button
      type="button"
      className="link"
      disabled={busy}
      onClick={async () => {
        setBusy(true); setError('');
        try { await endSession(); }
        catch (e) { setError((e as Error).message); setBusy(false); }
      }}
    >
      {busy ? 'A terminar sessão…' : label}
    </button>
    {error && <small role="alert">{error}</small>}
    </>
  );
}
