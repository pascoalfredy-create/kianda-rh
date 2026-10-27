import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { SettingsForm } from './form';
import { LogoForm } from './logo';

export const dynamic = 'force-dynamic';

export default async function Definicoes() {
  const me = (await currentUser())!;
  if (me.user.role !== 'owner' && me.user.role !== 'hr_admin') redirect('/');
  const s = await api<{ name: string; nif: string; inssNumber: string | null; address: string | null; workdayMinutes: number; christmasSubsidyMonth: number; holidaySubsidyMonth: number | null; perDiemNationalMinor: number | null; perDiemInternationalMinor: number | null; autoIssueDeclarations: boolean }>('/v1/company/settings');
  return (
    <>
      <h1>Definições</h1>
      <p className="sub">{s.name} · NIF {s.nif}</p>
      <LogoForm current={(await api<{ logo: string | null } | null>('/v1/company/branding'))?.logo ?? null} />
      <SettingsForm s={s} />
      {me.user.role === 'owner' && (
        <div className="card section">
          <h2>Dados e privacidade</h2>
          <div style={{ padding: '8px 16px 16px', display: 'grid', gap: 10 }}>
            <p>Os dados da empresa ficam isolados na base de dados (cada pedido só acede às linhas da sua empresa), com cópias de segurança diárias cifradas. A sua empresa é a responsável pelo tratamento dos dados dos colaboradores; o Kianda RH actua como subcontratante (Lei n.º 22/11).</p>
            <div><a className="btn ghost" href="/api/v1/company/export">Exportar todos os dados (JSON)</a></div>
            <p className="muted" style={{ fontSize: 12.5 }}>Ex-colaboradores: na ficha de cada um pode eliminar os dados pessoais que a lei não obriga a conservar. Candidatos: podem ser eliminados na página do candidato. Para encerrar a conta e eliminar todos os dados, contacte o suporte Kianda.</p>
          </div>
        </div>
      )}
    </>
  );
}
