import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Sheet } from '@/lib/types';
import { currentPeriod, monthLabel, shiftMonth as shift } from '@/lib/format';
import { SheetView } from '../sheet-view';

export const dynamic = 'force-dynamic';

export default async function FolhaColaborador({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { employeeId } = await params;
  const period = (await searchParams).mes ?? currentPeriod();
  let sheet: Sheet;
  try {
    sheet = await api<Sheet>(`/v1/attendance/sheet?period=${period}&employeeId=${employeeId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  return (
    <>
      <Link href={`/assiduidade?s=equipa&mes=${period}`} className="crumb">← Assiduidade da equipa</Link>
      <div className="page-head">
        <div>
          <h1>{sheet.employee.name}</h1>
          <p className="sub">{sheet.employee.jobTitle} · N.º {sheet.employee.number} · <Link href={`/colaboradores/${employeeId}`} style={{ color: 'var(--brand)' }}>ficha</Link></p>
        </div>
        <div className="month-nav">
          <Link className="btn ghost sm" href={`?mes=${shift(period, -1)}`}>←</Link>
          <b>{monthLabel(period)}</b>
          <Link className="btn ghost sm" href={`?mes=${shift(period, 1)}`}>→</Link>
        </div>
      </div>
      <SheetView sheet={sheet} period={period} />
    </>
  );
}
