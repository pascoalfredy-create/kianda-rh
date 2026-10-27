import { currentUser } from '@/lib/api';
import { PasswordForm } from './form';

export const dynamic = 'force-dynamic';

export default async function Conta() {
  const me = (await currentUser())!;
  return (
    <>
      <h1>A minha conta</h1>
      <p className="sub">{me.user.name} · {me.company?.name}</p>
      <PasswordForm />
    </>
  );
}
