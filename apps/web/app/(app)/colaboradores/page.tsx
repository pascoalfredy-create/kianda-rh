import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api, ApiError, currentUser } from '@/lib/api';
import { CAN_EDIT, CONTRACT_LABEL, STATUS_LABEL, type EmployeeRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function Colaboradores({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string }> }) {
  const { q = '', estado = 'activos' } = await searchParams;
  const me = await currentUser();
  let rows: EmployeeRow[] = [];
  let error = '';
  try {
    rows = await api<EmployeeRow[]>('/v1/employees');
  } catch (e) {
    error = e instanceof ApiError && e.status === 403 ? 'O seu perfil não permite consultar a lista de colaboradores.' : `Não foi possível contactar a API: ${(e as Error).message}`;
  }
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((e) => (estado === 'todos' ? true : estado === 'cessados' ? e.status === 'terminated' : e.status !== 'terminated'))
    .filter((e) => !needle || [e.name, e.number, e.jobTitle, e.department ?? ''].some((v) => v.toLowerCase().includes(needle)));
  const withAlerts = shown.filter((e) => e.alerts.length).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Colaboradores</h1>
          <p className="sub">{shown.length} registo(s){withAlerts ? ` · ${withAlerts} com pontos a tratar` : ''}</p>
        </div>
        {CAN_EDIT.includes(me?.user.role ?? '') && <Link href="/colaboradores/novo" className="btn">Novo colaborador</Link>}
      </div>
      {error && <div className="alert">{error}</div>}
      {!error && (
        <>
          <form className="card form" style={{ marginBottom: 14, gridTemplateColumns: '1fr 200px auto' }}>
            <label>Pesquisar<input name="q" defaultValue={q} placeholder="Nome, n.º, função ou departamento" /></label>
            <label>Situação
              <select name="estado" defaultValue={estado}>
                <option value="activos">Activos e suspensos</option>
                <option value="cessados">Cessados</option>
                <option value="todos">Todos</option>
              </select>
            </label>
            <button className="btn ghost">Filtrar</button>
          </form>
          <div className="card">
            <table>
              <thead><tr><th>N.º</th><th>Nome</th><th>Departamento</th><th>Contrato</th><th className="num">Salário base</th><th>Alertas</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.number}</td>
                    <td>
                      <Link href={`/colaboradores/${e.id}`}><b>{e.name}</b></Link>
                      {e.status !== 'active' && <span className={`status ${e.status}`}>{STATUS_LABEL[e.status]}</span>}
                      <div className="muted">{e.jobTitle}</div>
                    </td>
                    <td>{e.department ?? '—'}</td>
                    <td>{e.contract ? CONTRACT_LABEL[e.contract.type] : '—'}{e.contract?.endDate ? ` · até ${e.contract.endDate.split('-').reverse().join('/')}` : ''}</td>
                    <td className="num">{e.contract ? formatKz(e.contract.baseMinor) : '—'}</td>
                    <td>{e.alerts.map((a) => <span key={a} className="pill">{a}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty">Nenhum colaborador encontrado</div>}
          </div>
        </>
      )}
    </>
  );
}
