import { loadIntegrations, requirePlatformAdmin } from '../data';
import { InvoicingForm, JobButtons } from '../forms';

export const dynamic = 'force-dynamic';

/** Integrações: Multicaixa, email, ficheiros e facturação AGT, com as tarefas manuais. */
export default async function Integracoes() {
  const [, integ] = await Promise.all([requirePlatformAdmin(), loadIntegrations()]);
  const st = integ.status;
  return (
    <>
      <h1>Integrações</h1>
      <p className="sub">Serviços externos ligados ao Kianda e o estado de cada um.</p>
      <div className="card section">
        <h2>Estado dos serviços</h2>
        <div className="grid" style={{ padding: '12px 16px 0', marginBottom: 0 }}>
          <div className="card kpi">
            <div className="l">Multicaixa (ProxyPay)</div>
            <div className="v" style={{ fontSize: 16 }}>
              <span className={st.proxypay.enabled ? 'st approved' : 'tag'}>
                {st.proxypay.enabled
                  ? st.proxypay.environment === 'production'
                    ? 'Produção'
                    : 'Testes (sandbox)'
                  : 'Desligado'}
              </span>
            </div>
            <div className="muted">
              {st.proxypay.enabled
                ? `entidade ${st.proxypay.entity ?? 'por indicar'}`
                : 'secret KIANDA_PROXYPAY_API_KEY'}
            </div>
          </div>
          <div className="card kpi">
            <div className="l">Email (Resend)</div>
            <div className="v" style={{ fontSize: 16 }}>
              <span className={st.email.enabled ? 'st approved' : 'tag'}>
                {st.email.enabled ? 'Ligado' : 'Desligado'}
              </span>
            </div>
            <div className="muted">{st.email.from ?? 'secret KIANDA_RESEND_API_KEY + variável KIANDA_MAIL_FROM'}</div>
          </div>
          <div className="card kpi">
            <div className="l">Ficheiros</div>
            <div className="v" style={{ fontSize: 16 }}>
              <span className={st.files?.mode === 'r2' ? 'st approved' : 'tag'}>
                {st.files?.mode === 'r2' ? 'Cloudflare R2' : 'Base de dados'}
              </span>
            </div>
            <div className="muted">
              {st.files ? `${st.files.count} ficheiro(s), ${(st.files.bytes / 1048576).toFixed(1)} MB` : '—'}
              {st.files?.mode !== 'r2' ? ' · limite 250 MB por empresa' : ''}
            </div>
          </div>
          <div className="card kpi">
            <div className="l">Facturação AGT (Cegid Vendus)</div>
            <div className="v" style={{ fontSize: 16 }}>
              <span className={st.vendus.enabled ? 'st approved' : 'tag'}>
                {st.vendus.enabled ? (st.vendus.mode === 'normal' ? 'Produção' : 'Modo de testes') : 'Desligado'}
              </span>
            </div>
            <div className="muted">
              {st.vendus.enabled ? 'factura-recibo (FR) certificada' : 'secret KIANDA_VENDUS_API_KEY'}
            </div>
          </div>
        </div>
        {st.proxypay.enabled && (
          <p className="muted" style={{ padding: '10px 16px 0', fontSize: 12.5 }}>
            Webhook a indicar ao ProxyPay: <b>{st.baseUrl ?? 'https://<domínio>'}/api/v1/public/gateway/proxypay</b>{' '}
            (assinatura X-Signature).
          </p>
        )}
        <JobButtons gateway={st.proxypay.enabled} />
        {st.vendus.enabled && (
          <>
            <h2 style={{ fontSize: 12, padding: '6px 16px 0' }}>Facturação</h2>
            <InvoicingForm v={integ.invoicing} enabled={st.vendus.enabled} />
          </>
        )}
      </div>
    </>
  );
}
