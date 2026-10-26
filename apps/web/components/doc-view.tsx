import { documentBlocks } from '@kianda/core';

/** Documento composto (título, parágrafos com negrito, assinaturas) — sem HTML arbitrário. */
export function DocView({ text }: { text: string }) {
  return (
    <>
      {documentBlocks(text).map((b, i) => {
        if (b.type === 'title') return <h2 key={i} style={{ textAlign: 'center', margin: '10px 0 26px', textTransform: 'uppercase', fontSize: 17, letterSpacing: 0.3 }}>{b.text}</h2>;
        if (b.type === 'signatures') {
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${b.labels.length}, 1fr)`, gap: 40, marginTop: 56 }}>
              {b.labels.map((l, j) => <div key={j} style={l ? { borderTop: '1px solid #333', paddingTop: 6, textAlign: 'center' } : undefined}>{l}</div>)}
            </div>
          );
        }
        return <p key={i} style={{ lineHeight: 1.75, textAlign: 'justify' }}>{b.spans.map((s, j) => (s.bold ? <b key={j}>{s.text}</b> : <span key={j}>{s.text}</span>))}</p>;
      })}
    </>
  );
}
