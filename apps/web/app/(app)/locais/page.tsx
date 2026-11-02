import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { AssignmentsForm, ModeForm, WorkplaceList, type WorkplacesData } from './forms';

export const dynamic = 'force-dynamic';

/** Configuração do ponto com localização: regra da empresa, locais com raio, quiosques e atribuição. */
export default async function Locais() {
  const me = (await currentUser())!;
  if (me.user.role !== 'owner' && me.user.role !== 'hr_admin') redirect('/');
  const data = await api<WorkplacesData>('/v1/workplaces');
  return (
    <>
      <h1>Locais de trabalho</h1>
      <p className="sub">Ponto com localização: onde se pode marcar a entrada e a saída, e o que fazer quando a marcação é feita fora do local</p>
      <ModeForm mode={data.mode} modes={data.modes} workplaces={data.workplaces.filter((w) => w.active).length} />
      <WorkplaceList workplaces={data.workplaces} />
      {data.workplaces.length > 0 && <AssignmentsForm employees={data.employees} workplaces={data.workplaces} />}
      <div className="card section">
        <h2>Privacidade</h2>
        <div style={{ padding: '8px 16px 16px', display: 'grid', gap: 8 }}>
          <p>A localização é pedida <b>só no momento da marcação</b>, nunca em contínuo, e só quando a regra não está desligada. O colaborador vê o aviso no próprio botão do ponto. As coordenadas ficam na marcação e são vistas pela chefia directa e pelo RH.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Informe os colaboradores desta finalidade (controlo do local de trabalho) antes de ligar a regra. O GPS de um telemóvel pode ser falsificado e o ecrã do quiosque fotografado: são controlos dissuasores, não provas infalíveis.</p>
        </div>
      </div>
    </>
  );
}
