/** PDF vectorial com fontes incorporadas, sem browser ou dependências de runtime. */
import type { FinancialReportBundle, FinancialReportKey, ReportBlock, ReportCell, ReportChart, ReportTable, ReportTornado } from '@kianda/core';
import { FINANCIAL_FONTS } from './financial-fonts.js';

type FontKey = keyof typeof FINANCIAL_FONTS;
type Font = { name: string; data: string; map: Record<string, number>; widths: number[]; bbox: number[]; ascent: number; descent: number; flags: number };
const FONTS: Record<FontKey, Font> = FINANCIAL_FONTS;
const encoder = new TextEncoder();
const navy = '#1d4e89', muted = '#64748b', ink = '#1b1f27';
const clean = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\r\n?/g, '\n');
const glyphs = (v: string, key: FontKey) => [...clean(v)].map((c) => FONTS[key].map[String(c.codePointAt(0))] ?? FONTS[key].map['63']!);
const textWidth = (v: string, size: number, key: FontKey) => glyphs(v, key).reduce((s, id) => s + (FONTS[key].widths[id] ?? 500) * size / 1000, 0);
const hexText = (v: string, key: FontKey) => glyphs(v, key).map((id) => id.toString(16).padStart(4, '0')).join('');
const rgb = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(' ');
const num = (n: number) => Number(n.toFixed(3)).toString();
function wrap(v: string, width: number, size: number, font: FontKey): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(v).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && textWidth(line + ' ' + word, size, font) <= width) { line += ' ' + word; continue; }
      if (line) { lines.push(line); line = ''; }
      if (textWidth(word, size, font) <= width) { line = word; continue; }
      for (const char of word) {
        if (line && textWidth(line + char, size, font) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
export interface PdfBound { x: number; y: number; width: number; height: number; kind: string }
interface PdfPage { width: number; height: number; commands: string[]; bounds: PdfBound[] }
export function financialPdfLayout(bundle: FinancialReportBundle, key: FinancialReportKey): PdfPage[] {
  const report = bundle.reports[key], pages: PdfPage[] = [];
  const pageW = report.landscape ? 841.89 : 595.28, pageH = report.landscape ? 595.28 : 841.89, margin = 42, usable = pageW - margin * 2, bottom = 49;
  let page: PdfPage, y = 0;
  const allMoney = report.blocks.flatMap((b) => b.kind === 'table' ? b.rows.flatMap((r) => r.cells.filter((c) => c.format === 'money').map((c) => Number(c.value ?? 0))) : b.kind === 'metrics' ? b.items.filter((v) => v.cell.format === 'money').map((v) => Number(v.cell.value ?? 0)) : []);
  const scale = Math.max(0, ...allMoney.map(Math.abs)) >= 1e6 ? 1e6 : 1;
  const unit = scale === 1 ? `Montantes em ${bundle.source.currency}` : `Montantes em milhões de ${bundle.source.currency}`;
  const decimal = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const format = (c: ReportCell): string => {
    if (c.value === null) return 'n/d';
    if (typeof c.value === 'string' || c.format === 'text') return String(c.value);
    const value = c.value * (c.format === 'percent' ? 100 : 1) / (c.format === 'money' ? scale : 1);
    const digits = c.format === 'integer' ? 0 : 2;
    const n = (digits ? decimal : integer).format(Math.abs(value));
    return (value < 0 ? '(' + n + ')' : n) + (c.format === 'percent' ? '%' : c.format === 'ratio' ? 'x' : '');
  };
  const drawText = (v: string, x: number, top: number, size = 9, font: FontKey = 'sans', color = ink, align: 'left' | 'right' | 'center' = 'left') => {
    const width = textWidth(v, size, font), actualX = x - (align === 'right' ? width : align === 'center' ? width / 2 : 0);
    page.commands.push(`${rgb(color)} rg BT /${font} ${num(size)} Tf 1 0 0 1 ${num(actualX)} ${num(top)} Tm <${hexText(v, font)}> Tj ET`);
    page.bounds.push({ x: actualX, y: top - size * 0.25, width, height: size * 1.25, kind: 'text' });
  };
  const rect = (x: number, top: number, width: number, height: number, fill: string, stroke?: string) => {
    page.commands.push(`${rgb(fill)} rg ${stroke ? rgb(stroke) + ' RG 0.5 w ' : ''}${num(x)} ${num(top - height)} ${num(width)} ${num(height)} re ${stroke ? 'B' : 'f'}`);
  };
  const line = (x1: number, top1: number, x2: number, top2: number, color = '#d9dee6', width = 0.5) => page.commands.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(top1)} m ${num(x2)} ${num(top2)} l S`);
  const newPage = () => {
    page = { width: pageW, height: pageH, commands: [], bounds: [] }; pages.push(page);
    const top = pageH - 38;
    rect(margin, top, 27, 27, navy); drawText('I', margin + 13.5, top - 19, 18, 'bold', '#ffffff', 'center');
    let leftY = top - 8;
    for (const value of wrap(bundle.source.promoter || bundle.source.companyName, usable * 0.6 - 40, 10, 'bold')) { drawText(value, margin + 36, leftY, 10, 'bold'); leftY -= 12; }
    const project = wrap(bundle.source.projectName, usable * 0.6 - 40, 8, 'sans');
    for (const value of project) { drawText(value, margin + 36, leftY, 8, 'sans', muted); leftY -= 10; }
    const state = bundle.source.state === 'approved' ? `VERSÃO V${bundle.source.versionNumber} - APROVADA` : 'RASCUNHO';
    drawText(state, pageW - margin, top - 7, 8, 'bold', navy, 'right');
    const date = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(bundle.source.asOf));
    drawText('Luanda, ' + date, pageW - margin, top - 19, 8, 'sans', muted, 'right');
    drawText(`Revisão ${bundle.source.revision}`, pageW - margin, top - 30, 8, 'sans', muted, 'right');
    const headerBottom = Math.min(top - 38, leftY - 2); line(margin, headerBottom, pageW - margin, headerBottom, navy, 1.4);
    y = headerBottom - 22;
    for (const value of wrap(report.title.toUpperCase(), usable, 12, 'bold')) { drawText(value, pageW / 2, y, 12, 'bold', ink, 'center'); y -= 15; }
    drawText(unit, pageW / 2, y - 1, 8, 'sans', muted, 'center'); y -= 19;
    if (bundle.source.versionLabel) {
      for (const value of wrap(bundle.source.versionLabel, usable, 8, 'sans')) { drawText(value, pageW / 2, y, 8, 'sans', muted, 'center'); y -= 10; }
      y -= 4;
    }
  };
  const ensure = (height: number) => { if (y - height < bottom) newPage(); };
  const title = (value: string) => {
    const lines = wrap(value.toUpperCase(), usable, 9, 'bold'); ensure(lines.length * 12 + 26); y -= 5;
    for (const v of lines) { drawText(v, margin, y, 9, 'bold', navy); y -= 12; }
    y -= 3;
  };
  const renderTable = (block: ReportTable) => {
    if (block.startNewPage) newPage();
    const fontSize = 7.7;
    const wanted = block.columns.map((_, c) => c === 0 ? block.chronological || block.rows.some((r) => r.cells[0]?.format === 'text') ? 185 : 44 : Math.max(44, ...block.rows.map((r) => r.cells[c]?.format === 'text' ? 65 : textWidth(format(r.cells[c]!), fontSize, 'sans') + 14)));
    const bands: number[][] = [];
    let band = [0], used = wanted[0]!;
    for (let c = 1; c < block.columns.length; c++) {
      if (used + wanted[c]! > usable && band.length > 1) { bands.push(band); band = [0]; used = wanted[0]!; }
      band.push(c); used += wanted[c]!;
    }
    if (band.length) bands.push(band);
    for (const [bi, columns] of bands.entries()) {
      const natural = columns.reduce((s, c) => s + wanted[c]!, 0), extra = Math.max(0, usable - natural) / columns.length;
      const widths = columns.map((c) => wanted[c]! + extra);
      const heading = block.title + (bands.length > 1 ? ` (${bi + 1}/${bands.length})` : '');
      const headerLines = columns.map((c, i) => wrap(block.columns[c]!, widths[i]! - 12, 7.6, 'bold'));
      const headerHeight = Math.max(...headerLines.map((v) => v.length)) * 10 + 12;
      const renderHeader = () => { ensure(headerHeight + 52); title(heading); ensure(headerHeight + 25); rect(margin, y + 2, usable, headerHeight, '#f1f4f8'); let x = margin;
        for (let i = 0; i < columns.length; i++) { for (const [j, v] of headerLines[i]!.entries()) drawText(v, block.rows.every((r) => r.cells[columns[i]!]!.format !== 'text') ? x + widths[i]! - 6 : x + 6, y - 9 - j * 10, 7.6, 'bold', '#475166', block.rows.every((r) => r.cells[columns[i]!]!.format !== 'text') ? 'right' : 'left'); x += widths[i]!; }
        y -= headerHeight; line(margin, y + 2, pageW - margin, y + 2);
      };
      renderHeader();
      for (const row of block.rows) {
        const font: FontKey = row.total ? 'bold' : 'sans';
        const rows = columns.map((c, i) => wrap(format(row.cells[c]!), widths[i]! - 12, fontSize, font));
        const height = Math.max(...rows.map((v) => v.length)) * 10.3 + 9;
        if (y - height < bottom) { newPage(); renderHeader(); }
        if (row.total) { rect(margin, y + 2, usable, height, '#f9fafc'); line(margin, y + 2, pageW - margin, y + 2, ink, 0.8); }
        let x = margin;
        for (let i = 0; i < columns.length; i++) {
          const c = row.cells[columns[i]!]!, right = c.format !== 'text';
          for (const [j, v] of rows[i]!.entries()) drawText(v, right ? x + widths[i]! - 6 : x + 6, y - 9 - j * 10.3, fontSize, font, ink, right ? 'right' : 'left');
          x += widths[i]!;
        }
        y -= height; line(margin, y + 2, pageW - margin, y + 2, '#edf0f4');
      }
      y -= 8;
    }
  };
  const renderChart = (b: ReportChart) => {
    ensure(185); title(b.title);
    let legendX = margin;
    for (const series of b.series) { rect(legendX, y + 1, 6, 6, series.color); drawText(series.name, legendX + 10, y - 5, 7.3, 'sans', muted); legendX += textWidth(series.name, 7.3, 'sans') + 28; }
    y -= 19;
    const values = b.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const lo = Math.min(0, ...values, b.reference ?? 0), max = Math.max(0, ...values, b.reference ?? 0), hi = max === lo ? lo + 1 : max;
    const left = margin + 54, right = pageW - margin - 5, plotWidth = right - left, height = 108, top = y;
    const pos = (v: number) => top - height + (v - lo) / (hi - lo) * height;
    for (let i = 0; i <= 3; i++) { const value = lo + (hi - lo) * i / 3, yy = pos(value); line(left, yy, right, yy, '#e6eaf0'); drawText(format({ value, format: b.format }), left - 5, yy - 2, 6.8, 'sans', muted, 'right'); }
    const group = plotWidth / Math.max(1, b.labels.length), width = group * 0.7 / Math.max(1, b.series.length);
    for (let i = 0; i < b.labels.length; i++) {
      for (let j = 0; j < b.series.length; j++) { const v = b.series[j]!.values[i]; if (v === null || v === undefined) continue; const yy = pos(v), zero = pos(0); rect(left + i * group + group * 0.15 + j * width, Math.max(yy, zero), width * 0.9, Math.max(0.3, Math.abs(yy - zero)), b.series[j]!.color); }
      if (i % Math.max(1, Math.ceil(b.labels.length / 10)) === 0 || i === b.labels.length - 1) drawText(b.labels[i]!, left + (i + 0.5) * group, top - height - 13, 6.7, 'sans', muted, 'center');
    }
    if (b.reference !== undefined) { const ref = pos(b.reference); line(left, ref, right, ref, '#2a9d8f', 1); }
    y = top - height - 24;
  };
  const renderTornado = (b: ReportTornado) => {
    ensure(235); title(b.title);
    const left = margin + 139, right = pageW - margin - 85, min = Math.min(b.center, ...b.rows.flatMap((r) => [r.low, r.high])), max = Math.max(b.center, ...b.rows.flatMap((r) => [r.low, r.high]));
    const xx = (v: number) => left + (v - min) / (max - min || 1) * (right - left), center = xx(b.center);
    for (const row of b.rows) {
      const label = wrap(row.label, 130, 8, 'sans'); for (const [i, v] of label.entries()) drawText(v, margin, y - 9 - i * 9, 8);
      for (const [i, v] of [row.low, row.high].entries()) { const end = xx(v); rect(Math.min(center, end), y - 2 - i * 10, Math.max(0.4, Math.abs(center - end)), 8, i ? '#2a9d8f' : navy); }
      drawText(format({ value: row.low, format: 'money' }), pageW - margin, y - 8, 7, 'sans', muted, 'right'); drawText(format({ value: row.high, format: 'money' }), pageW - margin, y - 18, 7, 'sans', muted, 'right');
      line(center, y + 1, center, y - 23, muted); y -= 31;
    }
    y -= 7;
  };
  newPage();
  for (const b of report.blocks) {
    if (b.kind === 'table') renderTable(b);
    else if (b.kind === 'chart') renderChart(b);
    else if (b.kind === 'tornado') renderTornado(b);
    else if (b.kind === 'paragraph') {
      const lines = wrap(b.text, usable, 9.5, 'serif'); ensure(Math.min(lines.length, 3) * 13 + 35); if (b.title) title(b.title);
      for (const value of lines) { ensure(15); drawText(value, margin, y - 7, 9.5, 'serif'); y -= 13; } y -= 10;
    } else {
      const columns = report.landscape ? 3 : 3, gap = 9, width = (usable - gap * (columns - 1)) / columns;
      for (let start = 0; start < b.items.length; start += columns) {
        const items = b.items.slice(start, start + columns);
        const formatted = items.map((v) => ({ label: wrap(v.label, width - 18, 7.4, 'sans'), value: wrap(format(v.cell), width - 18, 13, 'bold'), note: wrap(v.note ?? '', width - 18, 6.8, 'sans') }));
        const height = Math.max(...formatted.map((v) => 17 + v.label.length * 10 + v.value.length * 17 + (v.note[0] ? v.note.length * 9 : 0)));
        ensure(height + 9);
        for (const [i, v] of formatted.entries()) { const x = margin + i * (width + gap); rect(x, y + 2, width, height, '#ffffff', '#d9dee6'); let yy = y - 11;
          for (const value of v.label) { drawText(value, x + 9, yy, 7.4, 'sans', muted); yy -= 10; }
          yy -= 2; for (const value of v.value) { drawText(value, x + 9, yy - 3, 13, 'bold', navy); yy -= 17; }
          if (v.note[0]) for (const value of v.note) { drawText(value, x + 9, yy - 2, 6.8, 'sans', muted); yy -= 9; }
        }
        y -= height + 10;
      }
    }
  }
  pages.forEach((p, i) => { page = p; line(margin, 35, pageW - margin, 35); drawText('Integra - Modelagem Financeira', margin, 23, 7, 'sans', muted); drawText(`${i + 1}/${pages.length} - Ref. ${bundle.source.sourceHash.slice(0, 12)}`, pageW - margin, 23, 7, 'sans', muted, 'right'); });
  return pages;
}

function concat(chunks: Uint8Array[]): Uint8Array { const result = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let at = 0; for (const c of chunks) { result.set(c, at); at += c.length; } return result; }
const bytes = (v: string) => encoder.encode(v);
function stream(data: Uint8Array, extra = '') { return concat([bytes(`<< /Length ${data.length} ${extra} >>\nstream\n`), data, bytes('\nendstream')]); }
let cachedFontResources: { objects: Uint8Array[]; refs: Record<string, number> } | undefined;
function fontResources() {
  if (cachedFontResources) return cachedFontResources;
  const objects: Uint8Array[] = [bytes(''), bytes('')];
  const add = (body: string | Uint8Array) => { objects.push(typeof body === 'string' ? bytes(body) : body); return objects.length; };
  const fontRefs: Record<string, number> = {};
  for (const [key, font] of Object.entries(FONTS)) {
    const data = Uint8Array.from(atob(font.data), (c) => c.charCodeAt(0));
    const file = add(stream(data, `/Length1 ${data.length}`));
    const descriptor = add(`<< /Type /FontDescriptor /FontName /${font.name} /Flags ${font.flags} /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${file} 0 R >>`);
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [${font.widths.join(' ')}]] >>`);
    const mapped = new Map<number, number>(); for (const [unicode, glyph] of Object.entries(font.map)) if (!mapped.has(glyph)) mapped.set(glyph, Number(unicode));
    const pairs = [...mapped.entries()].sort(([a], [b]) => a - b).map(([glyph, unicode]) => `<${glyph.toString(16).padStart(4, '0')}> <${unicode.toString(16).padStart(4, '0')}>`);
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /IntegraUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < pairs.length; i += 100) { const group = pairs.slice(i, i + 100); cmap += `${group.length} beginbfchar\n${group.join('\n')}\nendbfchar\n`; }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const unicode = add(stream(bytes(cmap)));
    fontRefs[key] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${unicode} 0 R >>`);
  }
  cachedFontResources = { objects: objects.slice(2), refs: fontRefs };
  return cachedFontResources;
}
/** Sérialise PDF 1.7. As únicas cadeias de texto no conteúdo são glifos hexadecimais, nunca código fornecido pelo utilizador. */
export function renderFinancialPdf(bundle: FinancialReportBundle, key: FinancialReportKey): Uint8Array {
  const pages = financialPdfLayout(bundle, key), objects: Uint8Array[] = [];
  const add = (body: string | Uint8Array) => { objects.push(typeof body === 'string' ? bytes(body) : body); return objects.length; };
  const catalog = add(''), pageTree = add('');
  const resources = fontResources();
  objects.push(...resources.objects);
  const fontRefs = resources.refs;
  const ids = pages.map((p) => { const content = add(stream(bytes(p.commands.join('\n')))); return add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /Font << ${Object.entries(fontRefs).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >> >> /Contents ${content} 0 R >>`); });
  objects[catalog - 1] = bytes(`<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
  objects[pageTree - 1] = bytes(`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] >>`);
  const chunks: Uint8Array[] = [bytes('%PDF-1.7\n')]; const offsets = [0]; let offset = chunks[0]!.length;
  objects.forEach((body, i) => { offsets.push(offset); const object = concat([bytes(`${i + 1} 0 obj\n`), body, bytes('\nendobj\n')]); chunks.push(object); offset += object.length; });
  const xref = offset;
  chunks.push(bytes(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => n.toString().padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return concat(chunks);
}
