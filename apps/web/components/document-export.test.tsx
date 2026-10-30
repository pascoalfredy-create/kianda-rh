import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentExportAccess, DocumentPrintButton, ExportLink } from './document-export';

describe('documentos do RH em pré-visualização', () => {
  const controls = <><ExportLink href="/api/v1/ledger/export" className="btn">Exportar CSV</ExportLink><DocumentPrintButton>Imprimir / PDF</DocumentPrintButton></>;
  it('sem licença de exportação não publica links de download e impede a impressão da página', () => {
    const html = renderToStaticMarkup(<DocumentExportAccess allowed={false}>{controls}</DocumentExportAccess>);
    expect(html).not.toContain('href='); expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('Active uma subscrição paga'); expect(html).toContain('@media print');
  });
  it('uma licença paga recupera os controlos e não oculta a página ao imprimir', () => {
    const html = renderToStaticMarkup(<DocumentExportAccess allowed>{controls}</DocumentExportAccess>);
    expect(html).toContain('href="/api/v1/ledger/export"'); expect(html).not.toContain('disabled='); expect(html).not.toContain('@media print');
  });
});
