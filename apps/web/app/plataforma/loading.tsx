/** Enquanto um ecrã da consola carrega, a moldura e os separadores respondem logo ao clique. */
export default function A_carregar() {
  return (
    <div className="platform-loading" aria-busy="true" aria-label="A carregar">
      <div className="sk sk-title" />
      <div className="sk sk-sub" />
      <div className="grid">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card sk sk-card" />
        ))}
      </div>
      <div className="card sk sk-block" />
    </div>
  );
}
