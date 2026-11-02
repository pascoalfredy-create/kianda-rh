import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { blankValuationData, valuationDataIssue } from '@kianda/core';
import { VALUATION_REFERENCE_HASH, VALUATION_SHELL } from '../lib/valuation/generated';
import { VALUATION_ENGINE_SOURCE } from '../lib/valuation/engine.generated';
import { valuationHeaders, valuationPage, type ValuationSession } from '../lib/valuation/page';
import { readXlsxRows, utils, write } from './xlsx';

const prototype = readFileSync(new URL('./prototype.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/valuation-runtime.js', import.meta.url), 'utf8');

/** Motor do Valora tal como corre na interface (mesmo texto gerado), sem DOM. */
function engine(data: unknown) {
  const ctx: Record<string, unknown> = { console, Math, JSON, Number, Object, Array, String, Intl, Date, isFinite, isNaN };
  runInNewContext(`${VALUATION_ENGINE_SOURCE}\nD=__data;EX=D.ex;globalThis.__R=compute();`, Object.assign(ctx, { __data: structuredClone(data) }));
  return ctx.__R as Record<string, any>;
}

/** Empresa simples e coerente: vendas 1 000 Mkz, balanço equilibrado em todos os exercícios. */
function sample() {
  const d = blankValuationData({ entity: 'Kalunga Distribuição, S.A.', lastClosedYear: 2025, historyYears: 3 });
  const n = d.years.length;
  const put = (group: Record<string, number[]>, key: string, values: number[]) => { group[key] = values.slice(0, n); };
  put(d.dr, 'v61', [800, 900, 1000]); put(d.dr, 'c71', [400, 450, 500]); put(d.dr, 'c72', [150, 160, 170]); put(d.dr, 'c75', [50, 55, 60]); put(d.dr, 'c73', [30, 30, 30]);
  for (const [k, v] of Object.entries({ imob: 500, amort: 200, exist: 100, clientes: 150, caixa: 50, capital: 300, empMLP: 100, fornec: 80 })) put(d.bal, k, [v, v, v]);
  // Reservas fecham o balanço depois do resultado líquido de cada ano (imposto de 25 %).
  const rl = d.dr.v61.map((v, i) => (v - d.dr.c71[i]! - d.dr.c72[i]! - d.dr.c75[i]! - d.dr.c73[i]!) * 0.75);
  put(d.bal, 'reservas', rl.map(r => 600 - 300 - 100 - 80 - r));
  d.orc.vendas = 1100;
  return d;
}

describe('Kianda Valora: interface aprovada servida pela plataforma', () => {
  it('o protótipo de referência fica guardado e verificável', () => {
    expect(VALUATION_REFERENCE_HASH).toBe(createHash('sha256').update(prototype).digest('hex'));
    expect(VALUATION_SHELL).toContain('id="valoraBanner"');
    expect(VALUATION_SHELL).toContain('Activos');
  });
  it('não carrega bibliotecas de CDN nem guarda a análise no navegador', () => {
    for (const cdn of ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com']) expect(runtime).not.toContain(cdn);
    expect(runtime).not.toContain("'valora-v3'");
    expect(runtime).toContain('/valuation-lib/jspdf-');
    expect(runtime).toContain('/api/v1/valuation');
  });
  it('isola a sessão JSON de HTML executável e aplica a política de segurança', () => {
    const session = { user: { id: 'u', name: '</script><script>alert(1)</script>', role: 'owner' }, licence: { status: 'active', trialEndsAt: null, paidUntil: null }, formats: { pdf: true, docx: true, xlsx: true } } as ValuationSession;
    const html = valuationPage(session, 'n1');
    expect(html).not.toContain(session.user.name); expect(html).toContain('\\u003c/script>');
    const json = html.split('id="valora-session" type="application/json" nonce="n1">')[1]!.split('</script>')[0]!;
    expect(JSON.parse(json)).toEqual(session);
    const csp = valuationHeaders('n1')['content-security-policy'];
    expect(csp).toContain("script-src 'self' 'nonce-n1'"); expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("connect-src 'self'");
    expect(valuationHeaders('n1')['x-robots-tag']).toBe('noindex, nofollow');
  });
  it('sem sessão mostra o erro escapado e não entrega o código da interface', () => {
    const html = valuationPage(null, 'n', '<img onerror="x">');
    expect(html).toContain('&lt;img'); expect(html).not.toContain('/valuation-runtime.js');
  });
  it('no período experimental avisa que os documentos ficam em pré-visualização e bloqueia a impressão', () => {
    const html = valuationPage({ licence: { status: 'trial', trialEndsAt: '2026-11-08', paidUntil: null }, formats: { pdf: false, docx: false, xlsx: false } } as ValuationSession, 'n');
    expect(html).toContain('Avaliação gratuita'); expect(html).toContain('08/11/2026'); expect(html).toContain('@media print');
  });
});

describe('Kianda Valora: motor de cálculo (PGC Angola, classe 6 proveitos, classe 7 custos)', () => {
  it('uma análise em branco é válida e abre no motor sem meses reais', () => {
    const blank = blankValuationData({ entity: 'Nova', lastClosedYear: 2025 });
    expect(valuationDataIssue(blank)).toBeNull();
    expect(blank.fecho).toBe(0); expect(blank.ex).toBe(2026);
    expect(() => engine(blank)).not.toThrow();
  });
  it('demonstrações históricas: resultados, margens e balanço equilibrado', () => {
    const d = sample(); expect(valuationDataIssue(d)).toBeNull();
    const R = engine(d), L = R.L;
    expect(R.rec[L]).toBe(1000);
    expect(R.ebitda[L]).toBe(270); // 1000 − 500 − 170 − 60
    expect(R.ebit[L]).toBe(240);
    expect(R.rl[L]).toBeCloseTo(180, 6); // 25 % de imposto
    expect(R.margE[L]).toBeCloseTo(0.27, 6);
    for (const dif of R.dif) expect(Math.abs(dif)).toBeLessThan(1e-9);
  });
  it('a avaliação DCF devolve um valor da empresa finito e coerente com a dívida líquida', () => {
    const R = engine(sample());
    expect(Number.isFinite(R.dcf.ev)).toBe(true);
    expect(R.dcf.eq).toBeCloseTo(R.dcf.ev - R.dcf.nd + R.dcf.inv, 6);
    expect(R.dcf.rows).toHaveLength(5);
    expect(R.dcf.rows[0].y).toBe(2026);
  });
  it('recusa dados que o motor não abre', () => {
    const d = sample() as Record<string, any>;
    expect(valuationDataIssue({ ...d, fecho: 13 })).toMatch(/mês de fecho/);
    expect(valuationDataIssue({ ...d, years: [2025, 2023, 2024] })).toMatch(/consecutivos/);
    expect(valuationDataIssue({ ...d, dr: { ...d.dr, v61: [1, 2] } })).toMatch(/Histórico de resultados/);
  });
});

describe('Kianda Valora: Excel sem bibliotecas externas', () => {
  it('o relatório escrito volta a ser lido com números e texto', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Rubrica', 'Jan', 'Fev'], ['61 Vendas', 120.5, 130], ['72 Custos com o pessoal', 40, null]]), 'Real');
    const bytes = write(book);
    const rows = await readXlsxRows(bytes.slice().buffer);
    expect(rows[0]).toEqual(['Rubrica', 'Jan', 'Fev']);
    expect(rows[1]).toEqual(['61 Vendas', 120.5, 130]);
    expect(rows[2]![0]).toBe('72 Custos com o pessoal'); expect(rows[2]![1]).toBe(40);
  });
  it('recusa um ficheiro que não é .xlsx', async () => {
    await expect(readXlsxRows(new TextEncoder().encode('não é um zip').buffer)).rejects.toThrow();
  });
});
