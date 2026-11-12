import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser, SESSION_COOKIE } from '@/lib/api';
import { PUBLIC_METADATA } from '@/lib/site';
import { PublicHome } from '@/components/public-home';
import AppLayout from './(app)/layout';
import Home from './(app)/home';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const signedIn = (await cookies()).has(SESSION_COOKIE) && await currentUser();
  return signedIn && !signedIn.user.requiresEmailVerification
    ? { title: signedIn.platformAdmin ? 'Plataforma Kianda' : 'Kianda RH', robots: { index: false, follow: false } }
    : PUBLIC_METADATA;
}

/** Visitantes conhecem os módulos; as sessões mantêm o mesmo painel e permissões. */
export default async function EntryPage() {
  const me = (await cookies()).has(SESSION_COOKIE) ? await currentUser() : null;
  if (me?.platformAdmin && !me.user.requiresEmailVerification) redirect('/plataforma');
  return me && !me.user.requiresEmailVerification ? <AppLayout><Home /></AppLayout> : <PublicHome />;
}
