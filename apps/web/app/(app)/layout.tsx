import Link from 'next/link';
import { longDate } from '@/lib/humane';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { canExportDocuments, luandaDate, trialDaysRemaining } from '@kianda/core';
import { DocumentExportAccess } from '@/components/document-export';

/** Área autenticada: sem sessão válida (verificada pela API), redirecciona para o login. */
/** Aviso de licença: experimental a terminar, pagamento em atraso ou só consulta. */
function LicenceBanner({ me }: { me: NonNullable<Awaited<ReturnType<typeof currentUser>>> }) {
  const l = me.licence;
  if (!l || !me.modules.hr.subscribed) return null;
  const manage = ['owner', 'finance'].includes(me.user.role);
  const link = manage ? <> <Link href="/licenca"><b>Ver planos</b></Link></> : null;
  if (!l.canWrite) return <div className="alert no-print">O RH está só para consulta ({l.label.toLowerCase()}). Pode ver tudo, mas não gravar, exportar nem imprimir. {manage ? 'Regularize a licença para voltar ao normal.' : 'Fale com quem gere a conta da empresa.'}{link}</div>;
  if (l.status === 'past_due') return <div className="warn no-print">O pagamento da licença está em atraso. Daqui a poucos dias a conta fica só para consulta.{link}</div>;
  if (l.status === 'trial' && l.trialEndsAt) {
    const days = trialDaysRemaining(l.trialEndsAt, luandaDate(new Date()));
    return <div className="trial-note no-print">{days === 1 ? 'Hoje é o último dia de experiência.' : `Está a experimentar o Kianda até ${longDate(l.trialEndsAt)}.`} Pode usar tudo; para exportar e imprimir, escolha um plano.{link}</div>;
  }
  return null;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/login');
  const counts = me.notifications ?? { absences: 0, expenses: 0, tasks: 0, acks: 0 };
  return <Suspense fallback={<div className="empty">A abrir o Kianda…</div>}>
    <DocumentExportAccess allowed={canExportDocuments(me.modules.hr.status)}><AppShell me={me} counts={counts}>
      <LicenceBanner me={me} />
      {children}
    </AppShell></DocumentExportAccess>
  </Suspense>;
}
