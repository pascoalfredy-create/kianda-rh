import { describe, expect, it } from 'vitest';
import { lineFingerprint, matchPayments, missingProof, newRows, parseAmount, parseDate, parseStatement } from '../src/index.js';

describe('valores e datas de extractos', () => {
  it('formatos de valor', () => {
    expect(parseAmount('1.234.567,89')).toBe(123456789);
    expect(parseAmount('1 234 567,89')).toBe(123456789);
    expect(parseAmount('1 234,5')).toBe(123450);
    expect(parseAmount('1,234,567.89')).toBe(123456789);
    expect(parseAmount('-1234.5')).toBe(-123450);
    expect(parseAmount('(1.000,00)')).toBe(-100000);
    expect(parseAmount('1.000,00 D')).toBe(-100000);
    expect(parseAmount('1.000,00C')).toBe(100000);
    expect(parseAmount('Kz 250.000,00')).toBe(25000000);
    expect(parseAmount('1.500')).toBe(150000);
    expect(parseAmount('1500-')).toBe(-150000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('formatos de data', () => {
    expect(parseDate('31/10/2026')).toBe('2026-10-31');
    expect(parseDate('31-10-26')).toBe('2026-10-31');
    expect(parseDate('2026-10-31 14:22')).toBe('2026-10-31');
    expect(parseDate('5.11.2026')).toBe('2026-11-05');
    expect(parseDate('46326')).toBe('2026-10-31');
    expect(parseDate('31/02/2026')).toBeNull();
  });
});

const BAI = `Extracto de Conta
Conta;0040 0000 1234 5678 1011 2
Período;01/10/2026 a 31/10/2026

Data Mov.;Data Valor;Descritivo;Débito;Crédito;Saldo
31/10/2026;31/10/2026;TRF SALARIOS 10/2026;3.351.844,50;;6.648.155,50
30/10/2026;30/10/2026;COMISSAO MANUTENCAO;1.500,00;;10.000.000,00
29/10/2026;29/10/2026;TRF RECEBIDA CLIENTE;;5.001.500,00;10.001.500,00
Saldo final;;;;;6.648.155,50
`;

describe('leitura de extractos', () => {
  it('detecta o cabeçalho depois do preâmbulo, débito/crédito, ordem decrescente e saldos', () => {
    const s = parseStatement(BAI);
    expect(s.headerRow).toBe(4);
    expect(s.mapping).toMatchObject({ date: 0, description: 2, debit: 3, credit: 4, balance: 5 });
    expect(s.rows.map((r) => [r.date, r.amountMinor])).toEqual([
      ['2026-10-29', 500150000], ['2026-10-30', -150000], ['2026-10-31', -335184450],
    ]);
    expect(s.balance).toEqual({ openingMinor: 500000000, closingMinor: 664815550, ok: true, breaks: [] });
    expect([s.from, s.to, s.inflowMinor, s.outflowMinor]).toEqual(['2026-10-29', '2026-10-31', 500150000, 335334450]);
    expect(s.problems).toEqual([]);
  });
  it('coluna única de montante com vírgulas e aspas', () => {
    const s = parseStatement('Date,Description,Reference,Amount\n2026-11-05,"PAG INSS, OUT/2026",RUP123,"-424,600.00"\n');
    expect(s.rows[0]).toMatchObject({ date: '2026-11-05', description: 'PAG INSS, OUT/2026', reference: 'RUP123', amountMinor: -42460000 });
    expect(s.balance).toBeNull();
  });
  it('saldo que não bate é assinalado', () => {
    const s = parseStatement('Data;Descritivo;Montante;Saldo\n01/10/2026;A;-100,00;900,00\n02/10/2026;B;-100,00;700,00\n');
    expect(s.balance?.ok).toBe(false);
    expect(s.balance?.breaks).toEqual([3]);
  });
  it('sem cabeçalho reconhecível pede a correspondência das colunas', () => {
    const s = parseStatement('x;y;z\n1;2;3\n');
    expect(s.mapping).toBeNull();
    expect(s.problems[0]?.message).toMatch(/data/);
    const m = parseStatement('x;y;z\n01/10/2026;Pag;-5,00\n', { mapping: { date: 0, description: 1, amount: 2 }, headerRow: 0 });
    expect(m.rows).toHaveLength(1);
  });
  it('não reimporta movimentos de extractos sobrepostos, mas conta repetições legítimas', () => {
    const r = (d: string, a: number) => ({ line: 1, date: d, description: 'TRF', reference: null, amountMinor: a, balanceMinor: null });
    const existing = new Map([[lineFingerprint(r('2026-10-01', -500)), 1]]);
    const { fresh, duplicates } = newRows([r('2026-10-01', -500), r('2026-10-01', -500), r('2026-10-02', -700)], existing);
    expect(fresh).toHaveLength(2);
    expect(duplicates).toBe(1);
  });
});

describe('correspondência com pagamentos', () => {
  const L = (id: string, date: string, description: string, amountMinor: number) => ({ id, date, description, reference: null, amountMinor });
  it('valor exacto único é automático; o mesmo valor em dois pagamentos usa o período do descritivo', () => {
    const m = matchPayments(
      [L('a', '2026-10-31', 'TRF SALARIOS', -100000), L('b', '2026-11-20', 'PAG AGT IRT 10/2026', -5000), L('c', '2026-11-21', 'PAG AGT IRT 09/2026', -5000)],
      [
        { key: 'sal', kind: 'salaries', period: '2026-10', amountMinor: 100000, date: '2026-10-31', reference: null },
        { key: 'irt10', kind: 'irt', period: '2026-10', amountMinor: 5000, date: '2026-11-20', reference: null },
        { key: 'irt09', kind: 'irt', period: '2026-09', amountMinor: 5000, date: '2026-11-20', reference: null },
      ],
    );
    expect(m.find((x) => x.key === 'sal')).toMatchObject({ lineIds: ['a'], auto: true });
    expect(m.find((x) => x.key === 'irt10')).toMatchObject({ lineIds: ['b'], auto: true });
    expect(m.find((x) => x.key === 'irt09')).toMatchObject({ lineIds: ['c'], auto: true });
  });
  it('fora da janela de datas ou valor diferente não corresponde; sem distinção fica como sugestão', () => {
    expect(matchPayments([L('a', '2026-12-31', 'X', -100)], [{ key: 'p', kind: 'inss', period: '2026-10', amountMinor: 100, date: '2026-11-01', reference: null }])).toEqual([]);
    expect(matchPayments([L('a', '2026-11-01', 'X', -101)], [{ key: 'p', kind: 'inss', period: '2026-10', amountMinor: 100, date: '2026-11-01', reference: null }])).toEqual([]);
    const m = matchPayments([L('a', '2026-11-01', 'TRF', -100), L('b', '2026-11-02', 'TRF', -100)], [{ key: 'p', kind: 'inss', period: '2026-10', amountMinor: 100, date: '2026-11-01', reference: null }]);
    expect(m).toEqual([expect.objectContaining({ key: 'p', auto: false })]);
  });
  it('salários pagos por transferências individuais', () => {
    const m = matchPayments(
      [L('1', '2026-10-31', 'TRF JOANA', -30000), L('2', '2026-10-31', 'TRF EDSON', -50000), L('3', '2026-10-31', 'TRF NELSON', -20000), L('x', '2026-10-31', 'COMISSAO', -150)],
      [{ key: 'sal', kind: 'salaries', period: '2026-10', amountMinor: 100000, date: '2026-10-31', reference: null, parts: [30000, 50000, 20000] }],
    );
    expect(m).toEqual([{ key: 'sal', lineIds: ['2', '1', '3'], rule: 'transferencias_individuais', score: 90, auto: true }]);
  });
  it('pagamento sem comprovativo após 5 dias', () => {
    expect(missingProof('2026-10-20', '2026-10-26')).toBe(true);
    expect(missingProof('2026-10-22', '2026-10-26')).toBe(false);
  });
});
