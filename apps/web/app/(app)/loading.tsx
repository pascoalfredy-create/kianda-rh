/** A transição começa logo; os dados continuam a ser autorizados e carregados no servidor. */
export default function Loading() {
  return <div className="screen-loading" role="status" aria-live="polite" aria-busy="true">
    <span className="loading-spinner" aria-hidden="true" />
    <p>A carregar o ecrã…</p>
  </div>;
}
