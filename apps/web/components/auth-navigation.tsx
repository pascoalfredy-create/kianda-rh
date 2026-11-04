import Link from 'next/link';

/** Acesso sempre visível à página inicial, incluindo na aplicação instalada sem barra do navegador. */
export function AuthNavigation({ login = false }: { login?: boolean }) {
  return <nav className="auth-navigation" aria-label="Navegação da conta">
    <Link href="/" prefetch={false}>← Página inicial</Link>
    {login && <Link href="/login" prefetch={false}>Iniciar sessão</Link>}
  </nav>;
}
