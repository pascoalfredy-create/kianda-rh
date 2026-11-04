'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function ErroCandidatura({ reset }: { reset: () => void }) {
  const { company } = useParams<{ company: string }>();
  return <main style={{ maxWidth: 720, margin: '60px auto', padding: 20 }}><section className="card" style={{ padding: 24 }}><h1>Não foi possível carregar a vaga</h1><p>Verifique a ligação e volte a tentar.</p><div className="actions" style={{ justifyContent: 'flex-start' }}><button className="btn" onClick={reset}>Tentar novamente</button><Link className="btn ghost" href={`/carreiras/${encodeURIComponent(company)}`}>Ver outras vagas</Link><Link href="/">Página inicial</Link></div></section></main>;
}
