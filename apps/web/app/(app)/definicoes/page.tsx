import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { SettingsForm } from './form';

export const dynamic = 'force-dynamic';

export default async function Definicoes() {
  const me = (await currentUser())!;
  if (me.user.role !== 'owner' && me.user.role !== 'hr_admin') redirect('/');
  const s = await api<{ name: string; nif: string; inssNumber: string | null; address: string | null; workdayMinutes: number; christmasSubsidyMonth: number; holidaySubsidyMonth: number | null }>('/v1/company/settings');
  return (
    <>
      <h1>Definições</h1>
      <p className="sub">{s.name} · NIF {s.nif}</p>
      <SettingsForm s={s} />
    </>
  );
}
