import { describe, expect, it } from 'vitest';
import { balanceNumber, balanceRowsFromPdf, monthHeader, parseBalance, readBalanceDocument, type BalanceOptions } from './balance-import';

const base: BalanceOptions = { unit: 'kz', signed: true, cumulative: false, year: 2026 };

describe('importação de balancetes do Valora', () => {
  it('exige a unidade e converte uma vez para milhões de Kz, ao cêntimo', () => {
    const rows = [['conta', 'descrição', 'Jan', 'Fev'], ['61', 'Vendas', '-1 234 567,89', '-2.000.000,01']];
    expect(parseBalance(rows, { ...base, unit: '' }).error).toMatch(/unidade/);
    const kz = parseBalance(rows, base);
    expect(kz.acc.v61).toEqual({ 0: 1.23456789, 1: 2.00000001 });
    const mil = parseBalance([['conta', 'Jan'], ['61', '-1 234,5']], { ...base, unit: 'mil' });
    expect(mil.acc.v61![0]).toBeCloseTo(1.2345, 10);
    const mkz = parseBalance([['conta', 'Jan'], ['61', '-1 234,5']], { ...base, unit: 'milhoes' });
    expect(mkz.acc.v61![0]).toBe(1234.5);
  });

  it('não soma contas-mãe quando o ficheiro traz as subcontas', () => {
    const r = parseBalance([['conta', 'Jan'], ['31', '300'], ['311', '100'], ['312', '200'], ['6', '-50'], ['61', '-50']], base);
    expect(r.acc.clientes![0]).toBeCloseTo(300 / 1e6, 12);
    expect(r.acc.v61![0]).toBeCloseTo(50 / 1e6, 12);
    expect(r.parents).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/conta\(s\)-mãe/);
  });

  it('respeita a natureza das contas e assinala saldos contrários', () => {
    const r = parseBalance([['conta', 'Jan'], ['31', '-500'], ['32', '-800'], ['34.1', '120'], ['34.2', '-40'], ['51', '-1000'], ['18', '-70'], ['87', '30']], base);
    expect(r.acc.clientes![0]).toBeCloseTo(-500 / 1e6, 12);
    expect(r.acc.fornec![0]).toBeCloseTo(800 / 1e6, 12);
    expect(r.acc.outdev![0]).toBeCloseTo(120 / 1e6, 12);
    expect(r.acc.estado![0]).toBeCloseTo(40 / 1e6, 12);
    expect(r.acc.capital![0]).toBeCloseTo(1000 / 1e6, 12);
    expect(r.acc.amort![0]).toBeCloseTo(70 / 1e6, 12);
    expect(r.acc.imp![0]).toBeCloseTo(30 / 1e6, 12);
    expect(r.lines.find((l) => l.code === '31')!.contrary).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/natureza contrária.*31/);
  });

  it('sem convenção de sinal, lê os valores na natureza normal e as contas 34–37 como passivo', () => {
    const r = parseBalance([['conta', 'Jan'], ['61', '900'], ['32', '800'], ['36', '50']], { ...base, signed: false });
    expect(r.acc.v61![0]).toBeCloseTo(900 / 1e6, 12);
    expect(r.acc.fornec![0]).toBeCloseTo(800 / 1e6, 12);
    expect(r.acc.outcred![0]).toBeCloseTo(50 / 1e6, 12);
  });

  it('recusa colunas de outro exercício e meses repetidos', () => {
    expect(parseBalance([['conta', 'Jan 2025'], ['61', '1']], base).error).toMatch(/2025.*2026/);
    expect(parseBalance([['conta', '2026-01', '01/2026'], ['61', '1', '2']], base).error).toMatch(/repete/);
    expect(parseBalance([['conta', 'jan-26', 'fev-26'], ['61', '-1', '-2']], base).months).toEqual([0, 1]);
  });

  it('converte o acumulado das classes 6 e 7 em movimentos do mês, sem mexer nos saldos', () => {
    const r = parseBalance([['conta', 'Jan', 'Fev', 'Mar'], ['61', '-100', '-250', '-450'], ['72', '40', '80', '120'], ['43', '10', '20', '30']], { ...base, cumulative: true });
    expect(Object.values(r.acc.v61!).map((v) => v * 1e6)).toEqual([100, 150, 200].map((v) => expect.closeTo(v, 6)));
    expect(Object.values(r.acc.c72!).map((v) => v * 1e6)).toEqual([40, 40, 40].map((v) => expect.closeTo(v, 6)));
    expect(Object.values(r.acc.caixa!).map((v) => v * 1e6)).toEqual([10, 20, 30].map((v) => expect.closeTo(v, 6)));
  });

  it('aceita a chave da rubrica no lugar da conta e ignora provisões e a conta 88', () => {
    const r = parseBalance([['conta', 'Jan'], ['empCP', '-75'], ['39', '-5'], ['88', '-20'], ['Total', '0']], base);
    expect(r.acc.empCP![0]).toBeCloseTo(75 / 1e6, 12);
    expect(r.ignored).toHaveLength(3);
  });

  it('dá o controlo do mês: resultado e diferença de balanço em Kz', () => {
    const rows = [['conta', 'Jan'], ['61', '-1000'], ['72', '400'], ['43', '1600'], ['51', '-1000']];
    const r = parseBalance(rows, base);
    expect(r.control).toEqual([{ month: 0, resultKz: 600, differenceKz: 0 }]);
    const off = parseBalance([...rows, ['31', '50']], base);
    expect(off.control[0]!.differenceKz).toBe(50);
  });

  it('lê números à portuguesa, com parênteses e com sinal no fim', () => {
    expect(balanceNumber('1 234,56')).toBe(1234.56);
    expect(balanceNumber('(1.234,56)')).toBe(-1234.56);
    expect(balanceNumber('1,234.56')).toBe(1234.56);
    expect(balanceNumber('1.234.567')).toBe(1234567);
    expect(balanceNumber('500-')).toBe(-500);
    expect(balanceNumber('—')).toBeNull();
    expect(monthHeader('Março 2026')).toEqual({ month: 2, year: 2026 });
    expect(monthHeader('M12')).toEqual({ month: 11, year: null });
    expect(monthHeader('Total')).toBeNull();
  });

  it('monta a tabela de um PDF com texto pelas colunas do cabeçalho', () => {
    const t = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5, height: 10 });
    const rows = balanceRowsFromPdf([[t('Conta', 10, 700), t('Jan', 200, 700), t('Fev', 300, 700), t('61', 10, 680), t('Vendas', 40, 680), t('-1 000,00', 190, 680), t('-2 000,00', 290, 680)]]);
    expect(rows[0]).toEqual(['Conta', 'Jan', 'Fev']);
    expect(rows[1]![0]).toContain('61');
    expect(rows[1]!.slice(1)).toEqual(['-1 000,00', '-2 000,00']);
    expect(() => balanceRowsFromPdf([[]])).toThrow(/texto seleccionável/);
  });

  it('recusa .xls antigo e lê CSV', async () => {
    await expect(readBalanceDocument(new File(['x'], 'b.xls'))).rejects.toThrow(/\.xlsx/);
    const doc = await readBalanceDocument(new File(['conta;Jan\n61;-10'], 'b.csv'));
    expect(doc.rows).toEqual([['conta', 'Jan'], ['61', '-10']]);
  });
});
