import { luandaDate } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { ClaimForm } from '../form';

export const dynamic = 'force-dynamic';

export default async function NovaNota() {
  const me = (await currentUser())!;
  const s = await api<{ perDiemNationalMinor: number | null; perDiemInternationalMinor: number | null }>('/v1/company/settings');
  const staff = ['owner', 'hr_admin', 'finance'].includes(me.user.role);
  const employees = staff ? (await api<{ id: string; name: string; status?: string }[]>('/v1/employees')).filter((e) => e.status !== 'terminated') : undefined;
  return (
    <>
      <div className="crumb"><Link href="/despesas">Despesas</Link> / Nova nota</div>
      <h1>Nova nota de despesas</h1>
      <p className="sub">Junte as despesas com recibo e as ajudas de custo da deslocação. Guarde os recibos originais: a chefia e as Finanças podem pedi-los.</p>
      {!me.user.employeeId && !staff ? <div className="card empty">O seu utilizador não está associado a uma ficha de colaborador.</div> : (
        <ClaimForm init={{ title: '', tripFrom: null, tripTo: null, lines: [] }} today={luandaDate(new Date())} rates={{ national: s.perDiemNationalMinor, international: s.perDiemInternationalMinor }} employees={employees} />
      )}
    </>
  );
}
