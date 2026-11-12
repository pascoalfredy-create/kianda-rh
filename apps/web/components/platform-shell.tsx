import Link from 'next/link';
import { KiandaMark } from './kianda-mark';
import { LogoutButton } from './logout-button';

export function PlatformShell({ current, children }: { current: 'platform' | 'account'; children: React.ReactNode }) {
  return <div className="platform-app">
    <header className="platform-header no-print">
      <div className="platform-brand"><KiandaMark size={34} /><b>Administração Kianda</b></div>
      <nav aria-label="Administração da plataforma">
        <Link href="/plataforma" aria-current={current === 'platform' ? 'page' : undefined}>Plataforma</Link>
        <Link href="/conta" aria-current={current === 'account' ? 'page' : undefined}>A minha conta</Link>
        <LogoutButton />
      </nav>
    </header>
    <main id="conteudo" className="content platform-content">{children}</main>
  </div>;
}
