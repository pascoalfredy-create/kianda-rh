import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';

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
  const counts = me.notifications ?? { absences: 0, expenses: 0 };
  return <Suspense fallback={<div className="empty">A abrir o Kianda…</div>}>
    <AppShell me={me} counts={counts}>
      <LicenceBanner me={me} />
      {children}
    </AppShell>
  </Suspense>;
}
