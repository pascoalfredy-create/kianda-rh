import type { Metadata } from 'next';
import { HomePrototype } from '@/components/home-prototype';

export const metadata: Metadata = { title: 'Proposta da página principal | Kianda', robots: { index: false, follow: false } };

/** Prévia isolada para revisão do proprietário; não substitui a página inicial. */
export default function PrototypePage() { return <HomePrototype />; }
