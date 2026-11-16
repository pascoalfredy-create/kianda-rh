/** Mapa de efectividade em PDF (A4 horizontal): grelha de códigos por dia, totais, legenda e espaço para assinaturas. */
import { EFFECTIVENESS_LEGEND, type EffectivenessCode } from '@kianda/core';
import { hexText, num, renderPdfPages, rgb, textWidth, type PdfFont, type PdfPage } from './financial-pdf.js';

export interface EffectivenessPdfInput {
  companyName: string;
  periodLabel: string;
  provisional: boolean;
  generatedAt: Date;
  days: { date: string; weekday: string; off: boolean }[];
  rows: { name: string; number: string; codes: EffectivenessCode[]; totals: (number | string)[] }[];
  totalHeaders: string[];
}

const ink = '#1b1f27',
  muted = '#64748b',
  navy = '#1d4e89',
  grid = '#c9d1dc';
const FILL: Partial<Record<EffectivenessCode, string>> = {
  FI: '#fbe3e3',
  FJ: '#e3eefb',
  Fé: '#e3f4e8',
  D: '#efe6fb',
  L: '#f1efe8',
  Fr: '#fbf1dc',
  '·': '#f3f4f6',
  SR: '#fff4d6',
};

export function renderEffectivenessPdf(input: EffectivenessPdfInput): Uint8Array {
  const W = 841.89,
    H = 595.28,
    m = 28,
    nameW = 128,
    totW = 22,
    rowH = 13;
  const dayW = (W - 2 * m - nameW - totW * input.totalHeaders.length) / input.days.length;
  const pages: PdfPage[] = [];
  let page!: PdfPage;
  const text = (v: string, x: number, y: number, size: number, font: PdfFont = 'sans', color = ink, align = 'left') => {
    const w = textWidth(v, size, font),
      ax = x - (align === 'right' ? w : align === 'center' ? w / 2 : 0);
    page.commands.push(
      `${rgb(color)} rg BT /${font} ${num(size)} Tf 1 0 0 1 ${num(ax)} ${num(y)} Tm <${hexText(v, font)}> Tj ET`,
    );
  };
  const box = (x: number, top: number, w: number, h: number, fill?: string) =>
    page.commands.push(
      `${fill ? rgb(fill) + ' rg ' : ''}${rgb(grid)} RG 0.4 w ${num(x)} ${num(top - h)} ${num(w)} ${num(h)} re ${fill ? 'B' : 'S'}`,
    );
  const fit = (v: string, width: number, size: number) => {
    let s = v;
    while (s.length > 1 && textWidth(s, size, 'sans') > width) s = s.slice(0, -1);
    return s === v ? v : s.slice(0, -1) + '…';
  };
  const stamp = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Luanda',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(input.generatedAt);
  const header = () => {
    page = { width: W, height: H, commands: [], bounds: [] };
    pages.push(page);
    text(input.companyName, m, H - m - 8, 10, 'bold');
    text(`MAPA DE EFECTIVIDADE — ${input.periodLabel.toUpperCase()}`, m, H - m - 22, 11, 'bold', navy);
    text(
      input.provisional ? 'PROVISÓRIO — mês ainda não fechado' : 'MÊS FECHADO',
      W - m,
      H - m - 8,
      8,
      'bold',
      input.provisional ? '#a35a00' : navy,
      'right',
    );
    text(`Gerado em ${stamp} (Luanda)`, W - m, H - m - 20, 7, 'sans', muted, 'right');
    const top = H - m - 34;
    box(m, top, nameW, rowH * 1.6, '#eef2f7');
    text('Colaborador', m + 3, top - 13, 7, 'bold');
    input.days.forEach((d, i) => {
      const x = m + nameW + i * dayW;
      box(x, top, dayW, rowH * 1.6, d.off ? '#f3f4f6' : '#eef2f7');
      text(String(Number(d.date.slice(8))), x + dayW / 2, top - 8, 6.5, 'bold', ink, 'center');
      text(d.weekday, x + dayW / 2, top - 16, 5.5, 'sans', muted, 'center');
    });
    input.totalHeaders.forEach((h, i) => {
      const x = m + nameW + input.days.length * dayW + i * totW;
      box(x, top, totW, rowH * 1.6, '#e2e8f0');
      text(h, x + totW / 2, top - 13, 6.5, 'bold', ink, 'center');
    });
    return top - rowH * 1.6;
  };
  const footerSpace = 64;
  let y = header();
  for (const r of input.rows) {
    if (y - rowH < m + footerSpace) y = header();
    box(m, y, nameW, rowH);
    text(fit(`${r.name}${r.number ? ` (${r.number})` : ''}`, nameW - 6, 6.8), m + 3, y - 9, 6.8);
    r.codes.forEach((c, i) => {
      const x = m + nameW + i * dayW;
      box(x, y, dayW, rowH, FILL[c]);
      if (c) text(c, x + dayW / 2, y - 9, 6.2, c === 'FI' || c === 'SR' ? 'bold' : 'sans', ink, 'center');
    });
    r.totals.forEach((t, i) => {
      const x = m + nameW + input.days.length * dayW + i * totW;
      box(x, y, totW, rowH, '#f8fafc');
      text(String(t), x + totW / 2, y - 9, 6.5, 'bold', ink, 'center');
    });
    y -= rowH;
  }
  // Legenda e assinaturas na última página.
  let lx = m;
  const ly = m + footerSpace - 14;
  for (const [code, label] of EFFECTIVENESS_LEGEND) {
    const w = 14 + textWidth(label, 6.5, 'sans') + 12;
    box(lx, ly + 7, 12, 9, FILL[code]);
    text(code, lx + 6, ly, 6, 'bold', ink, 'center');
    text(label, lx + 15, ly, 6.5, 'sans', muted);
    lx += w;
  }
  const sig = (label: string, x: number) => {
    page.commands.push(`${rgb(muted)} RG 0.5 w ${num(x)} ${num(m + 14)} m ${num(x + 200)} ${num(m + 14)} l S`);
    text(label, x, m + 4, 7, 'sans', muted);
  };
  sig('Elaborado por (nome e assinatura)', m);
  sig('Visto do responsável', m + 260);
  sig('Data', m + 520);
  pages.forEach((p, i) => {
    page = p;
    text(`Página ${i + 1} de ${pages.length}`, W - m, m - 12, 6.5, 'sans', muted, 'right');
  });
  return renderPdfPages(pages);
}
