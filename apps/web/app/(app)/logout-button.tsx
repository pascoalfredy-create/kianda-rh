'use client';

export function LogoutButton({ label = 'Terminar sessão' }: { label?: string }) {
  return (
    <button
      className="link"
      onClick={async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      {label}
    </button>
  );
}
