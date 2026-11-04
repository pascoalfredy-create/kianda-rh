import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { upstream } from '@/lib/upstream';
import { KiandaMark } from '@/components/kianda-mark';
import { ApplyForm } from '../../apply';

export const dynamic = 'force-dynamic';
interface Opening { title: string; publicPath: string; location: string | null; contractType: string; positions: number; description: string | null; requirements: string | null; closesOn: string | null; department: string | null }
const readOpening = cache(async (company: string, opening: string) => {
  const res = await upstream(`/v1/public/careers/${encodeURIComponent(company)}/openings/${encodeURIComponent(opening)}`, { method: 'GET', cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Não foi possível carregar a vaga. Tente novamente.');
  return await res.json() as { company: string; opening: Opening };
});
type Props = { params: Promise<{ company: string; opening: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params, data = await readOpening(p.company, p.opening);
  if (!data) return { title: 'Vaga indisponível | Kianda', robots: { index: false, follow: false } };
  const description = `Candidate-se a ${data.opening.title} na ${data.company}. Consulte os requisitos e envie o seu currículo.`;
  return { title: `${data.opening.title} — ${data.company} | Kianda`, description, alternates: { canonical: data.opening.publicPath }, robots: { index: true, follow: true }, openGraph: { title: `${data.opening.title} — ${data.company}`, description, url: data.opening.publicPath, type: 'website' } };
}
const CONTRACT: Record<string, string> = { indefinite: 'Tempo indeterminado', fixed_term: 'Tempo determinado', internship: 'Estágio' };
export default async function PortalCandidatura({ params }: Props) {
  const p = await params, data = await readOpening(p.company, p.opening);
  if (!data) notFound();
  const o = data.opening;
  return <main style={{ maxWidth: 820, margin: '30px auto', padding: 20 }}>
    <nav aria-label="Navegação de candidaturas" className="actions" style={{ justifyContent: 'space-between', marginBottom: 24 }}><Link href="/" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><KiandaMark size={28} /> Kianda RH</Link><Link href={`/carreiras/${encodeURIComponent(p.company)}`}>← Todas as vagas</Link></nav>
    <p className="muted">Oportunidades · {data.company}</p><h1>{o.title}</h1>
    <p className="sub">{[o.department, o.location, CONTRACT[o.contractType], `${o.positions} lugar(es)`, o.closesOn && `Candidaturas até ${o.closesOn.split('-').reverse().join('/')}`].filter(Boolean).join(' · ')}</p>
    {(o.description || o.requirements) && <section className="card" style={{ padding: 20, marginBottom: 16 }}>{o.description && <><h2 style={{ fontSize: 17 }}>Sobre a função</h2><p style={{ whiteSpace: 'pre-wrap' }}>{o.description}</p></>}{o.requirements && <><h2 style={{ fontSize: 17 }}>Requisitos</h2><p style={{ whiteSpace: 'pre-wrap' }}>{o.requirements}</p></>}</section>}
    <section className="card" style={{ padding: 20 }} aria-label="Formulário de candidatura"><h2 style={{ fontSize: 18 }}>Candidatar-me</h2><p className="muted">Preencha os seus contactos e envie o currículo. Não precisa de criar uma conta.</p><ApplyForm company={p.company} openingId={p.opening} /></section>
  </main>;
}
