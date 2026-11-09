import type { ReactNode } from 'react';
import { Letterhead } from './letterhead';

/**
 * Folha A4 imprimível: o papel timbrado (cabeçalho) e as notas de rodapé repetem-se em todas as páginas
 * (thead/tfoot repetidos pelo navegador); a numeração «n/N» vem do @page em globals.css.
 */
export function PrintSheet({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="card doc a4">
      <table className="sheet" role="presentation">
        <thead><tr><td><Letterhead /></td></tr></thead>
        <tbody><tr><td>{children}</td></tr></tbody>
        {footer && <tfoot><tr><td><div className="sheet-foot">{footer}</div></td></tr></tfoot>}
      </table>
    </div>
  );
}
