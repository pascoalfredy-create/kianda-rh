import { describe, expect, it } from 'vitest';
import { analyzeFinancialHistory, buildFinancialHistoricalReport, financialModelFromHistory, historicalAmount, parseHistoricalTrialBalance, runFinancialModel } from '../src/index.js';
import { currentHistory, historicalInput, historyCsv } from './fixtures/financial-history.js';
describe('balancetes históricos PGC', () => {
  it.each([['1.234.567,89', 123456789], ['1,234,567.89', 123456789], ['1 234,50 Kz', 123450], ['(45,20)', -4520], ['1.234', 123400], ['0.01', 1], ['', 0]])('lê %s sem perda de cêntimos', (input, expected) => { expect(historicalAmount(input)).toBe(expected); });
  it.each(['12abc', 'NaN', '1e6', '--12', '1,2345', '1.23.45', '1,234.567', '9999999999999999999999999'])('recusa o montante inválido %s', (input) => { expect(() => historicalAmount(input)).toThrow(); });
  it('CSV entre aspas, aspas escapadas e designação com separador não alteram saldos', () => {
    const p = parseHistoricalTrialBalance('Conta;Designação;Saldo\n43;"Banco; \"\"A\"\"";"1.000,25"\n51;Capital;-1000,25');
    expect(p.diff).toBe(0); expect(p.lines[0]).toMatchObject({ nome: 'Banco; "A"', v: 1000.25 });
    expect(() => parseHistoricalTrialBalance('Conta;Designação;Saldo\n43;"Banco;100')).toThrow();
  });
  it('detecta tabulação e vírgula com números decimais entre aspas', () => {
    expect(parseHistoricalTrialBalance('Conta\tDesignação\tDébito\tCrédito\n43\tBanco\t10,50\t\n51\tCapital\t\t10,50').diff).toBe(0);
    expect(parseHistoricalTrialBalance('Conta,Designação,Saldo\n43,Banco,"10,50"\n51,Capital,"-10,50"').diff).toBe(0);
    expect(parseHistoricalTrialBalance('Conta;Designação;Débito;Crédito\n43;Banco;100;60\n51;Capital;0;40')).toMatchObject({ diff: 0, basis: 'accumulated', lines: [{ v: 40 }, { v: -40 }] });
  });
  it('selecciona o nível mais detalhado e confere o total da conta-mãe', () => {
    const p = parseHistoricalTrialBalance('Conta;Designação;Saldo\n31;Clientes;270\n31.1;Cliente A;300\n31.2;Adiantamento;-30\n51;Capital;-270');
    expect(p.lines.map(v => v.code)).toEqual(['31.1', '31.2', '51']); expect(p.ignoredParents).toBe(1); expect(p.diff).toBe(0);
    expect(() => parseHistoricalTrialBalance('Conta;Designação;Saldo\n31;Clientes;300\n31.1;A;200')).toThrow();
    expect(() => parseHistoricalTrialBalance('Conta;Designação;Saldo\n31.1;A;200\n311;A;200')).toThrow();
  });
  it.each(['Conta;Designação;Saldo\n43;Banco;erro', 'Conta;Designação;Saldo Devedor;Saldo Credor\n43;Banco;10;20', 'Conta;Débito;Débito;Crédito\n43;10;10;0', 'Conta;Designação;Saldo\n74;Sem classificação;100', 'Conta;Designação;Saldo\n88;Apurado;-100'])('não ignora linhas inválidas ou sem classificação', (csv) => { expect(() => parseHistoricalTrialBalance(csv)).toThrow(); });
  it('preserva os adiantamentos de clientes e fornecedores sem compensar saldos de terceiros', () => {
    const a = analyzeFinancialHistory(historicalInput);
    expect(a.pN.diff).toBe(0); expect(a.cN.B).toMatchObject({ activo: 1703, cp: 1108, passivo: 595, check: 0, clientes: 300, fornec: 240, oAct: 23, oPas: 75, empCP: 70, empLP: 210 });
    expect(a.cN.P).toMatchObject({ vn: 1200, cev: 700, pes: 120, ebitda: 270, ro: 210, rai: 188, imp: 38, rl: 150, fst: 110 });
  });
  it('fluxo estimado reconcilia caixa sem chamar dividendos aos outros movimentos de capital', () => {
    const a = analyzeFinancialHistory(historicalInput);
    expect(a.cashFlow).toMatchObject({ cfo: 142, cfi: -110, otherEquity: 18, cff: -2, change: 30, difference: 0 });
    expect(a.warnings.join(' ')).toContain('reconciliação algébrica não confirma');
    expect(a.rN.pmr).toBeCloseTo(275 / 1200 * 365);
    expect(a.rN.pmp).toBeCloseTo(220 / (700 + 50 + 110) * 365);
  });
  it('um único exercício não inventa fluxos e as divisões sem denominador ficam indisponíveis', () => {
    const a = analyzeFinancialHistory({ ...historicalInput, N1: '', N: historyCsv([['43', 100], ['51', -100]]) });
    expect(a.cashFlow).toBeNull(); expect(a.rN.lg).toBeNull(); expect(a.rN.roe).toBe(0); expect(a.rN.cc).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
    expect(() => analyzeFinancialHistory({ ...historicalInput, anos: ['2023', '2025'] })).toThrow();
    expect(() => analyzeFinancialHistory({ ...historicalInput, N1: 'inválido' })).toThrow();
  });
  it('balancetes desequilibrados podem ser diagnosticados mas não originam modelos', () => {
    const input = { ...historicalInput, N: historyCsv(currentHistory.map(([c, v]) => [c, c === '43' ? v + 1 : v])) };
    expect(analyzeFinancialHistory(input).cN.B.check).toBe(1);
    expect(() => financialModelFromHistory(input)).toThrow();
  });
  it('cria uma base rastreável mantendo o capital próprio e sem inventar crescimento', () => {
    const raw = structuredClone(historicalInput), derived = financialModelFromHistory(raw), r = runFinancialModel(derived.assumptions);
    expect(r.checks.balance).toBe(true); expect(r.bookEq).toBe(1108); expect(derived.assumptions.receitas[0]).toMatchObject({ preco: 1200, cresc: 0, esc: 0 });
    expect(derived.assumptions.pessoal).toBe(120); expect(derived.assumptions.historicalBasis.year).toBe('2025'); expect(raw).toEqual(historicalInput);
  });
  it('não amortiza investimentos financeiros como se fossem imobilizado operacional', () => {
    const input = { ...historicalInput, N: historyCsv([...currentHistory, ['13', 10], ['58', -10]]) };
    expect(analyzeFinancialHistory(input).pN.diff).toBe(0); expect(() => financialModelFromHistory(input)).toThrow();
  });
  it('o oitavo relatório contém os dados históricos e as limitações de caixa', () => {
    const report = buildFinancialHistoricalReport(analyzeFinancialHistory({ ...historicalInput, moeda: 'EUR' }));
    expect(report).toMatchObject({ key: 'analise', currency: 'EUR' });
    expect(JSON.stringify(report)).toContain('Fluxo de caixa estimado');
    for (const b of report.blocks) if (b.kind === 'table') for (const r of b.rows) expect(r.cells).toHaveLength(b.columns.length);
  });
});
