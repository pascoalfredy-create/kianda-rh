import { api, currentUser } from '@/lib/api';
import { redirect } from 'next/navigation';
import { PlatformShell } from '@/components/platform-shell';
import { TwoFactor } from './two-factor';
import { EndSessions, PasswordForm } from './form';
import { PushSettings } from '@/components/push-settings';
import AppLayout from '../(app)/layout';

export const dynamic = 'force-dynamic';

export default async function Conta() {
  const me = await currentUser();
  if (!me) redirect('/login?voltar=/conta');
  if (me.user.requiresEmailVerification) redirect('/confirmar-email');
  const tf = await api<{ enabled: boolean; recommended: boolean }>('/v1/auth/2fa');
  const content = (
    <>
      <h1>A minha conta</h1>
      <p className="sub">{me.user.name} · {me.platformAdmin ? 'Administração da plataforma' : me.company?.name}</p>
      <PasswordForm />
      <div style={{ height: 16 }} />
      <EndSessions />
      <div style={{ height: 16 }} />
      <TwoFactor enabled={tf.enabled} recommended={tf.recommended} />
      {!me.platformAdmin && <><div style={{ height: 16 }} /><PushSettings /></>}
    </>
  );
  return me.platformAdmin ? <PlatformShell current="account">{content}</PlatformShell> : <AppLayout>{content}</AppLayout>;
}
