import { formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { ExtraSeatsForm, NewReference, ReferenceForm, RenewForm } from './forms';

export const dynamic = 'force-dynamic';

interface Req { id: string; number: string; kind: string; tierKey: string | null; cycle: string | null; seats: number | null; periodStart: string | null; periodEnd: string | null; amountMinor: number; status: string; payerReference: string | null; invoiceRef: string | null; createdAt: string; gatewayEntity: string | null; gatewayReference: string | null; gatewayExpiresAt: string | null; gatewayError: string | null; invoiceProvider: string | null; confirmedVia: string | null }
interface Billing {
  status: string; statusLabel: string; canWrite: boolean; tier: { key: string; label: string }; cycle: string; limit: number | null; activeEmployees: number;
  trialEndsAt: string | null; paidUntil: string | null; extraSeats: number; prices: { key: string; label: string; maxEmployees: number | null; prices: Record<string, { totalMinor: number; discountMinor: number } | null> }[];
  cycles: Record<string, { label: string }>; extraSeatMinor: number | null; bank: { holder: string; bankName: string; iban: string } | null; supportEmail: string | null; supportPhone: string | null; requests: Req[]; multicaixa: boolean; invoicesOnline: boolean;
}
const pt = (d: string) => d.split('-').reverse().join('/');
const ST: Record<string, string> = { trial: 'st pending', active: 'st approved', past_due: 'st pending', suspended: 'st rejected', cancelled: 'tag' };

export default async function Licenca() {
  const me = (await currentUser())!;
  if (!['owner', 'finance'].includes(me.user.role)) redirect('/');
  const b = await api<Billing>('/v1/billing');
  const pending = b.requests.filter((r) => r.status === 'pending');
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const daysLeft = b.trialEndsAt && b.status === 'trial' ? Math.max(0, Math.ceil((Date.parse(b.trialEndsAt) - Date.now()) / 86_400_000)) : null;
  const usage = b.limit ? Math.min(100, Math.round((b.activeEmployees / b.limit) * 100)) : 0;
  return (
    <>
      <h1>Licença</h1>
      {(b.supportEmail || b.supportPhone) && <p className="muted" style={{ float: 'right', marginTop: 4 }}>Suporte: {b.supportEmail && <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>}{b.supportEmail && b.supportPhone ? ' · ' : ''}{b.supportPhone && <a href={`tel:${b.supportPhone.replace(/\s/g, '')}`}>{b.supportPhone}</a>}</p>}
      <p className="sub">Escalão, pagamentos e colaboradores incluídos · código da empresa <b>{me.company?.code ?? '—'}</b></p>
      {!b.canWrite && <div className="alert">A conta está em <b>modo de consulta</b>: pode ver e exportar tudo, mas não gravar alterações até a licença ser regularizada.</div>}
      <div className="grid">
        <div className="card kpi"><div className="l">Estado</div><div className="v" style={{ fontSize: 18 }}><span className={ST[b.status]}>{b.statusLabel}</span></div><div className="muted">{daysLeft !== null ? `${daysLeft} dia(s) de experimental (até ${pt(b.trialEndsAt!)})` : b.paidUntil ? `pago até ${pt(b.paidUntil)}` : ''}</div></div>
        <div className="card kpi"><div className="l">Escalão</div><div className="v" style={{ fontSize: 18 }}>{b.tier.label}</div><div className="muted">pagamento {b.cycles[b.cycle]?.label.toLowerCase()}</div></div>
        <div className="card kpi"><div className="l">Colaboradores activos</div><div className="v">{b.activeEmployees}{b.limit ? <span className="muted" style={{ fontSize: 14 }}> de {b.limit}</span> : null}</div>
          {b.limit ? <div style={{ height: 6, background: '#eef0f3', borderRadius: 3, marginTop: 6 }}><div style={{ width: `${usage}%`, height: 6, borderRadius: 3, background: usage >= 90 ? 'var(--amber)' : 'var(--brand)' }} /></div> : null}
          <div className="muted">{b.extraSeats ? `inclui ${b.extraSeats} extra` : ''}</div></div>
      </div>
      {pending.length > 0 && (
        <div className="card section">
          <h2>Pagamentos por concluir</h2>
          {pending.map((r) => (
            <div key={r.id} style={{ padding: '6px 16px 14px', display: 'grid', gap: 8 }}>
              <div><b>{r.number}</b> · {r.kind === 'subscription' ? `${b.prices.find((x) => x.key === r.tierKey)?.label} · ${b.cycles[r.cycle!]?.label} · ${pt(r.periodStart!)} a ${pt(r.periodEnd!)}` : `${r.seats} colaborador(es) extra`} · <b>{formatKz(r.amountMinor)}</b></div>
              {r.gatewayReference && r.gatewayExpiresAt! >= today && (
                <div className="card" style={{ padding: 14, borderColor: 'var(--brand)', background: 'var(--brand-soft)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Pagar por referência Multicaixa (activação automática)</div>
                  <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                    {r.gatewayEntity && <div><div className="muted" style={{ fontSize: 12 }}>Entidade</div><div style={{ fontSize: 22, fontWeight: 700 }}>{r.gatewayEntity}</div></div>}
                    <div><div className="muted" style={{ fontSize: 12 }}>Referência</div><div style={{ fontSize: 22, fontWeight: 700 }}>{r.gatewayReference.replace(/(\d{3})(?=\d)/g, '$1 ')}</div></div>
                    <div><div className="muted" style={{ fontSize: 12 }}>Montante</div><div style={{ fontSize: 22, fontWeight: 700 }}>{formatKz(r.amountMinor)}</div></div>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>Multicaixa Express, ATM ou homebanking → Pagamentos → Pagamento por referência. Válida até {pt(r.gatewayExpiresAt!)}. A licença fica activa minutos depois do pagamento, sem enviar comprovativo.</div>
                </div>
              )}
              {b.multicaixa && (!r.gatewayReference || r.gatewayExpiresAt! < today) && (
                <div className="warn" style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.gatewayReference ? 'A referência Multicaixa expirou.' : 'Ainda não há referência Multicaixa para este pedido.'} <NewReference id={r.id} />
                </div>
              )}
              {b.bank ? <div className="warn" style={{ margin: 0 }}>{r.gatewayReference ? 'Em alternativa, transfira' : 'Transfira'} para <b>{b.bank.holder}</b> · {b.bank.bankName} · IBAN <b>{b.bank.iban.replace(/(.{4})/g, '$1 ')}</b> com o descritivo <b>{r.number}</b>. A activação é feita assim que a Kianda confirmar a recepção.</div> : <div className="warn" style={{ margin: 0 }}>Os dados bancários são enviados pelo suporte Kianda{[b.supportEmail, b.supportPhone].filter(Boolean).length ? ` (${[b.supportEmail, b.supportPhone].filter(Boolean).join(' · ')})` : ''}.</div>}
              {r.payerReference ? <div className="muted">Referência indicada: {r.payerReference} — a aguardar confirmação.</div> : <ReferenceForm id={r.id} />}
            </div>
          ))}
        </div>
      )}
      <div className="card section"><h2>Renovar ou mudar de escalão</h2><RenewForm prices={b.prices} currentTier={b.tier.key} currentCycle={b.cycle} activeEmployees={b.activeEmployees} cycles={b.cycles} /></div>
      {b.limit !== null && <div className="card section"><h2>Colaboradores acima do limite</h2><div style={{ padding: '0 16px 6px' }}><ExtraSeatsForm priceMinor={b.extraSeatMinor} /></div></div>}
      <div className="card section">
        <h2>Tabela de licenças</h2>
        <table className="dense">
          <thead><tr><th>Escalão</th>{Object.values(b.cycles).map((c) => <th key={c.label} className="num">{c.label}</th>)}</tr></thead>
          <tbody>{b.prices.map((x) => <tr key={x.key} style={x.key === b.tier.key ? { background: 'var(--brand-soft)' } : undefined}><td>{x.label}</td>{Object.keys(b.cycles).map((c) => <td key={c} className="num">{x.prices[c] ? formatKz(x.prices[c]!.totalMinor) : 'sob consulta'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {b.requests.some((r) => r.status !== 'pending') && (
        <div className="card section">
          <h2>Histórico</h2>
          <table className="dense"><tbody>{b.requests.filter((r) => r.status !== 'pending').map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.kind === 'subscription' ? `${pt(r.periodStart!)} a ${pt(r.periodEnd!)}` : `${r.seats} extra`}</td><td className="num">{formatKz(r.amountMinor)}</td><td>{r.status === 'paid' ? <span className="st approved">Pago</span> : <span className="tag">Cancelado</span>}</td><td className="muted">{r.invoiceRef ? (r.invoiceProvider === 'vendus' ? <a href={`/api/v1/billing/requests/${r.id}/invoice`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>Factura {r.invoiceRef} (PDF)</a> : `Factura ${r.invoiceRef}`) : r.status === 'paid' ? 'factura em emissão' : ''}{r.confirmedVia === 'gateway' ? ' · Multicaixa' : ''}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
