import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { currentPeriod, monthLabel, shiftMonth } from '@/lib/format';
import { PAYROLL_ROLES, VARIABLE_LABEL, type EmployeeRow, type JournalRow, type PayrollLineRow, type PayrollRunDetail, type PayrollVariableRow } from '@/lib/types';
import { AddVariable, CloseButton, DeleteVariable, PrepareButton, SubsidyToggle } from './actions';

export const dynamic = 'force-dynamic';

const sumCode = (l: PayrollLineRow, ...codes: string[]) => l.breakdown.filter((b) => codes.includes(b.code)).reduce((s, b) => s + b.amountMinor, 0);
const k = (v: number) => (v ? formatKz(v).replace(' Kz', '') : '—');

export default async function Processamento({ searchParams }: { searchParams: Promise<{ mes?: string; s?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const role = me.user.role;
  if (!PAYROLL_ROLES.includes(role)) redirect('/');
  const period = sp.mes ?? currentPeriod();
  const tab = sp.s ?? 'resumo';
  const canPrepare = role === 'owner' || role === 'payroll';
  const canClose = role === 'owner' || role === 'finance';
  const [found] = await api<{ id: string }[]>(`/v1/payroll-runs?period=${period}`);
  const run = found ? await api<PayrollRunDetail>(`/v1/payroll-runs/${found.id}`) : null;
  const variables = await api<PayrollVariableRow[]>(`/v1/payroll-variables?period=${period}`);
  const draft = run?.status === 'draft';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Processamento salarial</h1>
          <p className="sub">IRT Grupo A, INSS, horas extra aprovadas, faltas, subsídios e variáveis do mês · {run?.packVersion ?? 'regras do ano'}</p>
        </div>
        <div className="month-nav">
          <Link className="btn ghost sm" href={`?mes=${shiftMonth(period, -1)}&s=${tab}`}>←</Link>
          <b>{monthLabel(period)}</b>
          <Link className="btn ghost sm" href={`?mes=${shiftMonth(period, 1)}&s=${tab}`}>→</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {run ? <span className={`status-chip ${run.status}`}>{run.status === 'closed' ? 'Fechado' : 'Rascunho'}</span> : <span className="status-chip draft">Por preparar</span>}
        <span className="muted" style={{ flex: 1 }}>
          {run ? <>Preparado por {run.preparedByName ?? '—'}{run.closedAt ? ` · fechado por ${run.closedByName ?? '—'} em ${new Date(run.closedAt).toLocaleDateString('pt-PT')}` : ''}</> : 'Ainda não há processamento para este mês.'}
        </span>
        {canPrepare && (!run || draft) && <PrepareButton period={period} label={run ? 'Recalcular' : 'Preparar processamento'} />}
        {run?.status === 'closed' && <Link href="/obrigacoes" className="btn ghost">Pagamentos e mapas →</Link>}
        {canClose && draft && <CloseButton runId={run!.id} period={period} selfPrepared={run!.preparedBy === me.user.sub} />}
      </div>

      {run && run.warnings.length > 0 && (
        <div className="warn"><b>{run.warnings.length} aviso(s)</b><ul>{run.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></div>
      )}

      <nav className="tabs">
        {[['resumo', 'Folha'], ['variaveis', `Variáveis (${variables.length})`], ...(run?.status === 'closed' ? [['lancamento', 'Lançamento PGC']] : [])].map(([key, label]) => (
          <Link key={key} href={`?mes=${period}&s=${key}`} className={tab === key ? 'on' : ''}>{label}</Link>
        ))}
      </nav>

      {tab === 'resumo' && (run ? <Sheet run={run} editable={draft && canPrepare} /> : <div className="card empty">Prepare o processamento para ver a folha de {monthLabel(period)}.</div>)}
      {tab === 'variaveis' && <Variables period={period} rows={variables} editable={canPrepare && run?.status !== 'closed'} />}
      {tab === 'lancamento' && run?.status === 'closed' && <Journal period={period} />}
    </>
  );
}

function Sheet({ run, editable }: { run: PayrollRunDetail; editable: boolean }) {
  const t = run.lines.reduce((a, l) => ({
    gross: a.gross + l.grossMinor, inss: a.inss + l.inssEmployeeMinor, irt: a.irt + l.irtMinor, net: a.net + l.netMinor, employer: a.employer + l.inssEmployerMinor,
  }), { gross: 0, inss: 0, irt: 0, net: 0, employer: 0 });
  const noIban = run.lines.filter((l) => !l.employee.hasIban).length;
  return (
    <>
      <div className="grid">
        <div className="card kpi"><div className="l">Ilíquido</div><div className="v">{formatKz(t.gross)}</div></div>
        <div className="card kpi"><div className="l">IRT retido</div><div className="v">{formatKz(t.irt)}</div></div>
        <div className="card kpi"><div className="l">INSS (3% + 8%)</div><div className="v">{formatKz(t.inss + t.employer)}</div></div>
        <div className="card kpi"><div className="l">Líquido a pagar</div><div className="v" style={{ color: 'var(--brand)' }}>{formatKz(t.net)}</div>{noIban > 0 && <div className="muted" style={{ fontSize: 12, color: 'var(--red)' }}>{noIban} sem IBAN</div>}</div>
        <div className="card kpi"><div className="l">Custo total empresa</div><div className="v">{formatKz(t.gross + t.employer)}</div></div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead><tr>
            <th>Colaborador</th><th className="num">Base</th><th className="num">Subs. alim./transp.</th><th className="num">H. extra</th><th>Subsídios</th><th className="num">Prémios/abonos</th>
            <th className="num">Faltas</th><th className="num">Ilíquido</th><th className="num">INSS</th><th className="num">IRT</th><th className="num">Outros desc.</th><th className="num">Líquido</th><th />
          </tr></thead>
          <tbody>
            {run.lines.map((l) => {
              const ov = run.subsidyOverrides[l.employeeId] ?? {};
              return (
                <tr key={l.id}>
                  <td><b>{l.employee.name}</b><div className="muted">N.º {l.employee.number} · escalão {l.irtBracket}</div></td>
                  <td className="num">{k(sumCode(l, 'BASE'))}</td>
                  <td className="num">{k(sumCode(l, 'ALIM', 'TRANSP'))}</td>
                  <td className="num">{Number(l.overtimeHours) ? <>{k(sumCode(l, 'HE'))}<div className="muted">{l.overtimeHours} h</div></> : '—'}</td>
                  <td>
                    {editable ? (
                      <>
                        <SubsidyToggle runId={run.id} employeeId={l.employeeId} kind="holiday" paid={sumCode(l, 'SUBFER') > 0} override={ov.holiday} />
                        <SubsidyToggle runId={run.id} employeeId={l.employeeId} kind="christmas" paid={sumCode(l, 'SUBNAT') > 0} override={ov.christmas} />
                      </>
                    ) : null}
                    {sumCode(l, 'SUBFER', 'SUBNAT') ? <div className="muted">{k(sumCode(l, 'SUBFER', 'SUBNAT'))}</div> : !editable && '—'}
                  </td>
                  <td className="num">{k(sumCode(l, 'BONUS', 'OUTABON'))}</td>
                  <td className="num">{l.absenceDays ? <span style={{ color: 'var(--red)' }}>{k(sumCode(l, 'FALTAS'))}<div className="muted">{l.absenceDays} dia(s)</div></span> : '—'}</td>
                  <td className="num"><b>{k(l.grossMinor)}</b></td>
                  <td className="num">{k(l.inssEmployeeMinor)}</td>
                  <td className="num">{k(l.irtMinor)}</td>
                  <td className="num">{k(sumCode(l, 'ADIANT', 'OUTDESC'))}</td>
                  <td className="num"><b style={{ color: 'var(--brand)' }}>{k(l.netMinor)}</b></td>
                  <td className="num"><Link href={`/recibos/${l.id}`} className="tag">Recibo</Link></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td><b>Total ({run.lines.length})</b></td><td colSpan={6} /><td className="num"><b>{k(t.gross)}</b></td><td className="num"><b>{k(t.inss)}</b></td><td className="num"><b>{k(t.irt)}</b></td><td /><td className="num"><b>{k(t.net)}</b></td><td />
          </tr></tfoot>
        </table>
      </div>
      {editable && <p className="muted" style={{ marginTop: 10 }}>SF / SN: subsídio de férias / Natal. Verde = incluído. Clique para incluir ou excluir manualmente (contorno azul = decisão manual; clique de novo para voltar à regra automática). Valores em kwanzas.</p>}
    </>
  );
}

async function Variables({ period, rows, editable }: { period: string; rows: PayrollVariableRow[]; editable: boolean }) {
  const people = editable ? (await api<EmployeeRow[]>('/v1/employees')).filter((e) => e.status === 'active').map((e) => ({ id: e.id, name: e.name })) : [];
  return (
    <>
      {editable && <div style={{ marginBottom: 14 }}><AddVariable period={period} people={people} /></div>}
      <div className="card">
        <table>
          <thead><tr><th>Colaborador</th><th>Tipo</th><th>Descrição</th><th className="num">Valor</th><th>Incidência</th><th /></tr></thead>
          <tbody>
            {rows.map((v) => {
              const earning = v.kind === 'bonus' || v.kind === 'other_earning';
              return (
                <tr key={v.id}>
                  <td><b>{v.employee.name}</b></td>
                  <td><span className={`tag ${earning ? 'future' : ''}`}>{VARIABLE_LABEL[v.kind]}</span></td>
                  <td>{v.label}</td>
                  <td className="num" style={{ color: earning ? undefined : 'var(--red)' }}>{earning ? '' : '−'}{formatKz(v.amountMinor)}</td>
                  <td className="muted">{earning ? [v.inInss && 'INSS', v.inIrt && 'IRT'].filter(Boolean).join(' + ') || 'Isento' : '—'}</td>
                  <td className="num">{editable && <DeleteVariable id={v.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Sem variáveis lançadas para {monthLabel(period)}</div>}
      </div>
    </>
  );
}

async function Journal({ period }: { period: string }) {
  const all = await api<JournalRow[]>('/v1/journal').catch(() => [] as JournalRow[]);
  const je = all.find((j) => j.reference === `PS-${period.replace('-', '')}`);
  if (!je) return <div className="card empty">Sem lançamento para este período (ou sem permissão para o ver).</div>;
  const d = je.lines.reduce((s, l) => s + l.debitMinor, 0);
  const c = je.lines.reduce((s, l) => s + l.creditMinor, 0);
  return (
    <div className="card section">
      <h2>{je.reference} · {je.description} · diário {`"Pessoal"`}</h2>
      <table>
        <thead><tr><th>Conta PGC</th><th>Descrição</th><th>Centro de custo</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
        <tbody>
          {je.lines.map((l, i) => (
            <tr key={i}><td><b>{l.account}</b></td><td>{l.description}</td><td className="muted">{l.costCenter ?? '—'}</td><td className="num">{l.debitMinor ? formatKz(l.debitMinor) : ''}</td><td className="num">{l.creditMinor ? formatKz(l.creditMinor) : ''}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}><b>Totais</b> {d === c ? <span className="st approved">equilibrado</span> : <span className="st rejected">desequilibrado</span>}</td><td className="num"><b>{formatKz(d)}</b></td><td className="num"><b>{formatKz(c)}</b></td></tr></tfoot>
      </table>
      <p className="muted" style={{ padding: '10px 16px' }}>Classe 7 (custos com o pessoal) a débito, por centro de custo; 34 (Estado: IRT e INSS) e 36 (Pessoal: remunerações a pagar, adiantamentos, outros) a crédito — PGC Angola, Decreto n.º 82/2001. Contas parametrizáveis por empresa.</p>
    </div>
  );
}
