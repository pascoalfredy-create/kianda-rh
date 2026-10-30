import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { currentUser, SESSION_COOKIE } from '@/lib/api';
import { PUBLIC_METADATA } from '@/lib/site';
import { PublicHome } from '@/components/public-home';
import AppLayout from './(app)/layout';
import Home from './(app)/home';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const signedIn = (await cookies()).has(SESSION_COOKIE) && await currentUser();
  return signedIn ? { title: 'Kianda RH', robots: { index: false, follow: false } } : PUBLIC_METADATA;
}

/** Visitantes conhecem os módulos; as sessões mantêm o mesmo painel e permissões. */
export default async function EntryPage() {
  const me = (await cookies()).has(SESSION_COOKIE) ? await currentUser() : null;
  return me ? <AppLayout><Home /></AppLayout> : <PublicHome />;
}
