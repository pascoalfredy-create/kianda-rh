import { currentUser } from '@/lib/api';
import { ModuleCards } from '@/components/module-cards';

export const dynamic = 'force-dynamic';

export default async function Modulos() {
  const me = (await currentUser())!;
  return <>
    <h1>Módulos da empresa</h1>
    <p className="sub">{me.company?.name} · uma conta, subscrições independentes</p>
    <ModuleCards modules={me.modules} manage={['owner', 'finance'].includes(me.user.role)} />
  </>;
}
