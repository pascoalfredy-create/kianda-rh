import Link from 'next/link';
import { describeLocation, mapLink } from '@/lib/punch-location-text';
import type { LocationIssueRow as IssueRow } from '@/lib/types';

const hour = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' }) : '—');
const day = (d: string) => d.split('-').reverse().join('/');

/** Marcações aceites com problema de localização (regras «alertar» e «bloquear»), para a chefia confirmar. */
export function LocationIssues({ rows }: { rows: IssueRow[] }) {
  if (!rows.length) return null;
  const cell = (time: string | null, l: IssueRow['clockInLocation']) => {
    const map = mapLink(l);
    return <>{hour(time)}{l && <div className="muted" style={{ fontSize: 12 }}>{describeLocation(l)}{map && <> · <a href={map} target="_blank" rel="noreferrer">mapa</a></>}</div>}</>;
  };
  return (
    <div className="card section" style={{ marginTop: 16 }}>
      <h2>Excepções de localização</h2>
      <table className="dense">
        <thead><tr><th>Data</th><th>Colaborador</th><th>Entrada</th><th>Saída</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{day(r.workDate)}</td>
              <td><Link href={`/assiduidade/${r.employee.id}?mes=${r.workDate.slice(0, 7)}`}>{r.employee.name}</Link></td>
              <td>{cell(r.clockIn, r.clockInLocation)}</td>
              <td>{cell(r.clockOut, r.clockOutLocation)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ padding: '0 16px 12px', fontSize: 12.5 }}>Marcações aceites fora do local de trabalho ou sem localização. Confirme com o colaborador e, se necessário, corrija o ponto antes de aprovar o mês.</p>
    </div>
  );
}
