import { upstream } from '@/lib/upstream';
import { ApplyForm } from './apply';

export const dynamic = 'force-dynamic';

interface Opening { id: string; title: string; location: string | null; contractType: string; description: string | null; requirements: string | null; closesOn: string | null; department: string | null }
const CONTRACT: Record<string, string> = { indefinite: 'Tempo indeterminado', fixed_term: 'Tempo determinado', internship: 'Estágio' };

/** Página pública de carreiras da empresa. */
export default async function Carreiras({ params }: { params: Promise<{ company: string }> }) {
  const { company } = await params;
  const res = await upstream(`/v1/public/careers/${encodeURIComponent(company)}`, { method: 'GET' });
  if (!res.ok) return <main style={{ maxWidth: 720, margin: '60px auto', padding: 20 }}><div className="card empty">Página indisponível.</div></main>;
  const d = (await res.json()) as { company: string; openings: Opening[] };
  return (
    <main style={{ maxWidth: 820, margin: '40px auto', padding: 20 }}>
      <div className="muted">Carreiras</div>
      <h1 style={{ marginBottom: 6 }}>Trabalhe na {d.company}</h1>
      <p className="sub">{d.openings.length ? `${d.openings.length} vaga(s) em aberto` : 'De momento não há vagas abertas.'}</p>
      {d.openings.map((o) => (
        <details key={o.id} className="card" style={{ padding: 18, marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer' }}>
            <b style={{ fontSize: 16 }}>{o.title}</b>
            <div className="muted">{[o.department, o.location, CONTRACT[o.contractType], o.closesOn && `candidaturas até ${o.closesOn.split('-').reverse().join('/')}`].filter(Boolean).join(' · ')}</div>
          </summary>
          {o.description && <p style={{ whiteSpace: 'pre-wrap' }}>{o.description}</p>}
          {o.requirements && <><b>Requisitos</b><p style={{ whiteSpace: 'pre-wrap' }}>{o.requirements}</p></>}
          <ApplyForm company={company} openingId={o.id} />
        </details>
      ))}
      <p className="muted" style={{ marginTop: 30, fontSize: 12 }}>Os dados enviados são usados apenas neste processo de recrutamento. Plataforma Kianda RH.</p>
    </main>
  );
}
