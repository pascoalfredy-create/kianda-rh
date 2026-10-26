import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { currentPeriod, monthLabel, shiftMonth } from '@/lib/format';
import { ChartForm, MarkExported } from './actions';

export const dynamic = 'force-dynamic';

interface TbRow { account: string; label: string; class: string; classLabel: string; openingMinor: number; debitMinor: number; creditMinor: number; closingMinor: number }
interface Entry { id: string; date: string; journal: string; reference: string; description: string; source: string; exportedAt: string | null; debitMinor: number; creditMinor: number; lines: { account: string; description: string; costCenter: string | null; debitMinor: number; creditMinor: number }[] }

const pt = (d: string) => d.split('-').reverse().join('/');
const k = (v: number) => (v ? formatKz(v) : '');
const lastDay = (p: string) => { const [y, m] = p.split('-').map(Number) as [number, number]; return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const SOURCE: Record<string, string> = { payroll: 'Processamento', payroll_payment: 'Pagamento' };

export default async function Financas({ searchParams }: { searchParams: Promise<{ s?: string; de?: string; ate?: string; conta?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  if (!['owner', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const editable = me.user.role === 'owner' || me.user.role === 'finance';
  const period = currentPeriod();
  const from = sp.de ?? `${period}-01`;
  const to = sp.ate ?? lastDay(period);
  const tab = sp.s ?? 'balancete';
  const q = (extra: Record<string, string> = {}) => `?${new URLSearchParams({ s: tab, de: from, ate: to, ...extra })}`;
  const month = from.slice(0, 7);
  const isMonth = from === `${month}-01` && to === lastDay(month);

  return (
    <>
      <h1>Finanças de pessoal</h1>
      <p className="sub">Lançamentos do processamento e dos pagamentos segundo o PGC Angola (Decreto n.º 82/2001) — diário, balancete, razão e exportação para o ERP</p>
      <form className="card form" style={{ marginBottom: 14, gridTemplateColumns: 'auto 160px 160px auto auto 1fr', alignItems: 'end' }}>
        <input type="hidden" name="s" value={tab} />
        <div className="month-nav" style={{ alignSelf: 'end' }}>
          <Link className="btn ghost sm" href={`?${new URLSearchParams({ s: tab, de: `${shiftMonth(month, -1)}-01`, ate: lastDay(shiftMonth(month, -1)) })}`}>←</Link>
          <b style={{ minWidth: 130 }}>{isMonth ? monthLabel(month) : 'Período livre'}</b>
          <Link className="btn ghost sm" href={`?${new URLSearchParams({ s: tab, de: `${shiftMonth(month, 1)}-01`, ate: lastDay(shiftMonth(month, 1)) })}`}>→</Link>
        </div>
        <label>De<input type="date" name="de" defaultValue={from} /></label>
        <label>Até<input type="date" name="ate" defaultValue={to} /></label>
        <button className="btn ghost">Aplicar</button>
        <Link className="btn ghost" href={`?${new URLSearchParams({ s: tab, de: `${from.slice(0, 4)}-01-01`, ate: `${from.slice(0, 4)}-12-31` })}`}>Ano {from.slice(0, 4)}</Link>
        <span />
      </form>
      <nav className="tabs">
        {[['balancete', 'Balancete'], ['diario', 'Diário'], ['razao', 'Razão'], ['plano', 'Plano de contas'], ['exportar', 'Exportar para o ERP']].map(([key, label]) => (
          <Link key={key} href={`?${new URLSearchParams({ s: key, de: from, ate: to })}`} className={tab === key ? 'on' : ''}>{label}</Link>
        ))}
      </nav>
      {tab === 'balancete' && <TrialBalance from={from} to={to} link={(code) => `?${new URLSearchParams({ s: 'razao', de: from, ate: to, conta: code })}`} />}
      {tab === 'diario' && <Journal from={from} to={to} />}
      {tab === 'razao' && <Ledger from={from} to={to} code={sp.conta} q={q} />}
      {tab === 'plano' && <Chart editable={editable} />}
      {tab === 'exportar' && <Export from={from} to={to} editable={editable} />}
    </>
  );
}

async function TrialBalance({ from, to, link }: { from: string; to: string; link: (code: string) => string }) {
  const tb = await api<{ rows: TbRow[]; totals: { debitMinor: number; creditMinor: number; balanced: boolean } }>(`/v1/ledger/trial-balance?from=${from}&to=${to}`);
  const classes = [...new Set(tb.rows.map((r) => r.class))];
  const D = (v: number) => (v > 0 ? formatKz(v) : '');
  const C = (v: number) => (v < 0 ? formatKz(-v) : '');
  return (
    <>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <span>{tb.totals.balanced ? <span className="st approved">Débitos = créditos</span> : <span className="st rejected">Desequilibrado</span>} <span className="muted">{pt(from)} a {pt(to)}</span></span>
        <a className="btn ghost sm" href={`/api/v1/ledger/trial-balance?from=${from}&to=${to}&format=csv`}>Exportar balancete (CSV)</a>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead>
            <tr><th rowSpan={2}>Conta</th><th rowSpan={2}>Descrição</th><th colSpan={2} style={{ textAlign: 'center' }}>Saldo inicial</th><th colSpan={2} style={{ textAlign: 'center' }}>Movimentos do período</th><th colSpan={2} style={{ textAlign: 'center' }}>Saldo final</th></tr>
            <tr><th className="num">Devedor</th><th className="num">Credor</th><th className="num">Débito</th><th className="num">Crédito</th><th className="num">Devedor</th><th className="num">Credor</th></tr>
          </thead>
          <tbody>
            {classes.map((cl) => {
              const rows = tb.rows.filter((r) => r.class === cl);
              return [
                <tr key={`h${cl}`}><td colSpan={8} style={{ background: '#fafbfc', fontWeight: 700, fontSize: 12.5 }}>{rows[0]!.classLabel}</td></tr>,
                ...rows.map((r) => (
                  <tr key={r.account}>
                    <td><Link href={link(r.account)}><b>{r.account}</b></Link></td>
                    <td>{r.label || <span className="muted">—</span>}</td>
                    <td className="num">{D(r.openingMinor)}</td><td className="num">{C(r.openingMinor)}</td>
                    <td className="num">{k(r.debitMinor)}</td><td className="num">{k(r.creditMinor)}</td>
                    <td className="num"><b>{D(r.closingMinor)}</b></td><td className="num"><b>{C(r.closingMinor)}</b></td>
                  </tr>
                )),
              ];
            })}
          </tbody>
          <tfoot><tr><td colSpan={4}><b>Totais do período</b></td><td className="num"><b>{formatKz(tb.totals.debitMinor)}</b></td><td className="num"><b>{formatKz(tb.totals.creditMinor)}</b></td><td colSpan={2} /></tr></tfoot>
        </table>
        {!tb.rows.length && <div className="empty">Sem lançamentos até {pt(to)}</div>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>Inclui só os lançamentos gerados pelo Kianda (processamento e pagamentos de pessoal). Clique numa conta para ver o razão.</p>
    </>
  );
}

async function Journal({ from, to }: { from: string; to: string }) {
  const entries = await api<Entry[]>(`/v1/ledger/journal?from=${from}&to=${to}`);
  return (
    <>
      {entries.map((e) => (
        <div className="card section" key={e.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px 0', gap: 10, flexWrap: 'wrap' }}>
            <span><b>{e.reference}</b> · {pt(e.date)} · diário {e.journal} · <span className="muted">{e.description}</span></span>
            <span><span className="tag">{SOURCE[e.source] ?? e.source}</span> {e.exportedAt ? <span className="tag future">exportado</span> : null}</span>
          </div>
          <table className="dense">
            <tbody>
              {e.lines.map((l, i) => (
                <tr key={i}><td style={{ width: 110 }}><b>{l.account}</b></td><td>{l.description}</td><td className="muted" style={{ width: 90 }}>{l.costCenter ?? ''}</td><td className="num" style={{ width: 160 }}>{k(l.debitMinor)}</td><td className="num" style={{ width: 160 }}>{k(l.creditMinor)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3} /><td className="num"><b>{formatKz(e.debitMinor)}</b></td><td className="num"><b>{formatKz(e.creditMinor)}</b></td></tr></tfoot>
          </table>
        </div>
      ))}
      {!entries.length && <div className="card empty">Sem lançamentos de {pt(from)} a {pt(to)}</div>}
    </>
  );
}

async function Ledger({ from, to, code, q }: { from: string; to: string; code?: string; q: (x?: Record<string, string>) => string }) {
  const plan = await api<{ account: string; label: string }[]>('/v1/ledger/accounts');
  const r = code ? await api<{ label: string; openingMinor: number; closingMinor: number; movements: { date: string; reference: string; description: string; debitMinor: number; creditMinor: number; balanceMinor: number }[] }>(`/v1/ledger/account?code=${encodeURIComponent(code)}&from=${from}&to=${to}`) : null;
  const bal = (v: number) => (v === 0 ? '0,00' : `${formatKz(Math.abs(v))} ${v > 0 ? 'D' : 'C'}`);
  return (
    <>
      <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 12, flexWrap: 'wrap' }}>
        {plan.map((p) => <Link key={p.account} href={q({ conta: p.account })} className={`tag ${p.account === code ? 'future' : ''}`} title={p.label}>{p.account}</Link>)}
      </div>
      {!r ? <div className="card empty">Escolha uma conta.</div> : (
        <div className="card section">
          <h2>{code} — {r.label || 'conta'}</h2>
          <table className="dense">
            <thead><tr><th>Data</th><th>Referência</th><th>Descrição</th><th className="num">Débito</th><th className="num">Crédito</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr><td colSpan={5} className="muted">Saldo inicial em {pt(from)}</td><td className="num">{bal(r.openingMinor)}</td></tr>
              {r.movements.map((m, i) => <tr key={i}><td>{pt(m.date)}</td><td>{m.reference}</td><td>{m.description}</td><td className="num">{k(m.debitMinor)}</td><td className="num">{k(m.creditMinor)}</td><td className="num"><b>{bal(m.balanceMinor)}</b></td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={5}><b>Saldo final em {pt(to)}</b></td><td className="num"><b>{bal(r.closingMinor)}</b></td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

async function Chart({ editable }: { editable: boolean }) {
  const rows = await api<{ role: string; account: string; label: string; expectedClass: string; group: string; isDefault: boolean }[]>('/v1/ledger/accounts');
  return (
    <>
      <div className="warn">Os códigos sugeridos devem ser confirmados com o plano de contas da empresa (em particular a conta do INSS a pagar). As alterações aplicam-se aos <b>próximos</b> lançamentos; os já gerados não mudam.</div>
      <ChartForm rows={rows} editable={editable} />
    </>
  );
}

async function Export({ from, to, editable }: { from: string; to: string; editable: boolean }) {
  const entries = await api<Entry[]>(`/v1/ledger/journal?from=${from}&to=${to}`);
  const pending = entries.filter((e) => !e.exportedAt).length;
  return (
    <div className="card section">
      <h2>Exportar lançamentos de {pt(from)} a {pt(to)}</h2>
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <p>{entries.length} lançamento(s) no período · <b>{pending}</b> por exportar.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <a className="btn" href={`/api/v1/ledger/export?from=${from}&to=${to}&onlyNew=1`}>Descarregar só os novos (CSV)</a>
          <a className="btn ghost" href={`/api/v1/ledger/export?from=${from}&to=${to}`}>Descarregar todos (CSV)</a>
          {editable && <MarkExported from={from} to={to} pending={pending} />}
        </div>
        <p className="muted">Fluxo recomendado: descarregar os novos → importar no ERP → marcar como exportados. Assim nenhum lançamento é importado duas vezes. Colunas: data, diário, referência, descrição, conta, descrição da linha, centro de custo, débito, crédito, origem (formato CSV para Excel; o mapeamento de colunas do ERP pode exigir ajuste).</p>
      </div>
    </div>
  );
}
