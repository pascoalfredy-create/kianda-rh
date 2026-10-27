import { ABSENCE_POLICIES, labourRules, type AbsenceType } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { ABSENCE_STATUS_LABEL, type AbsenceRow, type BalanceRow } from '@/lib/types';
import { AbsenceActions, AbsenceFiles, NewAbsenceForm } from './actions';

export const dynamic = 'force-dynamic';

const pt = (d: string) => d.split('-').reverse().join('/');
const TABS = [['pedidos', 'Pedidos'], ['mapa', 'Mapa de férias'], ['saldos', 'Saldos de férias']] as const;
const policy = (t: string) => ABSENCE_POLICIES[t as AbsenceType];

export default async function Ausencias({ searchParams }: { searchParams: Promise<{ s?: string; mes?: string; estado?: string; ano?: string }> }) {
  const sp = await searchParams;
  const tab = sp.s ?? 'pedidos';
  const me = (await currentUser())!;
  const role = me.user.role;
  const isHr = role === 'owner' || role === 'hr_admin';
  const canRegisterOthers = isHr || role === 'manager';
  const todayIso = new Date().toISOString().slice(0, 10);
  const year = Number(sp.ano ?? todayIso.slice(0, 4));
  const balances = await api<BalanceRow[]>(`/v1/leave/balances?year=${year}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ausências e férias</h1>
          <p className="sub">Pedidos, aprovações pela chefia, mapa de férias e saldos — dias úteis com feriados nacionais (LGT, Lei n.º 12/23)</p>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <NewAbsenceForm
          me={{ employeeId: me.user.employeeId, isHr }}
          people={balances}
          canRegisterOthers={canRegisterOthers}
          canApprove={isHr || role === 'manager'}
        />
      </div>
      <nav className="tabs">
        {TABS.map(([k, l]) => <Link key={k} href={`?s=${k}`} className={tab === k ? 'on' : ''} scroll={false}>{l}</Link>)}
      </nav>
      {tab === 'pedidos' && <Requests estado={sp.estado} />}
      {tab === 'mapa' && <VacationMap month={sp.mes ?? todayIso.slice(0, 7)} people={balances} today={todayIso} />}
      {tab === 'saldos' && <Balances rows={balances} year={year} />}
    </>
  );
}

// ───────────────────────── Pedidos ─────────────────────────

async function Requests({ estado }: { estado?: string }) {
  const all = await api<AbsenceRow[]>('/v1/absences');
  const awaiting = all.filter((a) => a.canDecide);
  const shown = all
    .filter((a) => !estado || a.status === estado)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <>
      {awaiting.length > 0 && (
        <div className="card section">
          <h2>A aguardar a sua decisão ({awaiting.length})</h2>
          <AbsenceTable rows={awaiting} highlight />
        </div>
      )}
      <div className="card section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px 0' }}>
          <h2 className="h2-inline">Todos os pedidos</h2>
          <div className="actions">
            {[['', 'Todos'], ['pending', 'Pendentes'], ['approved', 'Aprovados'], ['rejected', 'Recusados'], ['cancelled', 'Cancelados']].map(([k, l]) => (
              <Link key={k} href={`?s=pedidos${k ? `&estado=${k}` : ''}`} className={`tag ${(estado ?? '') === k ? 'future' : ''}`}>{l}</Link>
            ))}
          </div>
        </div>
        <AbsenceTable rows={shown} />
        {!shown.length && <div className="empty">Sem pedidos</div>}
      </div>
    </>
  );
}

function AbsenceTable({ rows, highlight }: { rows: AbsenceRow[]; highlight?: boolean }) {
  return (
    <table>
      <thead><tr><th>Colaborador</th><th>Tipo</th><th>Período</th><th className="num">Dias úteis</th><th>Estado</th><th /></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} style={highlight ? { background: '#fffdf6' } : undefined}>
            <td><Link href={`/colaboradores/${a.employee.id}?s=ausencias`}><b>{a.employee.name}</b></Link><div className="muted">{a.employee.department ?? '—'}</div></td>
            <td><span className="dot" style={{ background: policy(a.type)?.color }} />{policy(a.type)?.label ?? a.type}{a.reason && <div className="muted">{a.reason}</div>}<AbsenceFiles id={a.id} count={a.fileCount ?? 0} canAttach={!!a.canAttach} /></td>
            <td>{pt(a.startDate)}{a.endDate !== a.startDate ? ` – ${pt(a.endDate)}` : ''}</td>
            <td className="num">{a.workingDays}</td>
            <td>
              <span className={`st ${a.status}`}>{ABSENCE_STATUS_LABEL[a.status]}</span>
              {a.decisionNote && <div className="muted">{a.decisionNote}</div>}
              {a.status === 'pending' && a.requesterName && <div className="muted">por {a.requesterName}</div>}
            </td>
            <td className="num"><AbsenceActions id={a.id} canDecide={a.canDecide} canCancel={a.canCancel} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────────────────────── Mapa de férias (mês) ─────────────────────────

const WEEKDAY = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

async function VacationMap({ month, people, today }: { month: string; people: BalanceRow[]; today: string }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const absences = (await api<AbsenceRow[]>(`/v1/absences?from=${from}&to=${to}`)).filter((a) => a.status === 'approved' || a.status === 'pending');
  const holidays = new Map(labourRules('AO', y).holidays.map((h) => [h.date, h.name]));
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, n: i + 1, wd, weekend: wd === 0 || wd === 6, holiday: holidays.get(date) };
  });
  const shift = (delta: number) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const raw = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  const monthHolidays = days.filter((d) => d.holiday);
  const absentToday = absences.filter((a) => a.status === 'approved' && a.startDate <= today && a.endDate >= today);
  const usedTypes = [...new Set(absences.map((a) => a.type))];

  return (
    <>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="month-nav">
          <Link className="btn ghost sm" href={`?s=mapa&mes=${shift(-1)}`}>←</Link>
          <b>{label}</b>
          <Link className="btn ghost sm" href={`?s=mapa&mes=${shift(1)}`}>→</Link>
          <Link className="btn ghost sm" href="?s=mapa">Hoje</Link>
        </div>
        <span className="muted">{absentToday.length ? `Ausentes hoje: ${absentToday.map((a) => a.employee.name).join(', ')}` : 'Ninguém ausente hoje'}</span>
      </div>
      <div className="card">
        <div className="map-wrap">
          <table className="map">
            <thead>
              <tr>
                <th className="name">Colaborador</th>
                {days.map((d) => (
                  <th key={d.n} className={`day ${d.weekend ? 'we' : ''} ${d.holiday ? 'hol' : ''}`} title={d.holiday}>{d.n}<small>{WEEKDAY[d.wd]}</small></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const mine = absences.filter((a) => a.employee.id === p.employee.id);
                return (
                  <tr key={p.employee.id}>
                    <td className="name"><Link href={`/colaboradores/${p.employee.id}?s=ausencias`}><b>{p.employee.name}</b></Link><div className="muted">{p.available} dia(s) disponíveis</div></td>
                    {days.map((d) => {
                      const a = mine.find((x) => x.startDate <= d.date && x.endDate >= d.date);
                      const pol = a ? policy(a.type) : undefined;
                      const counts = a && !d.weekend && !d.holiday;
                      return (
                        <td key={d.n} className={`cell ${d.weekend ? 'we' : ''} ${d.holiday ? 'hol' : ''} ${d.date === today ? 'today' : ''}`}
                          title={a ? `${pol?.label} · ${ABSENCE_STATUS_LABEL[a.status]} · ${pt(a.startDate)}–${pt(a.endDate)}` : d.holiday}>
                          {counts && <span className={`bar ${a!.status}`} style={{ background: pol?.color }}>{pol?.label[0]}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend">
          {usedTypes.map((t) => <span key={t}><span className="dot" style={{ background: policy(t)?.color }} />{policy(t)?.label}</span>)}
          <span><span className="dot" style={{ background: '#fdeee9', border: '1px solid #f1c9c1' }} />Feriado</span>
          <span><span className="dot" style={{ background: '#f6f7f9', border: '1px solid #e6e8ec' }} />Fim-de-semana</span>
          <span className="muted">Barras tracejadas = pendentes de aprovação</span>
        </div>
      </div>
      {monthHolidays.length > 0 && (
        <p className="muted" style={{ marginTop: 10 }}>Feriados do mês: {monthHolidays.map((d) => `${d.n} — ${d.holiday}`).join(' · ')}</p>
      )}
    </>
  );
}

// ───────────────────────── Saldos ─────────────────────────

function Balances({ rows, year }: { rows: BalanceRow[]; year: number }) {
  const total = rows.reduce((s, r) => s + r.entitlement + r.carriedOver, 0);
  const taken = rows.reduce((s, r) => s + r.taken, 0);
  return (
    <>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="month-nav">
          <Link className="btn ghost sm" href={`?s=saldos&ano=${year - 1}`}>←</Link><b>{year}</b><Link className="btn ghost sm" href={`?s=saldos&ano=${year + 1}`}>→</Link>
        </div>
        <span className="muted">{taken} de {total} dias gozados ou aprovados ({total ? Math.round((taken / total) * 100) : 0}%)</span>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Colaborador</th><th>Pode gozar desde</th><th className="num">Direito</th><th className="num">Transitados</th><th className="num">Gozados/aprovados</th><th className="num">Pendentes</th><th className="num">Disponíveis</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const cap = Math.max(1, r.entitlement + r.carriedOver);
              return (
                <tr key={r.employee.id}>
                  <td><Link href={`/colaboradores/${r.employee.id}?s=ausencias`}><b>{r.employee.name}</b></Link><div className="muted">{r.employee.department ?? '—'}</div></td>
                  <td>{!r.eligibleFrom ? '—' : r.eligibleFrom <= `${year}-01-01` ? <span className="muted">Já elegível</span> : pt(r.eligibleFrom)}</td>
                  <td className="num">{r.entitlement}</td>
                  <td className="num">{r.carriedOver || '—'}</td>
                  <td className="num">{r.taken}</td>
                  <td className="num">{r.pending || '—'}</td>
                  <td className="num"><b style={{ color: r.available < 0 ? 'var(--red)' : undefined }}>{r.available}</b></td>
                  <td style={{ width: 160 }}>
                    <div className="meter" title={`${r.taken} gozados · ${r.pending} pendentes · ${r.available} disponíveis`}>
                      <i style={{ width: `${(r.taken / cap) * 100}%`, background: 'var(--brand)' }} />
                      <i style={{ width: `${(r.pending / cap) * 100}%`, background: '#7cc4b3' }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Sem colaboradores</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>Direito anual de 22 dias úteis; no ano de admissão, 2 dias por mês completo de serviço; gozo a partir dos 6 meses de serviço. Os dias transitados editam-se na ficha do colaborador.</p>
    </>
  );
}
