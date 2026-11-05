import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { CAN_EDIT, type Department, type EmployeeRow } from '@/lib/types';
import { NewEmployeeForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovoColaborador({ searchParams }: { searchParams: Promise<{ candidato?: string }> }) {
  const { candidato } = await searchParams;
  const me = await currentUser();
  if (!CAN_EDIT.includes(me?.user.role ?? '')) redirect('/colaboradores');
  const [departments, people] = await Promise.all([api<Department[]>('/v1/departments'), api<EmployeeRow[]>('/v1/employees')]);
  const cand = candidato ? await api<{ id: string; name: string; email: string | null; phone: string | null; expectedSalaryMinor: number | null; offers: { status: string; baseMinor: number; mealMinor: number; transportMinor: number; startDate: string | null }[]; opening: { title: string; contractType: string; departmentId: string | null; hiringManagerId: string | null } }>(`/v1/candidates/${candidato}`).catch(() => null) : null;
  const agreed = cand?.offers[0]?.status === 'accepted' ? cand.offers[0] : null;
  const prefill = cand ? { candidateId: cand.id, name: cand.name, email: cand.email, phone: cand.phone, jobTitle: cand.opening.title, departmentId: cand.opening.departmentId, managerId: cand.opening.hiringManagerId, contractType: cand.opening.contractType, expectedSalary: agreed?.baseMinor ?? cand.expectedSalaryMinor, mealMinor: agreed?.mealMinor, transportMinor: agreed?.transportMinor, startDate: agreed?.startDate } : undefined;
  const numeric = people.map((p) => Number(p.number)).filter(Number.isFinite);
  const nextNumber = numeric.length ? String(Math.max(...numeric) + 1) : '1001';
  return (
    <>
      <Link href="/colaboradores" className="crumb">← Colaboradores</Link>
      <h1>Admitir alguém</h1>
      {prefill && <div className="warn">Admissão do candidato <b>{prefill.name}</b> (recrutamento). Ao gravar, o candidato passa a contratado.</div>}
      <p className="sub">A ficha, o contrato e o salário ficam registados de uma só vez.</p>
      <NewEmployeeForm
        departments={departments}
        people={people.filter((p) => p.status !== 'terminated').map((p) => ({ id: p.id, name: p.name, jobTitle: p.jobTitle }))}
        nextNumber={nextNumber}
        prefill={prefill}
      />
    </>
  );
}
