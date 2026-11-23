import { MAIL, loadIntegrations, requirePlatformAdmin, when } from '../data';

export const dynamic = 'force-dynamic';

/** Emails enviados pelo Kianda: confirmações, avisos e recibos, com o estado de cada envio. */
export default async function Emails() {
  const [, integ] = await Promise.all([requirePlatformAdmin(), loadIntegrations()]);
  return (
    <>
      <h1>Emails</h1>
      <p className="sub">Os emails mais recentes enviados pela plataforma.</p>
      <div className="card section">
        {integ.emails.length ? (
          <table className="dense">
            <tbody>
              {integ.emails.map(e => (
                <tr key={e.id}>
                  <td className="muted">{when(e.createdAt)}</td>
                  <td>{e.toAddress}</td>
                  <td>{e.subject}</td>
                  <td>
                    <span className={MAIL[e.status] ?? 'tag'}>
                      {e.status === 'sent' ? 'Enviado' : e.status === 'skipped' ? 'Não enviado' : 'Falhou'}
                    </span>
                    {e.error && e.status === 'failed' && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {e.error}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">Ainda não há emails.</div>
        )}
      </div>
    </>
  );
}
