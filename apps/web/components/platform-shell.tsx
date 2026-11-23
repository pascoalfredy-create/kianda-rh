'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clearOfflineData } from '@/lib/session-client';
import { KiandaMark } from './kianda-mark';
import { LogoutButton } from './logout-button';

/** Um ecrã para cada bloco da consola, pela ordem do dia-a-dia da administração. */
const SECTIONS = [
  { href: '/plataforma', label: 'Visão geral' },
  { href: '/plataforma/empresas', label: 'Empresas' },
  { href: '/plataforma/pagamentos', label: 'Pagamentos' },
  { href: '/plataforma/visitas', label: 'Visitas ao site' },
  { href: '/plataforma/emails', label: 'Emails' },
  { href: '/plataforma/integracoes', label: 'Integrações' },
  { href: '/plataforma/definicoes', label: 'Definições' },
];

export function PlatformShell({ current, children }: { current: 'platform' | 'account'; children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    void clearOfflineData();
  }, []);
  const active = (href: string) =>
    href === '/plataforma' ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <div className="platform-app">
      <header className="platform-header no-print">
        <div className="platform-brand">
          <KiandaMark size={34} />
          <b>Administração Kianda</b>
        </div>
        <nav aria-label="Administração da plataforma">
          <Link href="/plataforma" aria-current={current === 'platform' ? 'page' : undefined}>
            Plataforma
          </Link>
          <Link href="/conta" aria-current={current === 'account' ? 'page' : undefined}>
            A minha conta
          </Link>
          <LogoutButton />
        </nav>
      </header>
      {current === 'platform' && (
        <nav className="platform-tabs no-print" aria-label="Secções da consola">
          {SECTIONS.map(s => (
            <Link key={s.href} href={s.href} aria-current={active(s.href) ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
      )}
      <main id="conteudo" className="content platform-content">
        {children}
      </main>
    </div>
  );
}
