'use client';

import { clearOfflineData } from '@/components/pwa';

export function LogoutButton({ label = 'Terminar sessão' }: { label?: string }) {
  return (
    <button
      className="link"
      onClick={async () => {
        await clearOfflineData();
        await fetch('/api/v1/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      {label}
    </button>
  );
}
