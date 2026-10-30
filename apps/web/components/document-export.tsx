'use client';

import { createContext, useContext, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';

const ExportAccess = createContext(false);
const hint = 'Disponível em pré-visualização. Active uma subscrição paga deste módulo para exportar ou imprimir.';

/** A API volta a verificar a licença em cada download; este contexto orienta os controlos do RH. */
export function DocumentExportAccess({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <ExportAccess.Provider value={allowed}>
    {!allowed && <style>{'@media print{body>*{display:none!important}body::after{display:block!important;content:"Pré-visualização Kianda. Active uma subscrição paga para imprimir ou exportar documentos.";padding:40px;font:18px sans-serif}}'}</style>}
    {children}
  </ExportAccess.Provider>;
}

export function ExportLink({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const allowed = useContext(ExportAccess);
  if (allowed) return <a {...props}>{children}</a>;
  return <button type="button" className={props.className} style={props.style} disabled title={hint}>{children}</button>;
}

export function DocumentPrintButton({ children = 'Imprimir', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const allowed = useContext(ExportAccess);
  return <button {...props} type="button" disabled={!allowed || props.disabled} title={allowed ? props.title : hint} onClick={() => { if (allowed) window.print(); }}>{children}</button>;
}
