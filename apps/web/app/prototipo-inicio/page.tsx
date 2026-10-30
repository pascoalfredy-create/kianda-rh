import type { Metadata } from 'next';
import { PublicHomeContent } from '@/components/public-home-content';

export const metadata: Metadata = { title: 'Proposta da página principal | Kianda', robots: { index: false, follow: false } };

/** Mantém o endereço da prévia partilhada, fora do índice de pesquisa. */
export default function PrototypePage() { return <PublicHomeContent preview />; }
