import { documentBlocks } from '@kianda/core';

/** Documento composto (título, secções, alíneas, negrito, assinaturas) — sem HTML arbitrário. */
/** signature: assinatura electrónica do colaborador, mostrada na coluna «Trabalhador» das assinaturas. */
export function DocView({ text, signature }: { text: string; signature?: { name: string; at: string; hash: string } }) {
  return (
    <>
      {documentBlocks(text).map((b, i) => {
        if (b.type === 'title') return <h2 key={i} className="doc-title">{b.text}</h2>;
        if (b.type === 'heading') return <h3 key={i} className="doc-section">{b.text}</h3>;
        if (b.type === 'signatures') {
          return (
            <div key={i} className="doc-signatures" style={{ gridTemplateColumns: `repeat(${b.labels.length}, 1fr)` }}>
              {b.labels.map((l, j) => <div key={j}>{l && <><b>{l}</b>{signature && /trabalhador/i.test(l) ? <div className="doc-e-sign">Assinado electronicamente<br />{signature.at} · {signature.hash}</div> : null}<div className="doc-sign-line" style={signature && /trabalhador/i.test(l) ? { marginTop: 6 } : undefined} />{b.names?.[j] && <div className="doc-sign-name">{b.names[j]}</div>}</>}</div>)}
            </div>
          );
        }
        return <p key={i} className={b.indent ? `doc-i${b.indent}` : undefined}>{b.spans.map((s, j) => (s.bold ? <b key={j}>{s.text}</b> : <span key={j}>{s.text}</span>))}</p>;
      })}
    </>
  );
}
