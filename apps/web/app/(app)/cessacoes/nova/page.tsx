import { luandaDate } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { TerminationEditor } from '../editor';

export const dynamic = 'force-dynamic';

export default async function NovaCessacao({ searchParams }: { searchParams: Promise<{ colaborador?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin'].includes(me.user.role)) redirect('/cessacoes');
  const employees = (await api<{ id: string; name: string; number: string; status: string }[]>('/v1/employees')).filter((e) => e.status !== 'terminated');
  const today = luandaDate(new Date());
  const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return (
    <>
      <div className="crumb"><Link href="/cessacoes">Cessações</Link> / Nova</div>
      <h1>Registar uma saída</h1>
      <p className="sub">O Kianda calcula o fecho de contas; ajuste o que tiver sido acordado. A ficha só muda quando confirmar.</p>
      <TerminationEditor init={{ employeeId: sp.colaborador ?? '', reason: 'resignation', effectiveDate: last, noticeDate: null, agreedCompensationMinor: null, items: null, note: null }} employees={employees} />
    </>
  );
}
