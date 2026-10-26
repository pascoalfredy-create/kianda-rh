import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { Btn, ManualMatch, NewAccount, PendingLines, StatementImport } from './actions';

export const dynamic = 'force-dynamic';

interface Account { id: string; name: string; bankName: string | null; iban: string | null; ledgerAccount: string; lastStatementTo: string | null; lastClosingBalanceMinor: number | null; pendingLines: number }
interface Line { id: string; date: string; description: string; reference: string | null; amountMinor: number; balanceMinor: number | null; status: 'pending' | 'matched' | 'out_of_scope'; note: string | null; matchId: string | null; match: { matchId: string; kind: string; rule: string; payment: string } | null }
interface Suggestion { key: string; lineIds: string[]; rule: string; auto: boolean }
interface Rec {
  summary: { pending: number; pendingDebits: number; matched: number; outOfScope: number; paymentsWithoutProof: number };
  lines: Line[];
  payments: { id: string; kind: string; label: string; period: string; paidOn: string; amountMinor: number; reference: string | null; withoutProof: boolean; suggestion: Suggestion | null }[];
  unpaid: { runId: string; kind: string; period: string; label: string; amountMinor: number; dueDate: string; candidate: Suggestion | null }[];
}
interface Statement { id: string; fileName: string; importedAt: string; fromDate: string | null; toDate: string | null; lineCount: number; newCount: number; closingBalanceMinor: number | null; balanceOk: boolean | null }

const pt = (d: string) => d.split('-').reverse().join('/');
const RULE: Record<string, string> = { valor_exacto: 'valor exacto', transferencias_individuais: 'transferências individuais' };
const per = (p: string) => `${p.slice(5)}/${p.slice(0, 4)}`;

export default async function Conciliacao({ searchParams }: { searchParams: Promise<{ conta?: string; s?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  if (!['owner', 'finance', 'payroll'].includes(me.user.role)) redirect('/');
  const canEdit = me.user.role === 'owner' || me.user.role === 'finance';
  const accounts = await api<Account[]>('/v1/bank/accounts');
  if (!accounts.length) {
    return (
      <>
        <h1>Conciliação bancária</h1>
        <p className="sub">Comece por indicar a conta bancária de onde saem os salários e as obrigações.</p>
        {canEdit ? <NewAccount first /> : <div className="card empty">Ainda não há contas bancárias. Peça às Finanças para criar.</div>}
      </>
    );
  }
  const acc = accounts.find((a) => a.id === sp.conta) ?? accounts[0]!;
  const status = (['pending', 'matched', 'out_of_scope', 'all'] as const).find((s) => s === sp.s) ?? 'pending';
  const [rec, statements] = await Promise.all([
    api<Rec>(`/v1/bank/reconciliation?accountId=${acc.id}&status=${status}`),
    api<Statement[]>(`/v1/bank/statements?accountId=${acc.id}`),
  ]);
  const pendingDebits = status === 'pending' ? rec.lines.filter((l) => l.amountMinor < 0) : (await api<Rec>(`/v1/bank/reconciliation?accountId=${acc.id}&status=pending`)).lines.filter((l) => l.amountMinor < 0);
  const lineById = new Map(pendingDebits.map((l) => [l.id, l]));
  const withCandidate = rec.unpaid.filter((u) => u.candidate);
  const href = (x: Record<string, string>) => `?${new URLSearchParams({ conta: acc.id, s: status, ...x })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conciliação bancária</h1>
          <p className="sub">Confronta o extracto do banco com os pagamentos de salários, INSS e IRT — e mostra o que foi pago sem comprovativo</p>
        </div>
        {canEdit && <NewAccount first={false} />}
      </div>

      {accounts.length > 1 && (
        <nav className="tabs">{accounts.map((a) => <Link key={a.id} href={`?conta=${a.id}`} className={a.id === acc.id ? 'on' : ''}>{a.name}{a.pendingLines ? ` (${a.pendingLines})` : ''}</Link>)}</nav>
      )}

      <div className="grid">
        <div className="card kpi"><div className="l">{acc.name} · conta PGC {acc.ledgerAccount}</div><div className="v">{acc.lastClosingBalanceMinor === null ? '—' : formatKz(acc.lastClosingBalanceMinor)}</div><div className="muted">{acc.lastStatementTo ? `saldo do extracto em ${pt(acc.lastStatementTo)}` : 'sem extractos importados'}</div></div>
        <div className="card kpi" style={rec.summary.paymentsWithoutProof ? { borderColor: '#f1c9c1' } : undefined}><div className="l">Pagamentos sem comprovativo bancário</div><div className="v" style={{ color: rec.summary.paymentsWithoutProof ? 'var(--red)' : undefined }}>{rec.summary.paymentsWithoutProof}</div><div className="muted">registados há mais de 5 dias sem movimento no extracto</div></div>
        <div className="card kpi"><div className="l">Saídas por conciliar</div><div className="v" style={{ color: rec.summary.pendingDebits ? 'var(--amber)' : undefined }}>{rec.summary.pendingDebits}</div><div className="muted">{rec.summary.pending - rec.summary.pendingDebits} entrada(s) por classificar</div></div>
        <div className="card kpi"><div className="l">Conciliados</div><div className="v">{rec.summary.matched}</div><div className="muted">{rec.summary.outOfScope} fora do âmbito (não são de pessoal)</div></div>
      </div>

      {canEdit && <StatementImport accountId={acc.id} />}

      {withCandidate.length > 0 && (
        <div className="card section">
          <h2>Obrigações pagas no banco mas não registadas no Kianda</h2>
          <table className="dense">
            <thead><tr><th>Obrigação</th><th>Prazo</th><th className="num">Valor</th><th>Movimento(s) no extracto</th><th /></tr></thead>
            <tbody>
              {withCandidate.map((u) => {
                const ls = u.candidate!.lineIds.map((id) => lineById.get(id)).filter(Boolean) as Line[];
                return (
                  <tr key={`${u.runId}${u.kind}`}>
                    <td><b>{u.label}</b> {per(u.period)}</td><td>{pt(u.dueDate)}</td><td className="num">{formatKz(u.amountMinor)}</td>
                    <td>{ls.length === 1 ? <>{pt(ls[0]!.date)} · {ls[0]!.description}</> : <>{ls.length} transferências individuais</>} <span className="tag">{RULE[u.candidate!.rule]}</span></td>
                    <td className="num">{canEdit && <Btn kind="ok" label="Registar pagamento" path="/v1/bank/register-payment" payload={{ accountId: acc.id, runId: u.runId, kind: u.kind, lineIds: u.candidate!.lineIds }} confirmText={`Registar o pagamento de ${u.label} ${per(u.period)} com a data e a referência do banco? Gera o lançamento contabilístico.`} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card section">
        <h2>Pagamentos registados por conciliar</h2>
        <table className="dense">
          <thead><tr><th>Pagamento</th><th>Registado em</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {rec.payments.map((p) => {
              const s = p.suggestion ? p.suggestion.lineIds.map((id) => lineById.get(id)).filter(Boolean) as Line[] : [];
              return (
                <tr key={p.id}>
                  <td><b>{p.label}</b> {per(p.period)}{p.reference && <div className="muted">{p.reference}</div>}</td>
                  <td>{pt(p.paidOn)}</td><td className="num">{formatKz(p.amountMinor)}</td>
                  <td>
                    {p.withoutProof ? <span className="st rejected">Sem comprovativo bancário</span> : <span className="st pending">Aguarda extracto</span>}
                    {s.length > 0 && <div className="muted">Possível: {s.length === 1 ? `${pt(s[0]!.date)} · ${s[0]!.description}` : `${s.length} movimentos`}</div>}
                  </td>
                  <td className="num">
                    {canEdit && s.length > 0 && <Btn kind="ok" label="Conciliar com este movimento" path="/v1/bank/matches" payload={{ accountId: acc.id, paymentId: p.id, lineIds: p.suggestion!.lineIds }} />}
                    {canEdit && <ManualMatch accountId={acc.id} paymentId={p.id} amountMinor={p.amountMinor} lines={pendingDebits} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rec.payments.length && <div className="empty">Todos os pagamentos registados têm comprovativo no extracto.</div>}
      </div>

      <div className="card section">
        <h2>Movimentos do extracto</h2>
        <nav className="tabs" style={{ padding: '0 16px', marginBottom: 0 }}>
          {[['pending', 'Por conciliar'], ['matched', 'Conciliados'], ['out_of_scope', 'Fora do âmbito'], ['all', 'Todos']].map(([k, l]) => <Link key={k} href={href({ s: k! })} className={status === k ? 'on' : ''}>{l}</Link>)}
        </nav>
        {status === 'pending' ? (
          rec.lines.length ? <PendingLines lines={rec.lines} canEdit={canEdit} /> : <div className="empty">Sem movimentos por conciliar.</div>
        ) : (
          <table className="dense">
            <thead><tr><th>Data</th><th>Descritivo</th><th className="num">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {rec.lines.map((l) => (
                <tr key={l.id}>
                  <td>{pt(l.date)}</td><td>{l.description}{l.reference && <div className="muted">{l.reference}</div>}</td>
                  <td className="num" style={{ color: l.amountMinor < 0 ? 'var(--red)' : undefined }}>{formatKz(l.amountMinor)}</td>
                  <td>
                    {l.status === 'matched' && <><span className="st approved">Conciliado</span> <span className="muted">{l.match?.payment} · {l.match?.kind === 'auto' ? 'automático' : 'manual'}</span></>}
                    {l.status === 'out_of_scope' && <><span className="tag">Fora do âmbito</span> <span className="muted">{l.note}</span></>}
                    {l.status === 'pending' && <span className="st pending">Por conciliar</span>}
                  </td>
                  <td className="num">
                    {canEdit && l.status === 'matched' && l.matchId && <Btn label="Desfazer" method="DELETE" path={`/v1/bank/matches/${l.matchId}`} confirmText="Desfazer esta conciliação? O pagamento volta a ficar sem comprovativo." />}
                    {canEdit && l.status === 'out_of_scope' && <Btn label="Repor" path={`/v1/bank/lines/${l.id}/restore`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {status !== 'pending' && !rec.lines.length && <div className="empty">Sem movimentos.</div>}
      </div>

      <div className="card section">
        <h2>Extractos importados</h2>
        <table className="dense">
          <thead><tr><th>Ficheiro</th><th>Período</th><th>Importado em</th><th className="num">Movimentos</th><th>Saldos</th><th /></tr></thead>
          <tbody>
            {statements.map((s) => (
              <tr key={s.id}>
                <td>{s.fileName}</td><td>{s.fromDate ? `${pt(s.fromDate)} a ${pt(s.toDate!)}` : '—'}</td>
                <td>{new Date(s.importedAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="num">{s.newCount} novos de {s.lineCount}</td>
                <td>{s.balanceOk === null ? <span className="muted">sem saldo</span> : s.balanceOk ? <span className="st approved">conferem</span> : <span className="st rejected">não conferem</span>}</td>
                <td className="num">{canEdit && <Btn kind="danger" label="Apagar" method="DELETE" path={`/v1/bank/statements/${s.id}`} confirmText={`Apagar o extracto ${s.fileName} e os seus movimentos?`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!statements.length && <div className="empty">Ainda não importou nenhum extracto.</div>}
      </div>
      <p className="muted">O Kianda só concilia movimentos de pessoal (salários, INSS, IRT). Os restantes movimentos do extracto — recebimentos de clientes, comissões, fornecedores — marcam-se como fora do âmbito e continuam a ser tratados no ERP.</p>
    </>
  );
}
