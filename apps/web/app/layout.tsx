import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kianda RH',
  description: 'Gestão de pessoas, payroll e finanças de pessoal para empresas angolanas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>
        <div className="app">
          <aside className="side">
            <div className="logo">
              <div className="mark">K</div>
              <div>
                <b>Kianda RH</b>
                <small>Gestão de Pessoas · Angola</small>
              </div>
            </div>
            <nav>
              <Link href="/">Início</Link>
              <Link href="/colaboradores">Colaboradores</Link>
              <Link href="/simulador">Simulador salarial</Link>
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
