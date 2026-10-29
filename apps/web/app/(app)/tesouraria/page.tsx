import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { currentPeriod, monthLabel, shiftMonth } from '@/lib/format';
import type { PersonnelCash } from '@/lib/personnel';
import Link from 'next/link';
import { CashPlan } from './plan';

export const dynamic = 'force-dynamic';
export default async function Tesouraria({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const me = (await currentUser())!;
  if (!['owner', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const sp = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? '') ? sp.mes! : currentPeriod();
  const data = await api<PersonnelCash>(`/v1/personnel-cash?period=${period}`);
  return <><div className="page-head"><div><h1>Tesouraria de pessoal</h1><p className="sub">Previsão de saídas com salários, IRT, INSS e despesas aprovadas · seis meses</p></div><div className="month-nav"><Link className="btn ghost sm" href={`?mes=${shiftMonth(period, -1)}`}>‹</Link><b>{monthLabel(period)}</b><Link className="btn ghost sm" href={`?mes=${shiftMonth(period, 1)}`}>›</Link></div></div><CashPlan key={period} data={data} editable={['owner', 'finance'].includes(me.user.role) && me.modules.hr.canWrite} /></>;
}
