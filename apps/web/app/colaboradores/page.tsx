import { formatKz } from '@kianda/core';
import { api, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface EmployeeRow {
  id: string;
  number: string;
  name: string;
  jobTitle: string;
  department: string | null;
  contract: { type: string; baseMinor: number; endDate: string | null } | null;
  alerts: string[];
}

const contractLabel: Record<string, string> = { indefinite: 'Indeterminado', fixed_term: 'A termo', internship: 'Estágio' };

export default async function Colaboradores() {
  let rows: EmployeeRow[] = [];
  let error = '';
  try {
    rows = await api<EmployeeRow[]>('/v1/employees');
  } catch (e) {
    error = e instanceof ApiError && e.status === 403 ? 'O seu perfil não permite consultar a lista de colaboradores.' : `Não foi possível contactar a API: ${(e as Error).message}`;
  }
  return (
    <>
      <h1>Colaboradores</h1>
      <p className="sub">{rows.length} registo(s) · alertas de contrato e de salário mínimo calculados pelo motor</p>
      {error && <div className="alert">{error}</div>}
      {!error && (
        <div className="card">
          <table>
            <thead><tr><th>N.º</th><th>Nome</th><th>Departamento</th><th>Contrato</th><th className="num">Salário base</th><th>Alertas</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{e.number}</td>
                  <td><b>{e.name}</b><div className="muted">{e.jobTitle}</div></td>
                  <td>{e.department ?? '—'}</td>
                  <td>{e.contract ? contractLabel[e.contract.type] : '—'}{e.contract?.endDate ? ` · até ${e.contract.endDate}` : ''}</td>
                  <td className="num">{e.contract ? formatKz(e.contract.baseMinor) : '—'}</td>
                  <td>{e.alerts.map((a) => <span key={a} className="pill">{a}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
