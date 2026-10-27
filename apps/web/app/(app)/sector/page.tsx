import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { AllowanceList, ApplyPreset, ScheduleList, SectorPicker } from './forms';

export const dynamic = 'force-dynamic';

interface Stats { avgWeeklyMinutes: number; problems: string[] }
interface SectorData {
  sector: string | null; sectorLabel: string | null; sectors: Record<string, string>; weeklyHours: number; withoutSchedule: number;
  profile: {
    schedules: { key: string; name: string; description: string; note?: string; stats: Stats; applied: boolean }[];
    allowances: { key: string; code: string; label: string; calc: string; note?: string; applied: boolean }[];
    requiredDocuments: { type: string; label: string; reason: string; appliesToLabel: string }[];
    notes: string[];
  };
  schedules: { id: string; name: string; kind: 'weekly' | 'cycle'; pattern: number[]; anchorDate: string | null; note: string | null; active: boolean; description: string; stats: Stats; employees: number }[];
  allowanceTypes: { id: string; code: string; label: string; calc: 'fixed' | 'base_pct' | 'per_day'; valueMinor: number | null; bps: number | null; inInss: boolean; inIrt: boolean; note: string | null; active: boolean; employees: number }[];
}

export default async function Sector() {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin', 'payroll', 'finance'].includes(me.user.role)) redirect('/');
  const s = await api<SectorData>('/v1/sector');
  const canEdit = ['owner', 'hr_admin', 'payroll'].includes(me.user.role);
  const canSector = ['owner', 'hr_admin'].includes(me.user.role);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sector e regimes</h1>
          <p className="sub">Regimes de horário, subsídios recorrentes e pré-configurações de <b>{s.sectorLabel ?? 'sector por definir'}</b></p>
        </div>
        <Link className="btn ghost" href="/conformidade">Ver conformidade</Link>
      </div>

      <div className="card section">
        <h2>Sector de actividade</h2>
        {canSector ? <SectorPicker sector={s.sector} sectors={s.sectors} /> : <p style={{ padding: '8px 16px 14px' }}>{s.sectorLabel ?? '—'}</p>}
      </div>

      <div className="card section">
        <h2>Sugestões para o sector</h2>
        <div style={{ padding: '8px 16px 0' }} className="muted">
          Regimes: {s.profile.schedules.map((x) => x.name).join(' · ') || '—'}<br />
          Subsídios: {s.profile.allowances.map((x) => x.label).join(' · ') || 'nenhum específico'}
          {s.profile.requiredDocuments.length > 0 && <><br />Documentos obrigatórios: {s.profile.requiredDocuments.map((d) => `${d.label} (${d.appliesToLabel})`).join(' · ')}</>}
        </div>
        {canEdit && <ApplyPreset schedules={s.profile.schedules} allowances={s.profile.allowances} />}
        <p className="muted" style={{ padding: '0 16px 14px', fontSize: 12.5 }}>Valores indicativos: ajuste à política da empresa e ao contrato colectivo. A incidência de INSS/IRT segue a regra geral até confirmação pelo contabilista.</p>
      </div>

      <div className="card section">
        <h2>Regimes de horário</h2>
        <p className="muted" style={{ padding: '6px 16px 4px', fontSize: 12.5 }}>
          O ponto prevê as horas de cada dia pelo regime do colaborador; o que passar do previsto é trabalho extraordinário. {s.withoutSchedule > 0 && <>{s.withoutSchedule} colaborador(es) sem regime seguem o horário normal (segunda a sexta). </>}Atribua o regime na ficha do colaborador, separador “Horário e subsídios”.
        </p>
        <ScheduleList rows={s.schedules} weeklyHours={s.weeklyHours} canEdit={canEdit} />
      </div>

      <div className="card section">
        <h2>Subsídios recorrentes</h2>
        <p className="muted" style={{ padding: '6px 16px 4px', fontSize: 12.5 }}>Entram automaticamente no processamento de cada mês para os colaboradores a quem forem atribuídos. “Por dia de escala” conta os dias de trabalho previstos no regime, menos as faltas injustificadas.</p>
        <AllowanceList rows={s.allowanceTypes} canEdit={canEdit} />
      </div>
    </>
  );
}
