import { currentUser } from '@/lib/api';
import { ModuleCards } from '@/components/module-cards';

export const dynamic = 'force-dynamic';

export default async function Modulos() {
  const me = (await currentUser())!;
  return <>
    <h1>Módulos da empresa</h1>
    <p className="sub">Os módulos da {me.company?.name}. Cada um tem a sua subscrição.</p>
    <ModuleCards modules={me.modules} manage={['owner', 'finance'].includes(me.user.role)} />
  </>;
}
