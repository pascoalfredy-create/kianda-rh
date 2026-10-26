import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/types';
import { LogoutButton } from './logout-button';

const STAFF = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'];

/** Área autenticada: sem sessão válida (verificada pela API), redirecciona para o login. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/login');
  const staff = STAFF.includes(me.user.role);
  return (
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
          <Link href="/assiduidade">Assiduidade</Link>
          <Link href="/ausencias">Ausências e férias</Link>
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/processamento">Processamento</Link>}
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/obrigacoes">Obrigações</Link>}
          {['owner', 'payroll', 'finance'].includes(me.user.role) && <Link href="/financas">Finanças de pessoal</Link>}
          {['owner', 'payroll', 'finance'].includes(me.user.role) && <Link href="/conciliacao">Conciliação bancária</Link>}
          <Link href="/despesas">Despesas</Link>
          {me.user.employeeId && <Link href="/recibos">Os meus recibos</Link>}
          <Link href="/simulador">Simulador salarial</Link>
          {(me.user.role === 'owner' || me.user.role === 'hr_admin') && <Link href="/definicoes">Definições</Link>}
        </nav>
        <div className="who">
          <b>{me.user.name}</b>
          <small>{ROLE_LABEL[me.user.role] ?? me.user.role}</small>
          <LogoutButton />
        </div>
      </aside>
      <main className="content">{children}</main>
      {/* Telemóvel: barra inferior com as acções do dia-a-dia */}
      <nav className="mobile-nav">
        <Link href="/">Início</Link>
        <Link href="/assiduidade">Ponto</Link>
        <Link href="/ausencias">Ausências</Link>
        <Link href="/despesas">Despesas</Link>
        {staff ? <Link href="/colaboradores">Equipa</Link> : me.user.employeeId ? <Link href={`/colaboradores/${me.user.employeeId}`}>Ficha</Link> : null}
        <LogoutButton label="Sair" />
      </nav>
    </div>
  );
}
