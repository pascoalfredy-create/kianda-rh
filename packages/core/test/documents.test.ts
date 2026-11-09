import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, documentBlocks, structureImportedText, kzInWords, numberToWordsPt, renderTemplate, unknownFields } from '../src/index.js';

describe('valores por extenso', () => {
  it('números', () => {
    expect(numberToWordsPt(0)).toBe('zero');
    expect(numberToWordsPt(21)).toBe('vinte e um');
    expect(numberToWordsPt(100)).toBe('cem');
    expect(numberToWordsPt(101)).toBe('cento e um');
    expect(numberToWordsPt(1000)).toBe('mil');
    expect(numberToWordsPt(1200)).toBe('mil e duzentos');
    expect(numberToWordsPt(2005)).toBe('dois mil e cinco');
    expect(numberToWordsPt(1234)).toBe('mil duzentos e trinta e quatro');
    expect(numberToWordsPt(300000)).toBe('trezentos mil');
    expect(numberToWordsPt(1_000_000)).toBe('um milhão');
    expect(numberToWordsPt(2_500_000)).toBe('dois milhões e quinhentos mil');
    expect(numberToWordsPt(2_530_000)).toBe('dois milhões quinhentos e trinta mil');
    expect(numberToWordsPt(1_000_000_000)).toBe('mil milhões');
  });
  it('kwanzas e cêntimos', () => {
    expect(kzInWords(30_000_000)).toBe('trezentos mil kwanzas');
    expect(kzInWords(100)).toBe('um kwanza');
    expect(kzInWords(42_000_050)).toBe('quatrocentos e vinte mil kwanzas e cinquenta cêntimos');
  });
});

describe('modelos de documentos', () => {
  it('campos, blocos condicionais e campos em falta', () => {
    const r = renderTemplate('Olá **{{colaborador.nome}}**{{#se colaborador.nif}}, NIF {{colaborador.nif}}{{/se}}. Função: {{colaborador.funcao}}', { 'colaborador.nome': 'Ana' });
    expect(r.text).toBe('Olá **Ana**. Função: [colaborador.funcao]');
    expect(r.missing).toEqual(['colaborador.funcao']);
  });
  it('blocos: título, parágrafos com negrito e assinaturas', () => {
    expect(documentBlocks('# Título\n\nTexto **forte** fim\n\n--- assinaturas: A | B')).toEqual([
      { type: 'title', text: 'Título' },
      { type: 'paragraph', spans: [{ text: 'Texto ', bold: false }, { text: 'forte', bold: true }, { text: ' fim', bold: false }] },
      { type: 'signatures', labels: ['A', 'B'] },
    ]);
  });
  it('modelos do Kianda só usam campos conhecidos', () => {
    for (const t of BUILTIN_TEMPLATES) expect(unknownFields(t.body), t.key).toEqual([]);
    expect(unknownFields('{{colaborador.salario}}')).toEqual(['colaborador.salario']);
  });
});

describe('estrutura de contratos (secções, alíneas, assinaturas com nome)', () => {
  it('reconhece secções, níveis de alínea e nomes nas assinaturas', () => {
    const b = documentBlocks('# CONTRATO\n\n## 1. OBJECTO\n\n1.1. Texto\n\na. primeira\nb. segunda\n\nb1. sub\n\n--- assinaturas: TRABALHADOR // Ana | PELA EMPRESA // Kianda');
    expect(b.map(x => x.type)).toEqual(['title', 'heading', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'signatures']);
    expect(b.filter(x => x.type === 'paragraph').map(x => (x as { indent?: number }).indent)).toEqual([1, 2, 2, 3]);
    expect(b.at(-1)).toEqual({ type: 'signatures', labels: ['TRABALHADOR', 'PELA EMPRESA'], names: ['Ana', 'Kianda'] });
  });
  it('importação de PDF: tira cabeçalho repetido e paginação e junta linhas partidas', () => {
    const head = 'Rua Principal, Edifício 1, Luanda, NIF 5000000000, Tel 222000000';
    const t = structureImportedText([head, 'CONTRATO DE TRABALHO', 'Pelo presente instrumento, a empresa', 'e o trabalhador acordam o seguinte:', '1. OBJECTO', '1.1. O contrato tem por objecto', 'a prestação de trabalho;', 'a. primeira alínea;', '1/2', head, '2. FORO', '2.1. Rege-se pela lei angolana.'], 'pdf');
    expect(t).toBe('# CONTRATO DE TRABALHO\n\nPelo presente instrumento, a empresa e o trabalhador acordam o seguinte:\n\n## 1. OBJECTO\n\n1.1. O contrato tem por objecto a prestação de trabalho;\n\na. primeira alínea;\n\n## 2. FORO\n\n2.1. Rege-se pela lei angolana.');
  });
});
