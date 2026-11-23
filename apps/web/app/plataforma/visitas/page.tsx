import { api } from '@/lib/api';
import { PlatformShell } from '@/components/platform-shell';
import { requirePlatformAdmin } from '../data';
import { Visits, type VisitsSummary } from '../visits';

export const dynamic = 'force-dynamic';

/** Visitas ao site: quantas pessoas chegam, de onde vêm e quantas criam conta. */
export default async function Visitas() {
  await requirePlatformAdmin();
  const visits = await api<VisitsSummary>('/v1/platform/visits?days=30');
  return (
    <PlatformShell current="platform">
      <h1>Visitas ao site</h1>
      <p className="sub">Os últimos 30 dias, sem cookies nem dados pessoais dos visitantes.</p>
      <Visits v={visits} />
    </PlatformShell>
  );
}
