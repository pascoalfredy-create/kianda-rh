import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';

export const metadata = { title: 'Cadastro em revisão | Kianda', robots: { index: false, follow: false } };

export default async function CadastroEmRevisao() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.user.requiresEmailVerification) redirect('/confirmar-email');
  if (!me.company?.registrationReviewRequired) redirect('/modulos');
  return (
    <main className="auth-wrap">
      <div className="card auth">
        <h1>Cadastro em revisão</h1>
        <p>Precisamos de confirmar os dados de {me.company.name} antes de disponibilizar os módulos.</p>
        <p>Contacte o suporte Kianda e indique o nome da empresa e o NIF {me.company.nif}.</p>
        {me.company.registrationDataIssues?.map(issue => (
          <p key={issue}>{issue}</p>
        ))}
        <p>Depois da aprovação, poderá continuar com a sua conta.</p>
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
