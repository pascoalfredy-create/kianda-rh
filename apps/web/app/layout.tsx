import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/types';
import { LogoutButton } from './logout-button';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kianda RH',
  description: 'Gestão de pessoas, payroll e finanças de pessoal para empresas angolanas',
};

const STAFF = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) {
    return (
      <html lang="pt">
        <body>{children}</body>
      </html>
    );
  }
  const staff = STAFF.includes(me.user.role);
  return (
    <html lang="pt">
      <body>
        <div className="app">
          <aside className="side">
            <div className="logo">
              <div className="mark">K</div>
              <div>
                <b>Kianda RH</b>
                <small>{me.company?.name}</small>
              </div>
            </div>
            <nav>
              <Link href="/">Início</Link>
              {staff && <Link href="/colaboradores">Colaboradores</Link>}
              {staff && <Link href="/organograma">Organograma</Link>}
              {!staff && me.user.employeeId && <Link href={`/colaboradores/${me.user.employeeId}`}>A minha ficha</Link>}
              <Link href="/simulador">Simulador salarial</Link>
            </nav>
            <div className="who">
              <b>{me.user.name}</b>
              <small>{ROLE_LABEL[me.user.role] ?? me.user.role}</small>
              <LogoutButton />
            </div>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
