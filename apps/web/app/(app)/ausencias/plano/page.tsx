import { luandaDate } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DocumentPrintButton } from '@/components/document-export';
import { PrintSheet } from '@/components/print-sheet';
import { api, currentUser } from '@/lib/api';
import type { AbsenceRow, BalanceRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const pt = (d: string) => d.split('-').reverse().join('/');

/** Plano de férias do ano (LGT, art. 206.º): todos os trabalhadores, com início e termo de cada período. Afixar até 31 de Janeiro. */
export default async function PlanoFerias({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const me = (await currentUser())!;
  if (me.user.role === 'employee') redirect('/ausencias');
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.ano ?? '') ? Number(sp.ano) : Number(luandaDate(new Date()).slice(0, 4));
  const [balances, absences] = await Promise.all([
    api<BalanceRow[]>(`/v1/leave/balances?year=${year}`),
    api<AbsenceRow[]>(`/v1/absences?from=${year}-01-01&to=${year}-12-31`),
  ]);
  const vacations = absences.filter((a) => a.type === 'vacation' && (a.status === 'approved' || a.status === 'pending')).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const byEmployee = new Map<string, AbsenceRow[]>();
  for (const v of vacations) byEmployee.set(v.employeeId, [...(byEmployee.get(v.employeeId) ?? []), v]);
  const rows = [...balances].sort((a, b) => (a.employee.department ?? '').localeCompare(b.employee.department ?? '') || a.employee.name.localeCompare(b.employee.name));
  const pending = vacations.some((v) => v.status === 'pending');
  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1>Plano de férias {year}</h1>
          <p className="sub">Para afixar no centro de trabalho até 31 de Janeiro.</p>
        </div>
        <div className="actions">
          <Link className="btn ghost sm" href={`?ano=${year - 1}`}>← {year - 1}</Link>
          <Link className="btn ghost sm" href={`?ano=${year + 1}`}>{year + 1} →</Link>
          <DocumentPrintButton className="btn sm">Imprimir (A4)</DocumentPrintButton>
        </div>
      </div>
      {pending && <div className="warn no-print">Há períodos ainda por aprovar — aparecem marcados «por aprovar». Aprove-os antes de afixar o plano.</div>}
      <PrintSheet footer={<><span>Plano de férias de {year}</span><span>Emitido em {pt(luandaDate(new Date()))}</span></>}>
        <h2 className="doc-title">Plano de férias de {year}</h2>
        <table className="vacation-plan">
          <colgroup><col style={{ width: '6%' }} /><col style={{ width: '25%' }} /><col style={{ width: '15%' }} /><col style={{ width: '34%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /></colgroup>
          <thead><tr><th>N.º</th><th>Trabalhador</th><th>Departamento</th><th>Períodos de férias (início — termo)</th><th className="num">Dias úteis</th><th className="num">Direito</th></tr></thead>
          <tbody>
            {rows.map((b) => {
              const mine = byEmployee.get(b.employee.id) ?? [];
              const days = mine.reduce((s, v) => s + v.workingDays, 0);
              return (
                <tr key={b.employee.id}>
                  <td>{b.employee.number}</td>
                  <td>{b.employee.name}</td>
                  <td>{b.employee.department ?? ''}</td>
                  <td>{mine.length ? mine.map((v) => `${pt(v.startDate)} — ${pt(v.endDate)}${v.status === 'pending' ? ' (por aprovar)' : ''}`).join('; ') : 'Por marcar'}</td>
                  <td className="num">{days || ''}</td>
                  <td className="num">{b.entitlement + b.carriedOver}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p>A marcação foi feita, na medida do possível, por acordo entre o empregador e cada trabalhador. Alterações posteriores são comunicadas e reflectidas neste plano.</p>
        <div className="doc-signatures" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div><b>O EMPREGADOR</b><div className="doc-sign-line" /></div>
          <div><b>AFIXADO EM</b><div className="doc-sign-line" /><div className="doc-sign-name">___/___/{year}</div></div>
        </div>
      </PrintSheet>
    </>
  );
}
