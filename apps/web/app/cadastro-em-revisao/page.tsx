import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { RegistrationChecklist, type RegistrationData } from '@/components/registration-checklist';

export const metadata = { title: 'Cadastro em revisão | Kianda', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CadastroEmRevisao() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.user.requiresEmailVerification) redirect('/confirmar-email');
  if (!me.company?.registrationReviewRequired) redirect('/modulos');
  const data = await api<RegistrationData>('/v1/registration');
  return (
    <main className="auth-wrap">
      <div className="card auth" style={{ maxWidth: 620 }}>
        <h1>Cadastro em revisão</h1>
        <p className="muted">{me.company.name} · Antes de abrir os módulos, reveja os pontos abaixo.</p>
        <RegistrationChecklist data={data} companyName={me.company.name} />
        <p className="muted">Recebe um email quando o cadastro for aprovado.</p>
        <Link className="btn" href="/modulos">
          Verificar aprovação
        </Link>
        <Link className="link" href="/">
          Voltar à página inicial
        </Link>
      </div>
    </main>
  );
}
