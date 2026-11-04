'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function VagaIndisponivel() {
  const { company } = useParams<{ company: string }>();
  return <main style={{ maxWidth: 720, margin: '60px auto', padding: 20 }}><section className="card" style={{ padding: 24 }}><h1>Vaga indisponível</h1><p>Esta vaga já não está a receber candidaturas ou a ligação não está disponível.</p><div className="actions" style={{ justifyContent: 'flex-start' }}><Link className="btn" href={`/carreiras/${encodeURIComponent(company)}`}>Ver outras vagas</Link><Link className="btn ghost" href="/">Página inicial</Link></div></section></main>;
}
