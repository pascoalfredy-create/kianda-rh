'use client';

export function LogoutButton() {
  return (
    <button
      className="link"
      onClick={async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      Terminar sessão
    </button>
  );
}
