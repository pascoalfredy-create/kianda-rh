import { api, currentUser } from '@/lib/api';
import { TwoFactor } from './two-factor';
import { PasswordForm } from './form';

export const dynamic = 'force-dynamic';

export default async function Conta() {
  const me = (await currentUser())!;
  const tf = await api<{ enabled: boolean; recommended: boolean }>('/v1/auth/2fa');
  return (
    <>
      <h1>A minha conta</h1>
      <p className="sub">{me.user.name} · {me.company?.name}</p>
      <PasswordForm />
      <div style={{ height: 16 }} />
      <TwoFactor enabled={tf.enabled} recommended={tf.recommended} />
    </>
  );
}
