import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Check { code: string; severity: 'error' | 'warning' | 'info'; title: string; detail: string; employees: { id: string; name: string; note?: string }[] }
interface Compliance { sector: string | null; sectorLabel: string | null; checks: Check[]; notes: string[]; requiredDocuments: { type: string; label: string; reason: string; appliesToLabel: string }[]; employees: number }

const SEV: Record<Check['severity'], { label: string; cls: string }> = {
  error: { label: 'Corrigir', cls: 'st rejected' }, warning: { label: 'Atenção', cls: 'st pending' }, info: { label: 'Informação', cls: 'tag' },
};

export default async function Conformidade() {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role)) redirect('/');
  const c = await api<Compliance>('/v1/compliance');
  const order = { error: 0, warning: 1, info: 2 } as const;
  const checks = [...c.checks].sort((a, b) => order[a.severity] - order[b.severity]);
  const errors = checks.filter((x) => x.severity === 'error').length;
  const warnings = checks.filter((x) => x.severity === 'warning').length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conformidade</h1>
          <p className="sub">Verificações de {c.sectorLabel ?? 'todos os sectores'} sobre {c.employees} colaborador(es) activo(s)</p>
        </div>
        <Link className="btn ghost" href="/sector">Sector e regimes</Link>
      </div>
      <div className="grid">
        <div className="card kpi"><div className="l">Por corrigir</div><div className="v" style={{ color: errors ? 'var(--red)' : undefined }}>{errors}</div></div>
        <div className="card kpi"><div className="l">Avisos</div><div className="v" style={{ color: warnings ? 'var(--amber)' : undefined }}>{warnings}</div></div>
        <div className="card kpi"><div className="l">Documentos obrigatórios do sector</div><div className="v" style={{ fontSize: 15 }}>{c.requiredDocuments.map((d) => `${d.label} (${d.appliesToLabel})`).join(', ') || 'Nenhum específico'}</div></div>
      </div>
      {checks.length === 0 && <div className="card empty">Sem pendências. Os documentos, vistos e regimes de horário estão em ordem.</div>}
      {checks.map((x) => (
        <div key={x.code} className="card section">
          <div style={{ padding: '14px 16px 4px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={SEV[x.severity].cls}>{SEV[x.severity].label}</span><b>{x.title}</b>
          </div>
          <p className="muted" style={{ padding: '0 16px 8px' }}>{x.detail}</p>
          {x.employees.length > 0 && (
            <div style={{ padding: '0 16px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {x.employees.map((e) => <Link key={e.id} className="tag" href={`/colaboradores/${e.id}?s=${x.code.startsWith('doc') || x.code.startsWith('foreign') ? 'documentos' : 'regime'}`}>{e.name}{e.note ? ` · ${e.note}` : ''}</Link>)}
            </div>
          )}
        </div>
      ))}
      {c.notes.length > 0 && (
        <div className="card section">
          <h2>Obrigações do sector a confirmar</h2>
          <ul style={{ padding: '8px 16px 14px 34px', display: 'grid', gap: 4 }}>{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="muted" style={{ padding: '0 16px 14px', fontSize: 12.5 }}>Lista de verificação de apoio — não substitui o parecer de um jurista nem a consulta da legislação em vigor.</p>
        </div>
      )}
    </>
  );
}
