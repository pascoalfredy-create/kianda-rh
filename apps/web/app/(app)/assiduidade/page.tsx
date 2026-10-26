import { formatMinutes } from '@kianda/core';
import Link from 'next/link';
import { ClockCard } from '@/components/clock-card';
import { api, currentUser } from '@/lib/api';
import type { OverviewRow, Sheet } from '@/lib/types';
import { SheetView } from './sheet-view';
import { currentPeriod, monthLabel, shiftMonth as shift } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Assiduidade({ searchParams }: { searchParams: Promise<{ s?: string; mes?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const staff = me.user.role !== 'employee';
  const hasFile = !!me.user.employeeId;
  const tab = sp.s ?? (staff ? 'equipa' : 'meu');
  const period = sp.mes ?? currentPeriod();

  return (
    <>
      <h1>Assiduidade</h1>
      <p className="sub">Registo de entradas e saídas, horas extra e aprovação mensal para o processamento salarial</p>
      {hasFile && <ClockCard />}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <nav className="tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
          {staff && <Link href={`?s=equipa&mes=${period}`} className={tab === 'equipa' ? 'on' : ''}>Equipa</Link>}
          {hasFile && <Link href={`?s=meu&mes=${period}`} className={tab === 'meu' ? 'on' : ''}>O meu mês</Link>}
        </nav>
        <div className="month-nav">
          <Link className="btn ghost sm" href={`?s=${tab}&mes=${shift(period, -1)}`}>←</Link>
          <b>{monthLabel(period)}</b>
          <Link className="btn ghost sm" href={`?s=${tab}&mes=${shift(period, 1)}`}>→</Link>
        </div>
      </div>
      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 16 }} />
      {tab === 'equipa' && staff && <Overview period={period} />}
      {tab === 'meu' && hasFile && <SheetView sheet={await api<Sheet>(`/v1/attendance/sheet?period=${period}`)} period={period} />}
    </>
  );
}

async function Overview({ period }: { period: string }) {
  const rows = await api<OverviewRow[]>(`/v1/attendance/overview?period=${period}`);
  const toApprove = rows.filter((r) => r.canApprove).length;
  return (
    <>
      {toApprove > 0 && <div className="warn">{toApprove} folha(s) de {monthLabel(period)} por aprovar. As horas extra só entram no processamento depois de aprovadas.</div>}
      <div className="card">
        <table>
          <thead><tr><th>Colaborador</th><th className="num">Trabalhado</th><th className="num">Previsto</th><th className="num">Extra</th><th className="num">Sem saída</th><th className="num">Sem registo</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id}>
                <td><Link href={`/assiduidade/${r.employee.id}?mes=${period}`}><b>{r.employee.name}</b></Link><div className="muted">{r.employee.department ?? '—'}</div></td>
                <td className="num">{formatMinutes(r.workedMinutes)}</td>
                <td className="num">{formatMinutes(r.expectedMinutes)}</td>
                <td className="num">{r.overtimeMinutes ? <b style={{ color: 'var(--brand)' }}>{formatMinutes(r.overtimeMinutes)}</b> : '—'}</td>
                <td className="num">{r.openDays ? <span className="flag red">{r.openDays}</span> : '—'}</td>
                <td className="num">{r.noRecordDays ? <span className="flag">{r.noRecordDays}</span> : '—'}</td>
                <td>
                  {r.approval
                    ? <span className="st approved">Aprovado · {formatMinutes(r.approval.approvedOvertimeMinutes)} extra</span>
                    : r.canApprove ? <Link href={`/assiduidade/${r.employee.id}?mes=${period}`} className="st pending">Por aprovar →</Link>
                    : <span className="st cancelled">Em curso</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Sem colaboradores</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>"Sem registo" são dias úteis passados sem entradas nem ausência aprovada: corrija o ponto ou registe a ausência (as faltas injustificadas descontam no salário).</p>
    </>
  );
}
