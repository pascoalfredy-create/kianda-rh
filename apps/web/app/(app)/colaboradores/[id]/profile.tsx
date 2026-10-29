import { Attachments } from '@/components/attachments';
import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError, currentUser } from '@/lib/api';
import {
  CAN_EDIT, CONTRACT_LABEL, DOC_LABEL, ROLE_LABEL, STATUS_LABEL,
  ABSENCE_STATUS_LABEL, type AbsenceRow, type BalanceRow, type Department, type EmployeeRow, type HistoryEntry, type PersonRef, type Profile,
} from '@/lib/types';
import { ABSENCE_POLICIES, type AbsenceType } from '@kianda/core';
import { AbsenceActions, AbsenceFiles } from '../../ausencias/actions';
import { CompensationForm, ContractForm, DeleteDocument, DocumentForm, PersonalForm } from './forms';
import { AllowanceActions, AssignAllowance, RegimeForm } from './regime';
import { MinimizeEmployee } from '@/components/privacy-actions';

export const dynamic = 'force-dynamic';

const TABS = [
  ['dados', 'Dados'],
  ['contrato', 'Contrato e remuneração'],
  ['documentos', 'Documentos'],
  ['regime', 'Horário e subsídios'],
  ['ausencias', 'Ausências'],
  ['equipa', 'Hierarquia'],
  ['historico', 'Histórico'],
] as const;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
const val = (x: string | null | undefined) => x || '—';
const tenure = (start: string) => {
  const months = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / (30.4375 * 86_400_000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} ano${y > 1 ? 's' : ''}`, m && `${m} ${m > 1 ? 'meses' : 'mês'}`].filter(Boolean).join(' e ') || 'menos de 1 mês';
};

export default async function Ficha({ params, searchParams, panelBase }: { panelBase?: string; params: Promise<{ id: string }>; searchParams: Promise<{ s?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).s ?? 'dados';
  const me = await currentUser();
  const canEdit = CAN_EDIT.includes(me?.user.role ?? '');
  const isStaff = me?.user.role !== 'employee';

  let p: Profile;
  try {
    p = await api<Profile>(`/v1/employees/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const regimeRoles = ['owner', 'hr_admin', 'payroll', 'finance'];
  const tabs = TABS.filter(([k]) => (k !== 'historico' || canEdit) && (k !== 'regime' || regimeRoles.includes(me?.user.role ?? '')));
  const firstStart = p.contracts.at(-1)?.startDate;

  return (
    <>
      {isStaff && !panelBase && <Link href="/colaboradores" className="crumb">← Colaboradores</Link>}
      <div className="card hero">
        <div className="avatar">{initials(p.name)}</div>
        <div>
          <h1>{p.name}<span className={`status ${p.status}`}>{STATUS_LABEL[p.status]}</span></h1>
          <div className="meta">{p.jobTitle} · {p.department?.name ?? 'Sem departamento'} · N.º {p.number}</div>
        </div>
        <div className="facts">
          <div><small>Antiguidade</small><b>{firstStart ? tenure(firstStart) : '—'}</b></div>
          <div><small>Salário base</small><b>{p.compensation.current ? formatKz(p.compensation.current.baseMinor) : '—'}</b></div>
          <div><small>Contrato</small><b>{p.contract ? CONTRACT_LABEL[p.contract.type] : '—'}</b></div>
        </div>
      </div>

      {p.alerts.length > 0 && (
        <div className="warn">
          <b>{p.alerts.length} ponto(s) a tratar</b>
          <ul>{p.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      {p.status === 'terminated' && (p.dataMinimizedAt
        ? <div className="warn">Dados pessoais eliminados a {fmtDate(p.dataMinimizedAt.slice(0, 10))} (Lei n.º 22/11). Conservam-se só os dados exigidos para as obrigações fiscais, de segurança social e contabilísticas.</div>
        : canEdit && ['owner', 'hr_admin'].includes(me?.user.role ?? '') && <div style={{ marginBottom: 14 }}><MinimizeEmployee id={p.id} number={p.number} /></div>)}

      <nav className="tabs">
        {tabs.map(([k, label]) => <Link key={k} href={panelBase ? `${panelBase}&s=${k}` : `?s=${k}`} className={tab === k ? 'on' : ''} scroll={false}>{label}</Link>)}
      </nav>

      {tab === 'dados' && <DataTab p={p} canEdit={canEdit} />}
      {tab === 'contrato' && <ContractTab p={p} canEdit={canEdit} />}
      {tab === 'documentos' && <DocumentsTab p={p} canEdit={canEdit} />}
      {tab === 'regime' && regimeRoles.includes(me?.user.role ?? '') && <RegimeTab id={p.id} canEdit={['owner', 'hr_admin', 'payroll'].includes(me?.user.role ?? '')} />}
      {tab === 'ausencias' && <AbsencesTab p={p} />}
      {tab === 'equipa' && <TeamTab p={p} />}
      {tab === 'historico' && canEdit && <HistoryTab id={p.id} />}
    </>
  );
}

// ───────────────────────── Separadores ─────────────────────────

async function DataTab({ p, canEdit }: { p: Profile; canEdit: boolean }) {
  if (canEdit) {
    const [departments, people] = await Promise.all([api<Department[]>('/v1/departments'), api<EmployeeRow[]>('/v1/employees')]);
    const refs: PersonRef[] = people.filter((x) => x.status !== 'terminated').map((x) => ({ id: x.id, name: x.name, jobTitle: x.jobTitle }));
    return <div className="card"><PersonalForm p={p} departments={departments} people={refs} /></div>;
  }
  const rows: [string, string][] = [
    ['Função', p.jobTitle], ['Departamento', val(p.department?.name)], ['Chefia directa', val(p.manager?.name)], ['Província', val(p.province)], ['Município', val(p.municipality)],
    ['Data de nascimento', fmtDate(p.birthDate)], ['Nacionalidade', val(p.nationality)], ['Estado civil', val(p.maritalStatus)],
    ['BI', val(p.biNumber)], ['NIF', val(p.nif)], ['INSS', val(p.inssNumber)], ['Banco', val(p.bank)], ['IBAN', val(p.iban)],
    ['Email', val(p.email)], ['Telefone', val(p.phone)], ['Morada', val(p.address)],
    ['Contacto de emergência', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ') || '—'],
  ];
  return (
    <div className="card section">
      <dl className="dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="muted" style={{ padding: '0 16px 14px' }}>Para corrigir dados, contacte os Recursos Humanos.</p>
    </div>
  );
}

function ContractTab({ p, canEdit }: { p: Profile; canEdit: boolean }) {
  const c = p.contract;
  const cur = p.compensation.current;
  return (
    <>
      <div className="two">
        <div className="card section">
          <h2>Contrato em vigor</h2>
          {c ? (
            <dl className="dl">
              <div><dt>Tipo</dt><dd>{CONTRACT_LABEL[c.type]}</dd></div>
              <div><dt>Início</dt><dd>{fmtDate(c.startDate)}</dd></div>
              <div><dt>Fim</dt><dd>{c.endDate ? fmtDate(c.endDate) : 'Sem termo'}</dd></div>
              {c.termJustification && <div style={{ gridColumn: '1 / -1' }}><dt>Fundamento do termo</dt><dd>{c.termJustification}</dd></div>}
            </dl>
          ) : <div className="empty">Sem contrato registado</div>}
        </div>
        <div className="card section">
          <h2>Remuneração em vigor</h2>
          {cur ? (
            <dl className="dl">
              <div><dt>Salário base</dt><dd>{formatKz(cur.baseMinor)}</dd></div>
              <div><dt>Subsídio de alimentação</dt><dd>{formatKz(cur.mealMinor)}</dd></div>
              <div><dt>Subsídio de transporte</dt><dd>{formatKz(cur.transportMinor)}</dd></div>
              <div><dt>Desde</dt><dd>{fmtDate(cur.effectiveDate)}</dd></div>
            </dl>
          ) : <div className="empty">Sem remuneração registada</div>}
        </div>
      </div>

      {canEdit && p.status !== 'terminated' && (
        <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
          <Link className="btn danger" href={`/cessacoes/nova?colaborador=${p.id}`}>Cessar contrato…</Link>
        </div>
      )}
      {canEdit && <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 12 }}><Link className="btn ghost" href={`/documentos?v=emitir&colaborador=${p.id}`}>Emitir contrato ou declaração</Link><Link className="btn ghost" href="/acessos">Acesso à plataforma</Link></div>}
      {p.status === 'terminated' && <div className="warn">Contrato cessado. <Link href="/cessacoes">Ver o fecho de contas e os documentos de cessação</Link>.</div>}
      {canEdit && p.status !== 'terminated' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 100%' }}><CompensationForm p={p} /></div>
          <div style={{ flex: '1 1 100%' }}><ContractForm p={p} /></div>
        </div>
      )}

      <div className="card section">
        <h2>Histórico salarial</h2>
        <table>
          <thead><tr><th>Efeito</th><th>Motivo</th><th className="num">Base</th><th className="num">Variação</th><th className="num">Alimentação</th><th className="num">Transporte</th></tr></thead>
          <tbody>
            {p.compensation.history.map((h) => {
              const future = h.effectiveDate > new Date().toISOString().slice(0, 10);
              return (
                <tr key={h.id}>
                  <td>{fmtDate(h.effectiveDate)} {future && <span className="tag future">agendada</span>}{cur?.id === h.id && <span className="tag">em vigor</span>}</td>
                  <td>{h.reason}</td>
                  <td className="num">{formatKz(h.baseMinor)}</td>
                  <td className="num">{h.changeBps == null ? '—' : <span className="delta" style={{ color: h.changeBps < 0 ? 'var(--red)' : undefined }}>{h.changeBps >= 0 ? '+' : ''}{(h.changeBps / 100).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>}</td>
                  <td className="num">{formatKz(h.mealMinor)}</td>
                  <td className="num">{formatKz(h.transportMinor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!p.compensation.history.length && <div className="empty">Sem histórico</div>}
      </div>

      <div className="card section">
        <h2>Contratos</h2>
        <table>
          <thead><tr><th>Tipo</th><th>Início</th><th>Fim</th><th className="num">Base inicial</th><th>Situação</th></tr></thead>
          <tbody>
            {p.contracts.map((k, i) => (
              <tr key={k.id}>
                <td>{CONTRACT_LABEL[k.type]}</td>
                <td>{fmtDate(k.startDate)}</td>
                <td>{k.terminatedAt ? fmtDate(k.terminatedAt) : k.endDate ? fmtDate(k.endDate) : 'Sem termo'}</td>
                <td className="num">{formatKz(k.baseMinor)}</td>
                <td>{k.terminatedAt ? <span className="muted">{k.terminationReason ?? 'Terminado'}</span> : i === 0 ? <span className="tag">em vigor</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DocumentsTab({ p, canEdit }: { p: Profile; canEdit: boolean }) {
  const t = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      {canEdit && <div style={{ marginBottom: 14 }}><DocumentForm employeeId={p.id} /></div>}
      <div className="card">
        <table>
          <thead><tr><th>Documento</th><th>Número</th><th>Emissão</th><th>Validade</th><th>Entidade emissora</th><th>Cópia digitalizada</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {p.documents.map((d) => (
              <tr key={d.id}>
                <td><b>{DOC_LABEL[d.type]}</b>{d.notes && <div className="muted">{d.notes}</div>}</td>
                <td>{d.number}</td>
                <td>{fmtDate(d.issueDate)}</td>
                <td>
                  {fmtDate(d.expiryDate)}{' '}
                  {d.expiryDate && d.expiryDate < t && <span className="pill" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Caducado</span>}
                  {d.expiryDate && d.expiryDate >= t && d.expiryDate <= soon && <span className="pill">A caducar</span>}
                </td>
                <td>{val(d.issuer)}</td>
                <td><Attachments entity="employee_document" entityId={d.id} compact /></td>
                {canEdit && <td className="num"><DeleteDocument employeeId={p.id} doc={d} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!p.documents.length && <div className="empty">Nenhum documento registado</div>}
      </div>
      <div className="card" style={{ marginTop: 14, padding: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Outros ficheiros do processo individual</h2>
        <p className="muted" style={{ marginTop: 0 }}>Contrato assinado, certificados de habilitações, declarações entregues… Visíveis só para o RH e para o próprio colaborador.</p>
        <Attachments entity="employee" entityId={p.id} />
      </div>
    </>
  );
}

interface Regime {
  scheduleId: string | null; scheduleAnchor: string | null; schedule: { name: string; kind: string; description: string; anchorDate: string | null } | null;
  schedules: { id: string; name: string; kind: 'weekly' | 'cycle'; anchorDate: string | null; description: string }[];
  types: { id: string; code: string; label: string; calc: 'fixed' | 'base_pct' | 'per_day'; valueMinor: number | null; bps: number | null }[];
  allowances: { id: string; startDate: string; endDate: string | null; valueMinor: number | null; bps: number | null; type: { code: string; label: string; calc: string; valueMinor: number | null; bps: number | null } | null }[];
}
const allowanceValue = (calc: string | undefined, v: number | null, b: number | null) =>
  calc === 'base_pct' ? `${String((b ?? 0) / 100).replace('.', ',')}% do base` : `${formatKz(v ?? 0)}${calc === 'per_day' ? ' por dia de escala' : ' por mês'}`;

async function RegimeTab({ id, canEdit }: { id: string; canEdit: boolean }) {
  const r = await api<Regime>(`/v1/work-regime/${id}`);
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return (
    <>
      <div className="card section">
        <h2>Regime de horário</h2>
        <dl className="dl">
          <div><dt>Regime</dt><dd>{r.schedule?.name ?? 'Horário normal da empresa (segunda a sexta)'}</dd></div>
          <div><dt>Dias e horas</dt><dd>{r.schedule?.description ?? '—'}</dd></div>
          {r.schedule?.kind === 'cycle' && <div><dt>Início do ciclo</dt><dd>{fmtDate(r.scheduleAnchor ?? r.schedule.anchorDate)}{!r.scheduleAnchor && r.schedule.anchorDate ? ' (do regime)' : ''}</dd></div>}
        </dl>
        {canEdit && <RegimeForm employeeId={id} scheduleId={r.scheduleId} anchor={r.scheduleAnchor} schedules={r.schedules} />}
      </div>
      <div className="card section">
        <h2>Subsídios recorrentes</h2>
        {r.allowances.length ? (
          <table>
            <thead><tr><th>Subsídio</th><th>Valor</th><th>Desde</th><th>Até</th><th /></tr></thead>
            <tbody>{r.allowances.map((a) => {
              const ended = !!a.endDate && a.endDate < today;
              return (
                <tr key={a.id} style={ended ? { color: 'var(--ink3)' } : undefined}>
                  <td><span className="tag">{a.type?.code}</span> {a.type?.label}</td>
                  <td>{allowanceValue(a.type?.calc, a.valueMinor ?? a.type?.valueMinor ?? null, a.bps ?? a.type?.bps ?? null)}{(a.valueMinor !== null || a.bps !== null) && <span className="muted"> (valor próprio)</span>}</td>
                  <td>{fmtDate(a.startDate)}</td><td>{a.endDate ? fmtDate(a.endDate) : 'em vigor'}</td>
                  <td className="num">{canEdit && !ended && <AllowanceActions id={a.id} />}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <div className="empty">Sem subsídios recorrentes atribuídos.</div>}
        {canEdit && (r.types.length ? <AssignAllowance employeeId={id} types={r.types} /> : <p className="muted" style={{ padding: '0 16px 14px' }}>Crie os subsídios em <Link href="/sector" style={{ color: 'var(--brand)' }}>Sector e regimes</Link>.</p>)}
      </div>
    </>
  );
}

async function AbsencesTab({ p }: { p: Profile }) {
  const year = new Date().getFullYear();
  const [[b], rows] = await Promise.all([
    api<BalanceRow[]>(`/v1/leave/balances?year=${year}&employeeId=${p.id}`),
    api<AbsenceRow[]>(`/v1/absences?employeeId=${p.id}`),
  ]);
  const list = [...rows].sort((x, y) => y.startDate.localeCompare(x.startDate));
  return (
    <>
      {b && (
        <div className="grid">
          <div className="card kpi"><div className="l">Direito {year}</div><div className="v">{b.entitlement}{b.carriedOver ? ` + ${b.carriedOver}` : ''} dias</div></div>
          <div className="card kpi"><div className="l">Gozados / aprovados</div><div className="v">{b.taken}</div></div>
          <div className="card kpi"><div className="l">Pendentes</div><div className="v">{b.pending}</div></div>
          <div className="card kpi"><div className="l">Disponíveis</div><div className="v" style={{ color: 'var(--brand)' }}>{b.available}</div></div>
        </div>
      )}
      {b?.eligibleFrom && b.eligibleFrom > new Date().toISOString().slice(0, 10) && <div className="warn">Pode gozar férias a partir de {fmtDate(b.eligibleFrom)} (6 meses de serviço).</div>}
      <div className="card">
        <table>
          <thead><tr><th>Tipo</th><th>Período</th><th className="num">Dias úteis</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><span className="dot" style={{ background: ABSENCE_POLICIES[a.type as AbsenceType]?.color }} />{ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type}{a.reason && <div className="muted">{a.reason}</div>}<AbsenceFiles id={a.id} count={a.fileCount ?? 0} canAttach={!!a.canAttach} /></td>
                <td>{fmtDate(a.startDate)}{a.endDate !== a.startDate ? ` – ${fmtDate(a.endDate)}` : ''}</td>
                <td className="num">{a.workingDays}</td>
                <td><span className={`st ${a.status}`}>{ABSENCE_STATUS_LABEL[a.status]}</span>{a.decisionNote && <div className="muted">{a.decisionNote}</div>}</td>
                <td className="num"><AbsenceActions id={a.id} canDecide={a.canDecide} canCancel={a.canCancel} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">Sem ausências registadas</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}><Link href="/ausencias" style={{ color: 'var(--brand)' }}>Registar ou pedir ausência →</Link></p>
    </>
  );
}

function TeamTab({ p }: { p: Profile }) {
  const Person = ({ x }: { x: PersonRef }) => (
    <Link href={`/colaboradores/${x.id}`} className="person">
      <div className="avatar sm">{initials(x.name)}</div>
      <div><b>{x.name}</b><div className="muted">{x.jobTitle}</div></div>
    </Link>
  );
  return (
    <div className="two">
      <div className="card section">
        <h2>Chefia directa</h2>
        <div style={{ paddingTop: 8 }}>{p.manager ? <Person x={p.manager} /> : <div className="empty">Sem chefia atribuída</div>}</div>
      </div>
      <div className="card section">
        <h2>Equipa directa ({p.reports.length})</h2>
        <div style={{ paddingTop: 8 }}>{p.reports.length ? p.reports.map((r) => <Person key={r.id} x={r} />) : <div className="empty">Sem subordinados directos</div>}</div>
      </div>
      {p.account && (
        <div className="card section">
          <h2>Acesso à plataforma</h2>
          <dl className="dl"><div><dt>Email de acesso</dt><dd>{p.account.email}</dd></div><div><dt>Perfil</dt><dd>{ROLE_LABEL[p.account.role] ?? p.account.role}</dd></div></dl>
        </div>
      )}
    </div>
  );
}

const TITLE: Record<string, string> = {
  'create:employee': 'Ficha criada', 'update:employee': 'Ficha alterada', 'create:contract': 'Novo contrato',
  'create:compensation': 'Alteração salarial', 'create:employee_document': 'Documento adicionado', 'delete:employee_document': 'Documento removido',
};
const FIELD: Record<string, string> = {
  name: 'nome', jobTitle: 'função', departmentId: 'departamento', managerId: 'chefia', status: 'situação', province: 'província', gender: 'sexo',
  birthDate: 'nascimento', nationality: 'nacionalidade', maritalStatus: 'estado civil', biNumber: 'BI', nif: 'NIF', inssNumber: 'INSS', iban: 'IBAN',
  bank: 'banco', email: 'email', phone: 'telefone', address: 'morada', emergencyContactName: 'contacto de emergência', emergencyContactPhone: 'telefone de emergência',
};

async function HistoryTab({ id }: { id: string }) {
  const hist = await api<HistoryEntry[]>(`/v1/employees/${id}/history`);
  const describe = (h: HistoryEntry): string => {
    const a = h.after ?? {};
    const b = h.before ?? {};
    if (h.entity === 'employee' && h.action === 'update') return `Campos alterados: ${Object.keys(a).map((k) => FIELD[k] ?? k).join(', ')}`;
    if (h.entity === 'employee' && h.action === 'create') return 'Registo inicial com contrato e remuneração';
    if (h.entity === 'compensation') {
      const before = (b as { baseMinor?: number }).baseMinor;
      const after = (a as { baseMinor?: number; effectiveDate?: string; reason?: string });
      return `${after.reason ?? ''}: ${before != null ? `${formatKz(before)} → ` : ''}${formatKz(after.baseMinor ?? 0)} com efeito em ${fmtDate(after.effectiveDate)}`;
    }
    if (h.entity === 'contract') {
      const c = a as { type?: string; startDate?: string };
      return `${CONTRACT_LABEL[c.type ?? ''] ?? ''} com início em ${fmtDate(c.startDate)}`;
    }
    if (h.entity === 'employee_document') {
      const d = (h.action === 'delete' ? b : a) as { type?: string; number?: string };
      return `${DOC_LABEL[d.type ?? ''] ?? 'Documento'} ${d.number ?? ''}`;
    }
    return '';
  };
  return (
    <div className="card">
      {hist.length ? (
        <ul className="timeline">
          {hist.map((h) => (
            <li key={h.id}>
              <b>{TITLE[`${h.action}:${h.entity}`] ?? `${h.entity} (${h.action})`}</b>
              <div className="chg">{describe(h)}</div>
              <div className="when">{new Date(h.at).toLocaleString('pt-AO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Luanda' })} · {h.actorName}</div>
            </li>
          ))}
        </ul>
      ) : <div className="empty">Sem alterações registadas</div>}
    </div>
  );
}
