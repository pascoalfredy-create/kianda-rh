import { describe, expect, it } from 'vitest';
import { analyzeFinancialHistory, buildFinancialHistoricalReport, buildFinancialReportBundle, convertFinancialCurrency, FINANCIAL_REPORT_KEYS, financialTemplate } from '@kianda/core';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
import { financialPdfLayout, renderFinancialPdf } from '../src/lib/financial-pdf.js';
import { renderFinancialXlsx } from '../src/lib/financial-xlsx.js';
import { FINANCIAL_FONTS } from '../src/lib/financial-fonts.js';
const bundle = buildFinancialReportBundle(financialTemplate('mineracao').assumptions, { modelId: 'm', projectName: 'Estudo de mineração', sector: 'Mineração', currency: 'USD', companyName: 'Empresa ÁÉÍÓÚ / Пример', companyNif: '0012345678', revision: 1, sourceHash: 'a'.repeat(64), asOf: '2026-10-28T12:00:00.000Z', state: 'approved', versionNumber: 1, versionLabel: 'V comité' });
const decode = (v: Uint8Array) => new TextDecoder().decode(v);
function unzip(data: Uint8Array) {
  const files = new Map<string, string>(); const d = new DataView(data.buffer, data.byteOffset, data.byteLength); let p = 0;
  while (d.getUint32(p, true) === 0x04034b50) {
    expect(d.getUint16(p + 8, true)).toBe(0);
    const n = d.getUint32(p + 18, true), name = d.getUint16(p + 26, true), extra = d.getUint16(p + 28, true), start = p + 30 + name + extra;
    files.set(decode(data.slice(p + 30, p + 30 + name)), decode(data.slice(start, start + n))); p = start + n;
  }
  return files;
}
describe('downloads financeiros', () => {
  it('PDF válido e determinístico, com fontes Unicode e sem anexos editáveis', () => {
    const a = renderFinancialPdf(bundle, 'sumario'), b = renderFinancialPdf(bundle, 'sumario');
    expect(a).toEqual(b); const raw = decode(a);
    expect(raw.startsWith('%PDF-1.7')).toBe(true); expect(raw.endsWith('%%EOF\n')).toBe(true);
    expect(raw).toContain('/ToUnicode'); expect(raw).toContain('/FontFile2');
    expect(raw).not.toMatch(/\/EmbeddedFiles|\/JavaScript|\/OpenAction/);
    const xref = /startxref\n(\d+)\n%%EOF/.exec(raw); expect(xref).not.toBeNull();
    expect(decode(a.slice(Number(xref![1]), Number(xref![1]) + 4))).toBe('xref');
  });
  it('os sete relatórios respeitam os limites físicos das páginas', () => {
    for (const key of FINANCIAL_REPORT_KEYS) for (const page of financialPdfLayout(bundle, key)) for (const b of page.bounds) {
      expect(b.x).toBeGreaterThanOrEqual(38); expect(b.x + b.width).toBeLessThanOrEqual(page.width - 38);
      expect(b.y).toBeGreaterThanOrEqual(17); expect(b.y + b.height).toBeLessThanOrEqual(page.height - 24);
    }
  });
  it('horizonte de quarenta anos preserva os últimos períodos sem encolher as tabelas', () => {
    const m = financialTemplate('servicos').assumptions; m.horizonte = 40; m.receitas.forEach((r) => { r.cresc = 1; r.esc = 1; }); m.inflacao = 1; m.tv.g = 1;
    const all = buildFinancialReportBundle(m, bundle.source), pages = financialPdfLayout(all, 'demonstracoes');
    expect(pages.length).toBeGreaterThan(3);
    for (const p of pages) for (const b of p.bounds) expect(b.x + b.width).toBeLessThanOrEqual(p.width - 38);
    expect(all.reports.demonstracoes.blocks.filter((b) => b.kind === 'table').every((t) => t.columns.at(-1) === '2066')).toBe(true);
  });
  it('Excel de resultados conserva montantes e identificadores como tipos explícitos', () => {
    const files = unzip(renderFinancialXlsx(bundle, 'demonstracoes'));
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('0012345678');
    const dr = files.get('xl/worksheets/sheet2.xml')!;
    expect(dr).toContain(`r="C10" t="n" s="9"><v>${bundle.result.k.ebit[1]}</v>`);
    expect(files.get('xl/styles.xml')).toContain('wrapText="1"');
    for (const [name, xml] of files) if (name.startsWith('xl/worksheets/')) expect(xml).not.toMatch(/<f[\s>]|externalLink/);
  });
  it('percentagens são números fraccionários com formato percentual', () => {
    const files = unzip(renderFinancialXlsx(bundle, 'sumario'));
    expect(files.get('xl/worksheets/sheet1.xml')).toContain(`t="n" s="3"><v>${bundle.result.irr}</v>`);
    expect(files.get('xl/styles.xml')).toContain('numFmtId="10"');
  });
  it('o oitavo relatório pagina Balanço, DR, caixa e diagnóstico sem cortar conteúdo', () => {
    const document = { source: bundle.source, reports: { analise: buildFinancialHistoricalReport(analyzeFinancialHistory(historicalInput)) } };
    const pages = financialPdfLayout(document, 'analise'); expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) for (const b of p.bounds) {
      expect(b.x).toBeGreaterThanOrEqual(38); expect(b.x + b.width).toBeLessThanOrEqual(p.width - 38); expect(b.y).toBeGreaterThanOrEqual(17); expect(b.y + b.height).toBeLessThanOrEqual(p.height - 24);
    }
    expect(decode(renderFinancialPdf(document, 'analise')).startsWith('%PDF-1.7')).toBe(true);
    expect(unzip(renderFinancialXlsx(document, 'analise')).get('xl/worksheets/sheet1.xml')).toContain('Empresa de teste');
  });
  for(const currency of ['USD','EUR']as const)it(`os sete PDFs e livros de resultados identificam ${currency} e contêm os montantes convertidos`,()=>{
    const original=financialTemplate('mineracao').assumptions,rate=currency==='USD'?1:0.9;
    const converted=convertFinancialCurrency(original as unknown as Record<string,unknown>,'USD',currency,rate);
    const current=buildFinancialReportBundle(converted,{...bundle.source,currency,state:'draft'});
    const heading=[...`Montantes em milhões de ${currency}`].map(c=>FINANCIAL_FONTS.sans.map[String(c.codePointAt(0))]!.toString(16).padStart(4,'0')).join('');
    for(const key of FINANCIAL_REPORT_KEYS){
      expect(decode(renderFinancialPdf(current,key)),key).toContain(heading);
      const workbook=unzip(renderFinancialXlsx(current,key));expect(workbook.get('xl/worksheets/sheet1.xml'),key).toContain(currency);
    }
    const sheet=unzip(renderFinancialXlsx(current,'demonstracoes')).get('xl/worksheets/sheet2.xml')!;
    expect(sheet).toContain(`<v>${current.result.k.rev[1]}</v>`);expect(sheet).toContain(`<v>${current.result.k.rl[1]}</v>`);
    const investment=current.reports.comite.blocks.find(b=>b.kind==='table'&&b.title==='Investimento e financiamento');
    expect(investment?.kind==='table'&&investment.rows[0]!.cells[1]!.value).toBe(original.capex.reduce((s,c)=>s+c.valor,0)*rate);
  });
});
