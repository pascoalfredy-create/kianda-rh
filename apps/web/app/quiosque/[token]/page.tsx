import type { Metadata } from 'next';
import { KioskScreen } from './screen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Quiosque de ponto · Kianda', robots: { index: false, follow: false } };

/** Ecrã à entrada do local de trabalho (endereço secreto, sem sessão): QR e código que mudam a cada 30 s. */
export default async function Quiosque({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <KioskScreen token={token} />;
}
