import { CYCLES, DEFAULT_TIERS, MODELING_PLANS, VALUATION_PLANS, formatKz } from '@kianda/core';
import { OUTCOME, loadIntegrations, loadPayments, pt, requirePlatformAdmin, when } from '../data';
import { ConfirmPayment, IssueInvoice, MockPayment } from '../forms';

export const dynamic = 'force-dynamic';

/** Pagamentos: os que esperam confirmação, os pagos sem factura e o que o Multicaixa comunicou. */
export default async function Pagamentos() {
  const [, pays, integ] = await Promise.all([requirePlatformAdmin(), loadPayments(), loadIntegrations()]);
  const st = integ.status;
  const sandbox = st.proxypay.enabled && st.proxypay.environment === 'sandbox';
  return (
    <>
      <h1>Pagamentos</h1>
      <p className="sub">Confirme os pagamentos das subscrições e acompanhe a facturação.</p>
      <div className="card section">
        <h2>Por confirmar ({pays.length})</h2>
        {pays.length === 0 ? (
          <div className="empty">Nenhum pagamento por confirmar.</div>
        ) : (
          <table className="dense">
            <tbody>
              {pays.map(p => (
                <tr key={p.id}>
                  <td>
                    <b>{p.number}</b>
                    <div className="muted">
                      {p.company} · NIF {p.nif}
                    </div>
                  </td>
                  <td>
                    {p.kind === 'valuation_subscription'
                      ? `Valora · ${VALUATION_PLANS.find(plan => plan.key === p.tierKey)?.label} · ${p.projectLimit === null ? 'análises ilimitadas' : `até ${p.projectLimit} análises`} · ${5 + (p.extraUsers ?? 0)} utilizadores · ${CYCLES[p.cycle as keyof typeof CYCLES]?.label} · ${pt(p.periodStart)}–${pt(p.periodEnd)}`
                      : p.kind === 'modeling_subscription'
                        ? `Modelagem · ${MODELING_PLANS.find(plan => plan.key === p.tierKey)?.label} · ${p.projectLimit === null ? 'projectos ilimitados' : `até ${p.projectLimit} projectos`} · ${5 + (p.extraUsers ?? 0)} utilizadores · ${CYCLES[p.cycle as keyof typeof CYCLES]?.label} · ${pt(p.periodStart)}–${pt(p.periodEnd)}`
                        : p.kind === 'subscription'
                          ? `RH · ${DEFAULT_TIERS.find(t => t.key === p.tierKey)?.label ?? p.tierKey} · ${p.cycle} · ${pt(p.periodStart)}–${pt(p.periodEnd)}`
                          : `RH · ${p.seats} extra`}
                    <div>
                      <b>{formatKz(p.amountMinor)}</b>
                    </div>
                  </td>
                  <td>
                    {p.gatewayReference && (
                      <div>
                        Multicaixa <b>{p.gatewayReference}</b>
                        {sandbox && (
                          <>
                            {' '}
                            · <MockPayment id={p.id} />
                          </>
                        )}
                      </div>
                    )}
                    {p.gatewayError && (
                      <div className="err" style={{ fontSize: 12 }}>
                        Gateway: {p.gatewayError}
                      </div>
                    )}
                    {p.payerReference ? (
                      <>
                        Ref.: <b>{p.payerReference}</b>
                        {p.payerNote ? <div className="muted">{p.payerNote}</div> : null}
                      </>
                    ) : (
                      !p.gatewayReference && <span className="muted">sem referência indicada</span>
                    )}
                  </td>
                  <td className="num">
                    {p.kind === 'extra_seats' ? (
                      <span className="tag">Cobrança descontinuada</span>
                    ) : (
                      <ConfirmPayment id={p.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card section" id="sem-factura">
        <h2>Pagos sem factura emitida</h2>
        {integ.invoiceIssues.length === 0 ? (
          <div className="empty">Todos os pagamentos confirmados têm factura.</div>
        ) : (
          <table className="dense">
            <thead>
              <tr>
                <th>Pago sem factura</th>
                <th>Empresa</th>
                <th>Último erro</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {integ.invoiceIssues.map(x => (
                <tr key={x.id}>
                  <td>{x.number}</td>
                  <td>{x.company}</td>
                  <td className="muted" style={{ maxWidth: 380 }}>
                    {x.error ?? '—'}
                  </td>
                  <td className="num">
                    {st.vendus.enabled ? (
                      <IssueInvoice id={x.id} />
                    ) : (
                      <span className="muted">registe o n.º ao confirmar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card section">
        <h2>Recebidos do Multicaixa</h2>
        {integ.events.length === 0 ? (
          <div className="empty">Ainda não chegou nenhum pagamento do Multicaixa.</div>
        ) : (
          <table className="dense">
            <tbody>
              {integ.events.map(e => (
                <tr key={e.id}>
                  <td className="muted">{when(e.createdAt)}</td>
                  <td>Ref. {e.reference}</td>
                  <td className="num">{e.amountMinor !== null ? formatKz(e.amountMinor) : '—'}</td>
                  <td>
                    <span
                      className={
                        e.outcome === 'applied' ? 'st approved' : e.outcome === 'duplicate' ? 'tag' : 'st rejected'
                      }
                    >
                      {OUTCOME[e.outcome] ?? e.outcome}
                    </span>
                  </td>
                  <td className="muted">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
