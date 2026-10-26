import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { OrgNode } from '@/lib/types';

export const dynamic = 'force-dynamic';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const countAll = (n: OrgNode): number => n.reports.reduce((s, r) => s + 1 + countAll(r), 0);

function Branch({ nodes }: { nodes: OrgNode[] }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={`/colaboradores/${n.id}?s=equipa`} className="node">
            <div className="avatar sm">{initials(n.name)}</div>
            <div><b>{n.name}</b><small>{n.jobTitle}{n.department ? ` · ${n.department}` : ''}</small></div>
            {n.reports.length > 0 && <span className="count">{countAll(n)} na equipa</span>}
          </Link>
          {n.reports.length > 0 && <Branch nodes={n.reports} />}
        </li>
      ))}
    </ul>
  );
}

export default async function Organograma() {
  let tree: OrgNode[] = [];
  let error = '';
  try {
    tree = await api<OrgNode[]>('/v1/org-chart');
  } catch (e) {
    error = e instanceof ApiError && e.status === 403 ? 'O seu perfil não permite consultar o organograma.' : (e as Error).message;
  }
  const withTeams = tree.filter((n) => n.reports.length);
  const loose = tree.filter((n) => !n.reports.length);
  return (
    <>
      <h1>Organograma</h1>
      <p className="sub">Construído a partir da chefia directa de cada ficha. Para alterar, edite a chefia na ficha do colaborador.</p>
      {error && <div className="alert">{error}</div>}
      {withTeams.length > 0 && <div className="card org" style={{ marginBottom: 16 }}><Branch nodes={withTeams} /></div>}
      {loose.length > 0 && (
        <div className="card section">
          <h2>Sem chefia nem equipa atribuídas ({loose.length})</h2>
          <div className="org"><Branch nodes={loose} /></div>
        </div>
      )}
    </>
  );
}
