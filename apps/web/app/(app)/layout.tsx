import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/types';
import { LogoutButton } from './logout-button';

const STAFF = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'];

/** Área autenticada: sem sessão válida (verificada pela API), redirecciona para o login. */
/** Aviso de licença: experimental a terminar, pagamento em atraso ou só consulta. */
function LicenceBanner({ me }: { me: NonNullable<Awaited<ReturnType<typeof currentUser>>> }) {
  const l = me.licence;
  if (!l || !me.modules.hr.subscribed) return null;
  const manage = ['owner', 'finance'].includes(me.user.role);
  const link = manage ? <> · <Link href="/licenca">Ver licença</Link></> : null;
  if (!l.canWrite) return <div className="alert no-print">Módulo RH em <b>modo de consulta</b> ({l.label.toLowerCase()}). {manage ? 'Regularize a licença do RH para voltar a gravar neste módulo.' : 'Fale com a administração da empresa.'}{link}</div>;
  if (l.status === 'past_due') return <div className="warn no-print">Pagamento da licença em atraso: a conta passa a modo de consulta em poucos dias.{link}</div>;
  if (l.status === 'trial' && l.trialEndsAt && manage) {
    const days = Math.max(0, Math.ceil((Date.parse(l.trialEndsAt) - Date.now()) / 86_400_000));
    return <div className="warn no-print">Período experimental: {days} dia(s) restante(s), até {l.trialEndsAt.split('-').reverse().join('/')}.{link}</div>;
  }
  return null;
}

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
          <Link href="/modulos">Módulos</Link>
          {me.modules.modeling.canAccess && <Link href="/modelagem">Modelagem Financeira</Link>}
          {me.modules.hr.canAccess && <>
          {staff && <Link href="/colaboradores">Colaboradores</Link>}
          {staff && <Link href="/organograma">Organograma</Link>}
          {!staff && me.user.employeeId && <Link href={`/colaboradores/${me.user.employeeId}`}>A minha ficha</Link>}
          {!staff && me.user.employeeId && <Link href="/portal/dados">Os meus dados</Link>}
          <Link href="/assiduidade">Assiduidade</Link>
          <Link href="/ausencias">Ausências e férias</Link>
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/processamento">Processamento</Link>}
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/obrigacoes">Obrigações</Link>}
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/relatorios">Relatórios</Link>}
          {['owner', 'payroll', 'finance', 'hr_admin'].includes(me.user.role) && <Link href="/orcamento">Orçamento de pessoal</Link>}
          {['owner', 'payroll', 'finance'].includes(me.user.role) && <Link href="/financas">Finanças de pessoal</Link>}
          {['owner', 'payroll', 'finance'].includes(me.user.role) && <Link href="/conciliacao">Conciliação bancária</Link>}
          <Link href="/despesas">Despesas</Link>
          {(me.user.employeeId || ['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role)) && <Link href="/adiantamentos">Adiantamentos</Link>}
          <Link href="/documentos">Documentos</Link>
          {['owner', 'hr_admin', 'manager'].includes(me.user.role) && <Link href="/recrutamento">Recrutamento</Link>}
          <Link href="/desempenho">Desempenho</Link>
          {['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role) && <Link href="/cessacoes">Cessações</Link>}
          {me.user.employeeId && <Link href="/recibos">Os meus recibos</Link>}
          <Link href="/simulador">Simulador salarial</Link>
          {(me.user.role === 'owner' || me.user.role === 'hr_admin') && <Link href="/pedidos">Pedidos do portal</Link>}
          {['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role) && <Link href="/sector">Sector e regimes</Link>}
          {['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role) && <Link href="/conformidade">Conformidade</Link>}
          </>}
          {(me.user.role === 'owner' || me.user.role === 'hr_admin') && <Link href="/acessos">Utilizadores e acessos</Link>}
          {(me.user.role === 'owner' || me.user.role === 'hr_admin') && <Link href="/definicoes">Definições</Link>}
          {['owner', 'finance'].includes(me.user.role) && <Link href="/licenca">Módulos e licenças</Link>}
          {me.platformAdmin && <Link href="/plataforma">Plataforma Kianda</Link>}
        </nav>
        <div className="who">
          <b>{me.user.name}</b>
          <small>{ROLE_LABEL[me.user.role] ?? me.user.role}</small>
          <Link href="/conta" style={{ display: 'block', fontSize: 12.5, marginBottom: 4 }}>A minha conta</Link>
          <LogoutButton />
        </div>
      </aside>
      <main className="content">
        <LicenceBanner me={me} />
        {children}
      </main>
      {/* Telemóvel: barra inferior com as acções do dia-a-dia */}
      <nav className="mobile-nav">
        <Link href="/">Início</Link>
        {!me.modules.hr.canAccess && <Link href="/modulos">Módulos</Link>}
        {!me.modules.hr.canAccess && me.modules.modeling.canAccess && <Link href="/modelagem">Modelagem</Link>}
        {me.modules.hr.canAccess && <>
        <Link href="/assiduidade">Ponto</Link>
        <Link href="/ausencias">Ausências</Link>
        {staff ? <Link href="/despesas">Despesas</Link> : <Link href="/recibos">Recibos</Link>}
        {staff ? <Link href="/colaboradores">Equipa</Link> : me.user.employeeId ? <Link href="/portal/dados">Dados</Link> : null}
        </>}
        <LogoutButton label="Sair" />
      </nav>
    </div>
  );
}
