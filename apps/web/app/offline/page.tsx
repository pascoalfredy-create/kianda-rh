export const metadata = { title: 'Sem rede — Kianda RH' };

/** Mostrada pela app quando não há rede e a página ainda não foi guardada no telemóvel. */
export default function Offline() {
  return (
    <div className="auth-wrap">
      <div className="card auth" style={{ textAlign: 'center' }}>
        <div className="logo" style={{ padding: 0, marginBottom: 14, justifyContent: 'center' }}><div className="mark">K</div></div>
        <h1 style={{ fontSize: 19 }}>Sem rede</h1>
        <p className="muted">Esta página ainda não está guardada neste telemóvel. As páginas que já abriu (início, recibos, férias, ponto) continuam disponíveis, e o ponto pode ser registado sem rede — é enviado quando a ligação voltar.</p>
        <a className="btn" href="/">Tentar de novo</a>
      </div>
    </div>
  );
}
