import Link from 'next/link';
import { redirect } from 'next/navigation';
import { luandaDate } from '@kianda/core';
import { currentUser } from '@/lib/api';
import { CAN_EDIT } from '@/lib/types';
import { EmployeeImportForm } from './form';
export const dynamic = 'force-dynamic';
export default async function ImportEmployees() {
  const me = await currentUser();
  if (!CAN_EDIT.includes(me?.user.role ?? '')) redirect('/colaboradores');
  return <>
    <Link href="/colaboradores" className="crumb">← Colaboradores</Link>
    <div className="page-head"><div><h1>Importar colaboradores</h1><p className="sub">Traga a base da empresa e reveja os dados antes de guardar.</p></div><a className="btn ghost" href="/api/v1/employees/import/template">Descarregar modelo Excel</a></div>
    <EmployeeImportForm today={luandaDate(new Date())} />
  </>;
}
