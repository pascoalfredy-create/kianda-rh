import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { actorFromApi, apiWithActor, ApiError, type ApiActor } from '@/lib/api';
import { CAN_EDIT, CONTRACT_LABEL, STATUS_LABEL, type EmployeeRow } from '@/lib/types';
import { RhDialog } from '@/components/rh-dialog';
import Ficha from './[id]/profile';
import Novo from './novo/page';

export const dynamic = 'force-dynamic';
type Filters = { q?: string; estado?: string; dept?: string; provincia?: string; contrato?: string; ficha?: string; s?: string; novo?: string };
export default async function Colaboradores({ searchParams }: { searchParams: Promise<Filters> }) {
  const sp = await searchParams;
  const { q = '', estado = 'activos', dept = '', provincia = '', contrato = '' } = sp;
  let actor: ApiActor | null = null;
  let rows: EmployeeRow[] = [], error = '';
  try { const response = await apiWithActor<EmployeeRow[]>('/v1/employees'); rows = response.data; actor = response.actor; }
  catch (e) { if (e instanceof ApiError) actor = e.actor; error = e instanceof ApiError && e.status === 403 ? 'O seu perfil não permite consultar a lista de colaboradores.' : 'Não foi possível carregar os colaboradores. Tente novamente.'; }
  actor = await actorFromApi({ actor });
  const needle = q.trim().toLocaleLowerCase('pt-PT');
  const shown = rows.filter(e => (estado === 'todos' || (estado === 'cessados' ? e.status === 'terminated' : e.status !== 'terminated')) &&
    (!dept || e.department === dept) && (!provincia || e.province === provincia) && (!contrato || e.contract?.type === contrato) &&
    (!needle || [e.name, e.number, e.nif ?? '', e.jobTitle, e.department ?? ''].some(v => v.toLocaleLowerCase('pt-PT').includes(needle))));
  const qs = new URLSearchParams({ q, estado, dept, provincia, contrato });
  const returnTo = `/colaboradores?${qs}`;
  const canEdit = CAN_EDIT.includes(actor?.role ?? '');
  const initial = (name: string) => name.split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  return <>
    <div className="page-head"><div><h1>Colaboradores</h1><p className="sub">{rows.length} registos · ficha individual com identificação, INSS, IBAN e contrato</p></div>{canEdit && <Link href={`${returnTo}&novo=1`} className="btn">+ Novo colaborador</Link>}</div>
    {error ? <div className="alert">{error}</div> : <div className="card">
      <form className="employee-filters">
        <input name="q" defaultValue={q} placeholder="Filtrar por nome, cargo, NIF…" aria-label="Pesquisar colaborador" />
        <select name="dept" defaultValue={dept} aria-label="Departamento"><option value="">Todos os departamentos</option>{[...new Set(rows.map(e => e.department).filter(Boolean))].sort().map(d => <option key={d!}>{d}</option>)}</select>
        <select name="provincia" defaultValue={provincia} aria-label="Província"><option value="">Todas as províncias</option>{[...new Set(rows.map(e => e.province).filter(Boolean))].sort().map(p => <option key={p!}>{p}</option>)}</select>
        <select name="contrato" defaultValue={contrato} aria-label="Contrato"><option value="">Todos os contratos</option>{Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="estado" defaultValue={estado} aria-label="Situação"><option value="activos">Activos e suspensos</option><option value="cessados">Cessados</option><option value="todos">Todos</option></select>
        <button className="btn ghost sm">Filtrar</button><span className="muted">{shown.length} resultado(s)</span>
      </form>
      <div className="table-scroll"><table><thead><tr><th>Colaborador</th><th>N.º</th><th>Departamento</th><th>Província</th><th>Contrato</th><th>Admissão</th><th className="num">Salário base</th><th>Estado</th></tr></thead><tbody>
        {shown.map(e => <tr key={e.id}><td><Link href={`${returnTo}&ficha=${encodeURIComponent(e.id)}`} className="employee-who" scroll={false}><span className="avatar sm">{initial(e.name)}</span><span><b>{e.name}</b><small>{e.jobTitle}</small></span></Link>{e.alerts.length > 0 && <span className="muted employee-alert-note">{e.alerts.length} ponto(s) a tratar</span>}</td><td className="muted">{e.number}</td><td>{e.department ?? '—'}</td><td>{e.province ?? '—'}</td><td>{e.contract ? CONTRACT_LABEL[e.contract.type] : '—'}{e.contract?.endDate && <small className="muted"> · {e.contract.endDate.split('-').reverse().join('/')}</small>}</td><td>{e.contract?.startDate.split('-').reverse().join('/') ?? '—'}</td><td className="num">{e.contract ? formatKz(e.contract.baseMinor) : '—'}</td><td><span className={`st ${e.status === 'active' ? 'approved' : e.status === 'suspended' ? 'pending' : 'cancelled'}`}>{STATUS_LABEL[e.status]}</span></td></tr>)}
      </tbody></table></div>{!shown.length && <div className="empty">Nenhum colaborador encontrado</div>}
    </div>}
    {sp.ficha && !error && <RhDialog title="Ficha do colaborador" returnTo={returnTo} drawer><Ficha params={Promise.resolve({ id: sp.ficha })} searchParams={Promise.resolve({ s: sp.s })} panelBase={`${returnTo}&ficha=${encodeURIComponent(sp.ficha)}`} /><div className="drawer-full-link"><Link className="btn ghost sm" href={`/colaboradores/${encodeURIComponent(sp.ficha)}`}>Abrir ficha completa →</Link></div></RhDialog>}
    {sp.novo && canEdit && <RhDialog title="Novo colaborador" returnTo={returnTo}><Novo searchParams={Promise.resolve({})} /></RhDialog>}
  </>;
}
