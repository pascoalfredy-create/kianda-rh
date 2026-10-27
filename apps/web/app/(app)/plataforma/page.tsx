import { DEFAULT_TIERS, formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { ConfirmPayment, EditSubscription, InvoicingForm, IssueInvoice, JobButtons, MockPayment, SettingsForm } from './forms';

export const dynamic = 'force-dynamic';

interface Co { id: string; name: string; nif: string; sectorLabel: string | null; code: string | null; createdAt: string | null; owner: { email: string; name: string } | null; activeEmployees: number; status: string; statusLabel: string; tierKey: string | null; tierLabel: string; cycle: string | null; limit: number | null; trialEndsAt: string | null; paidUntil: string | null; extraSeats: number; notes: string | null; monthlyMinor: number | null; pendingPayments: number }
interface Pay { id: string; number: string; company: string; nif: string; kind: string; tierKey: string | null; cycle: string | null; seats: number | null; periodStart: string | null; periodEnd: string | null; amountMinor: number; payerReference: string | null; payerNote: string | null; createdAt: string; gatewayEntity: string | null; gatewayReference: string | null; gatewayError: string | null }
interface Integrations {
  status: { proxypay: { enabled: boolean; environment: string | null; entity: string | null }; email: { enabled: boolean; from: string | null }; vendus: { enabled: boolean; mode: string | null }; baseUrl: string | null };
  invoicing: { autoIssue: boolean; taxId: 'NOR' | 'ISE'; exemptionCode: string | null; exemptionLaw: string | null; paymentMethodId: number | null; registerId: number | null };
  events: { id: string; externalId: string; reference: string | null; amountMinor: number | null; outcome: string; message: string | null; createdAt: string }[];
  emails: { id: string; toAddress: string; subject: string; kind: string; status: string; error: string | null; createdAt: string }[];
  invoiceIssues: { id: string; number: string; error: string | null; company: string }[];
}
const OUTCOME: Record<string, string> = { applied: 'Aplicado', duplicate: 'Repetido', unmatched: 'Sem pedido', amount_mismatch: 'Montante diferente', not_pending: 'Pedido já tratado' };
const MAIL: Record<string, string> = { sent: 'st approved', skipped: 'tag', failed: 'st rejected' };
const when = (d: string) => new Date(d).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });
const pt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const ST: Record<string, string> = { trial: 'st pending', active: 'st approved', past_due: 'st pending', suspended: 'st rejected', cancelled: 'tag' };

export default async function Plataforma() {
  const me = (await currentUser())!;
  if (!me.platformAdmin) redirect('/');
  const [{ companies, summary }, pays, settings, integ] = await Promise.all([
    api<{ companies: Co[]; summary: { total: number; trial: number; active: number; pastDue: number; suspended: number; mrrMinor: number } }>('/v1/platform/companies'),
    api<Pay[]>('/v1/platform/payment-requests'),
    api<{ extraSeatMinor: number | null; bank: { holder: string; bankName: string; iban: string } | null; supportEmail: string | null; supportPhone: string | null; admins: string[] }>('/v1/platform/settings'),
    api<Integrations>('/v1/platform/integrations'),
  ]);
  const st = integ.status;
  const sandbox = st.proxypay.enabled && st.proxypay.environment === 'sandbox';
  return (
    <>
      <h1>Plataforma Kianda</h1>
      <p className="sub">Empresas clientes, licenças e pagamentos · administradores: {settings.admins.join(', ')}</p>
      <div className="grid">
        <div className="card kpi"><div className="l">Empresas</div><div className="v">{summary.total}</div><div className="muted">{summary.trial} em experimental</div></div>
        <div className="card kpi"><div className="l">Activas (pagas)</div><div className="v">{summary.active}</div><div className="muted">{summary.pastDue} em atraso · {summary.suspended} suspensas</div></div>
        <div className="card kpi"><div className="l">Receita mensal recorrente</div><div className="v">{formatKz(summary.mrrMinor)}</div><div className="muted">valor mensal das licenças pagas</div></div>
        <div className="card kpi" style={pays.length ? { borderColor: '#f3d9a6' } : undefined}><div className="l">Pagamentos por confirmar</div><div className="v" style={{ color: pays.length ? 'var(--amber)' : undefined }}>{pays.length}</div></div>
      </div>
      {pays.length > 0 && (
        <div className="card section">
          <h2>Pagamentos por confirmar</h2>
          <table className="dense">
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.number}</b><div className="muted">{p.company} · NIF {p.nif}</div></td>
                  <td>{p.kind === 'subscription' ? `${DEFAULT_TIERS.find((t) => t.key === p.tierKey)?.label} · ${p.cycle} · ${pt(p.periodStart)}–${pt(p.periodEnd)}` : `${p.seats} extra`}<div><b>{formatKz(p.amountMinor)}</b></div></td>
                  <td>{p.gatewayReference && <div>Multicaixa <b>{p.gatewayReference}</b>{sandbox && <> · <MockPayment id={p.id} /></>}</div>}{p.gatewayError && <div className="err" style={{ fontSize: 12 }}>Gateway: {p.gatewayError}</div>}{p.payerReference ? <>Ref.: <b>{p.payerReference}</b>{p.payerNote ? <div className="muted">{p.payerNote}</div> : null}</> : !p.gatewayReference && <span className="muted">sem referência indicada</span>}</td>
                  <td className="num"><ConfirmPayment id={p.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead><tr><th>Empresa</th><th>Responsável</th><th>Licença</th><th className="num">Colaboradores</th><th>Validade</th><th /></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} style={{ verticalAlign: 'top' }}>
                <td><b>{c.name}</b><div className="muted">NIF {c.nif} · código {c.code ?? '—'}{c.sectorLabel ? ` · ${c.sectorLabel}` : ''}</div>{c.notes && <div className="muted">{c.notes}</div>}</td>
                <td>{c.owner?.name ?? '—'}<div className="muted">{c.owner?.email}</div></td>
                <td><span className={ST[c.status]}>{c.statusLabel}</span><div className="muted">{c.tierLabel}{c.cycle ? ` · ${c.cycle}` : ''}</div></td>
                <td className="num">{c.activeEmployees}{c.limit ? ` / ${c.limit}` : ''}</td>
                <td>{c.status === 'trial' ? `experimental até ${pt(c.trialEndsAt)}` : `pago até ${pt(c.paidUntil)}`}{c.pendingPayments ? <div><span className="tag future">{c.pendingPayments} pagamento(s) pendente(s)</span></div> : null}</td>
                <td className="num"><EditSubscription c={c} tiers={DEFAULT_TIERS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card section" style={{ marginTop: 16 }}><h2>Parâmetros comerciais</h2><SettingsForm s={settings} /></div>

      <div className="card section">
        <h2>Integrações</h2>
        <div className="grid" style={{ padding: '12px 16px 0', marginBottom: 0 }}>
          <div className="card kpi"><div className="l">Multicaixa (ProxyPay)</div><div className="v" style={{ fontSize: 16 }}><span className={st.proxypay.enabled ? 'st approved' : 'tag'}>{st.proxypay.enabled ? (st.proxypay.environment === 'production' ? 'Produção' : 'Testes (sandbox)') : 'Desligado'}</span></div><div className="muted">{st.proxypay.enabled ? `entidade ${st.proxypay.entity ?? 'por indicar'}` : 'secret KIANDA_PROXYPAY_API_KEY'}</div></div>
          <div className="card kpi"><div className="l">Email (Resend)</div><div className="v" style={{ fontSize: 16 }}><span className={st.email.enabled ? 'st approved' : 'tag'}>{st.email.enabled ? 'Ligado' : 'Desligado'}</span></div><div className="muted">{st.email.from ?? 'secret KIANDA_RESEND_API_KEY + variável KIANDA_MAIL_FROM'}</div></div>
          <div className="card kpi"><div className="l">Facturação AGT (Cegid Vendus)</div><div className="v" style={{ fontSize: 16 }}><span className={st.vendus.enabled ? 'st approved' : 'tag'}>{st.vendus.enabled ? (st.vendus.mode === 'normal' ? 'Produção' : 'Modo de testes') : 'Desligado'}</span></div><div className="muted">{st.vendus.enabled ? 'factura-recibo (FR) certificada' : 'secret KIANDA_VENDUS_API_KEY'}</div></div>
        </div>
        {st.proxypay.enabled && <p className="muted" style={{ padding: '10px 16px 0', fontSize: 12.5 }}>Webhook a indicar ao ProxyPay: <b>{st.baseUrl ?? 'https://<domínio>'}/api/v1/public/gateway/proxypay</b> (assinatura X-Signature).</p>}
        <JobButtons gateway={st.proxypay.enabled} />
        {st.vendus.enabled && <><h2 style={{ fontSize: 12, padding: '6px 16px 0' }}>Facturação</h2><InvoicingForm v={integ.invoicing} enabled={st.vendus.enabled} /></>}
        {integ.invoiceIssues.length > 0 && (
          <table className="dense"><thead><tr><th>Pago sem factura</th><th>Empresa</th><th>Último erro</th><th /></tr></thead>
            <tbody>{integ.invoiceIssues.map((x) => <tr key={x.id}><td>{x.number}</td><td>{x.company}</td><td className="muted" style={{ maxWidth: 380 }}>{x.error ?? '—'}</td><td className="num">{st.vendus.enabled ? <IssueInvoice id={x.id} /> : <span className="muted">registe o n.º ao confirmar</span>}</td></tr>)}</tbody></table>
        )}
      </div>

      {integ.events.length > 0 && (
        <div className="card section">
          <h2>Pagamentos recebidos do Multicaixa</h2>
          <table className="dense"><tbody>{integ.events.map((e) => <tr key={e.id}><td className="muted">{when(e.createdAt)}</td><td>Ref. {e.reference}</td><td className="num">{e.amountMinor !== null ? formatKz(e.amountMinor) : '—'}</td><td><span className={e.outcome === 'applied' ? 'st approved' : e.outcome === 'duplicate' ? 'tag' : 'st rejected'}>{OUTCOME[e.outcome] ?? e.outcome}</span></td><td className="muted">{e.message}</td></tr>)}</tbody></table>
        </div>
      )}

      <div className="card section">
        <h2>Emails recentes</h2>
        {integ.emails.length ? <table className="dense"><tbody>{integ.emails.map((e) => <tr key={e.id}><td className="muted">{when(e.createdAt)}</td><td>{e.toAddress}</td><td>{e.subject}</td><td><span className={MAIL[e.status] ?? 'tag'}>{e.status === 'sent' ? 'Enviado' : e.status === 'skipped' ? 'Não enviado' : 'Falhou'}</span>{e.error && e.status === 'failed' && <div className="muted" style={{ fontSize: 12 }}>{e.error}</div>}</td></tr>)}</tbody></table> : <div className="empty">Ainda não há emails.</div>}
      </div>
    </>
  );
}
