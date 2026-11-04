import type { Metadata } from 'next';
import { currentUser } from '@/lib/api';
import { redirect } from 'next/navigation';
import { ConfirmationForm } from './form';

export const metadata: Metadata = { title: 'Confirmar email | Kianda', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ConfirmarEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams, me = await currentUser();
  const token = typeof params.token === 'string' ? params.token : null;
  if (me && !me.user.requiresEmailVerification && !token) redirect('/modulos');
  return <ConfirmationForm token={token} signedIn={Boolean(me)} />;
}
