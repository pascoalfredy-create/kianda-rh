'use client';

export function PrintButton() {
  return <button className="btn ghost sm" style={{ marginLeft: 10 }} onClick={() => window.print()}>Imprimir</button>;
}
