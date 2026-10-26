import Link from 'next/link';
import { api } from '@/lib/api';
import { ReviewForm } from '../forms';
import { REVIEW_STATUS } from '../status';

export const dynamic = 'force-dynamic';

export default async function Avaliacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api<Parameters<typeof ReviewForm>[0]['r'] & { cycle: { name: string; periodFrom: string; periodTo: string; deadline: string | null }; employee: { name: string; jobTitle: string; number: string }; reviewerName: string }>(`/v1/reviews/${id}`);
  const pt = (d: string) => d.split('-').reverse().join('/');
  return (
    <>
      <div className="crumb"><Link href="/desempenho">Desempenho</Link> / {r.employee.name}</div>
      <h1>{r.employee.name}</h1>
      <p className="sub">{r.employee.jobTitle} · {r.cycle.name} ({pt(r.cycle.periodFrom)} a {pt(r.cycle.periodTo)}) · avaliador: {r.reviewerName} · <span className={REVIEW_STATUS[r.status]?.[1]}>{REVIEW_STATUS[r.status]?.[0]}</span></p>
      {r.role === 'self' && r.status === 'manager' && <div className="warn">A sua auto-avaliação foi submetida. A avaliação está agora com {r.reviewerName}.</div>}
      <ReviewForm r={r} />
    </>
  );
}
