import Link from 'next/link';
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
  const link = manage ? <> · <Link href="/licenca">Ver licença</Link></> : null;
  if (!l.canWrite) return <div className="alert no-print">Módulo RH em <b>modo de consulta</b> ({l.label.toLowerCase()}). Documentos apenas em pré-visualização. {manage ? 'Regularize a licença do RH para gravar, exportar e imprimir.' : 'Fale com a administração da empresa.'}{link}</div>;
  if (l.status === 'past_due') return <div className="warn no-print">Pagamento da licença em atraso: a conta passa a modo de consulta em poucos dias.{link}</div>;
  if (l.status === 'trial' && l.trialEndsAt) {
    const days = trialDaysRemaining(l.trialEndsAt, luandaDate(new Date()));
    return <div className="warn no-print">Período experimental: {days === 1 ? 'último dia' : `${days} dias de calendário, incluindo hoje`}, até {l.trialEndsAt.split('-').reverse().join('/')} inclusive, pela hora de Angola. Pode trabalhar e pré-visualizar os documentos; exportar e imprimir exige uma subscrição paga.{link}</div>;
  }
  return null;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  if (!me) redirect('/login');
  const counts = me.notifications ?? { absences: 0, expenses: 0 };
  return <Suspense fallback={<div className="empty">A abrir o Kianda…</div>}>
    <DocumentExportAccess allowed={canExportDocuments(me.modules.hr.status)}><AppShell me={me} counts={counts}>
      <LicenceBanner me={me} />
      {children}
    </AppShell></DocumentExportAccess>
  </Suspense>;
}
