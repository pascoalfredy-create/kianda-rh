import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { CAN_EDIT, type Department, type EmployeeRow } from '@/lib/types';
import { NewEmployeeForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovoColaborador() {
  const me = await currentUser();
  if (!CAN_EDIT.includes(me?.user.role ?? '')) redirect('/colaboradores');
  const [departments, people] = await Promise.all([api<Department[]>('/v1/departments'), api<EmployeeRow[]>('/v1/employees')]);
  const numeric = people.map((p) => Number(p.number)).filter(Number.isFinite);
  const nextNumber = numeric.length ? String(Math.max(...numeric) + 1) : '1001';
  return (
    <>
      <Link href="/colaboradores" className="crumb">← Colaboradores</Link>
      <h1>Novo colaborador</h1>
      <p className="sub">Admissão: ficha, contrato e remuneração inicial ficam registados numa única operação, com auditoria.</p>
      <NewEmployeeForm
        departments={departments}
        people={people.filter((p) => p.status !== 'terminated').map((p) => ({ id: p.id, name: p.name, jobTitle: p.jobTitle }))}
        nextNumber={nextNumber}
      />
    </>
  );
}
