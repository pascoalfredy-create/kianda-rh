import { describe, expect, it } from 'vitest';
import { analyzeFinancialHistory, buildFinancialHistoricalReport, financialModelFromHistory, historicalAmount, parseHistoricalReference, parseHistoricalTrialBalance, runFinancialModel } from '../src/index.js';
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
  it.each(['Conta;Designação;Saldo\n43;Banco;erro', 'Conta;Designação;Saldo Devedor;Saldo Credor\n43;Banco;10;20', 'Conta;Débito;Débito;Crédito\n43;10;10;0', 'Conta;Designação;Saldo\n74;Sem classificação;100'])('não ignora linhas inválidas ou sem classificação', (csv) => { expect(() => parseHistoricalTrialBalance(csv)).toThrow(); });
  it('distingue campo vazio de excesso de texto na mensagem de erro', () => {
    try{parseHistoricalTrialBalance('');throw Error('não recusou');}catch(error){expect(error).toMatchObject({issues:[{path:'N',message:expect.stringContaining('está vazio')}]});}
    try{parseHistoricalTrialBalance('x'.repeat(250001));throw Error('não recusou');}catch(error){expect(error).toMatchObject({issues:[{path:'N',message:expect.stringContaining('excede 250 000')}]});}
  });
  it('reconstitui custos apurados, mantém regularizações e não duplica a conta 88', () => {
    const N=historyCsv([['11',850],['18',-100],['51',-1000],['75',10],['82',0],['8207',100],['8208',100],['8209',40],['8219',-240],['88',240],['881',240]]);
    const a=analyzeFinancialHistory({...historicalInput,N,N1:''});
    expect(a.pN.diff).toBe(0);expect(a.cN.income).toMatchObject({stage:'closing',complete:true});
    expect(a.cN.P).toMatchObject({pes:100,amort:100,oCus:50,ro:-250,rl:-250});
    expect(a.cN.B).toMatchObject({activo:750,cp:750,rl:-250,check:0});expect(a.rN.pmp).toBeNull();
    expect(a.warnings.join(' ')).toContain('regularizações posteriores');
  });
  it('82.19 é transferência irmã de 82.1, sem ser confundida com uma subconta das vendas', () => {
    const N=historyCsv([['43',200],['51',-100],['82',0],['82.1',-100],['82.19',100],['88.1',-100]]);
    const a=analyzeFinancialHistory({...historicalInput,N,N1:''});expect(a.pN.diff).toBe(0);
    expect(a.cN.P).toMatchObject({vendas:100,vn:100,rl:100});expect(a.cN.B.check).toBe(0);
  });
  it('transfere para resultados transitados sem voltar a adicionar o lucro ao capital próprio', () => {
    const N=historyCsv([['43',160],['51',-100],['81',-60],['821',-60],['8219',60],['881',-60],['889',60]]);
    const a=analyzeFinancialHistory({...historicalInput,N,N1:''});expect(a.pN.diff).toBe(0);
    expect(a.cN.P.rl).toBe(60);expect(a.cN.B).toMatchObject({rl:0,cp:160,check:0});expect(a.cN.income.complete).toBe(true);
  });
  it('reconcilia o mesmo resultado antes e depois do apuramento completo',()=>{
    const before=analyzeFinancialHistory({...historicalInput,N1:''});
    const stable=currentHistory.filter(([c])=>!['61','71','72','73','75.2','76','87'].includes(c));
    const N=historyCsv([...stable,['821',-1200],['826',700],['827',120],['828',60],['829',110],['8219',210],['832',22],['839',-22],['871',38],['879',-38],['881',-210],['882',22],['885',38]]);
    const after=analyzeFinancialHistory({...historicalInput,N,N1:''});
    expect(after.cN.B).toEqual(before.cN.B);expect(after.cN.income.complete).toBe(true);
    expect({...after.cN.P,fst:before.cN.P.fst}).toEqual(before.cN.P);
  });
  it('um balancete apurado só com resultado líquido permite Balanço, sem inventar EBITDA ou DR detalhada', () => {
    const N=historyCsv([['43',100],['51',-120],['88',20]]),a=analyzeFinancialHistory({...historicalInput,N,N1:''});
    expect(a.cN.income.complete).toBe(false);expect(a.cN.P.rl).toBe(-20);expect(a.cN.B.check).toBe(0);
    expect(a.rN).toMatchObject({dle:null,icr:null,mb:null,me:null,mo:null,roa:null,rot:null});expect(a.cashFlow).toBeNull();
    const report=buildFinancialHistoricalReport(a),dr=report.blocks.find(b=>b.kind==='table'&&b.title==='Demonstração de resultados histórica');
    expect(dr?.kind==='table'&&dr.rows.find(r=>r.cells[0]!.value==='EBITDA')?.cells[1]!.value).toBeNull();
    expect(()=>financialModelFromHistory({...historicalInput,N,N1:''})).toThrow();
  });
  it('preserva diferenças reais do documento e bloqueia a criação de um modelo desequilibrado', () => {
    const N=historyCsv([['43',95],['51',-120],['88',20]]),a=analyzeFinancialHistory({...historicalInput,N,N1:''});
    expect(a.pN.diff).toBe(-5);expect(a.cN.B.check).toBe(-5);expect(a.warnings.join(' ')).toContain('desequilibrado');
  });
  it('usa os dias do período intercalar sem anualizar receitas ou resultados', () => {
    const input={...historicalInput,anos:['2025','2026'],periods:{N:{from:'2026-01-01',to:'2026-08-31'}}};
    const a=analyzeFinancialHistory(input);expect(a.cN.P.vn).toBe(1200);expect(a.rN.pmr).toBeCloseTo(275/1200*243);expect(a.rN.dle).toBeNull();expect(a.cashFlow).not.toBeNull();
    expect(()=>financialModelFromHistory(input)).toThrow();
    expect(JSON.stringify(buildFinancialHistoricalReport(a))).toContain('01/01/2026 a 31/08/2026');
  });
  it('não estima fluxos com saldos comparativos fora da abertura do período', () => {
    const a=analyzeFinancialHistory({...historicalInput,anos:['2025','2026'],periods:{N:{from:'2026-01-01',to:'2026-08-31'},N1:{from:'2025-01-01',to:'2025-08-31'}}});
    expect(a.cashFlow).toBeNull();expect(a.warnings.join(' ')).toContain('início do período N');expect(a.rN.pmr).toBeCloseTo(300/1200*243);
  });
  it.each([{from:'2026-02-30',to:'2026-08-31'},{from:'2025-01-01',to:'2026-08-31'},{from:'2026-09-01',to:'2026-08-31'}])('recusa períodos inválidos ou de outro exercício', period => {
    expect(()=>analyzeFinancialHistory({...historicalInput,anos:['2025','2026'],periods:{N:period}})).toThrow();
  });
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
    expect(analyzeFinancialHistory({ ...historicalInput, anos: ['2023', '2025'] }).cashFlow).toBeNull();
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
  it('mantém o sector do projecto quando o balancete é usado como base', () => {
    const derived = financialModelFromHistory(historicalInput, 'mineracao');
    expect(derived.sector).toBe('mineracao');
    expect(derived.assumptions.receitas[0]!.unid).toBe('índice');
    expect(runFinancialModel(derived.assumptions).k.check.every(v => Math.abs(v) <= 0.01)).toBe(true);
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
  it('compara meses do mesmo exercício pelas datas de referência, sem inventar fluxos do acumulado',()=>{
    const a=analyzeFinancialHistory({...historicalInput,anos:['2026','2026'],periods:{N1:{from:'2026-01-01',to:'2026-07-31'},N:{from:'2026-01-01',to:'2026-08-31'}}});
    expect(a.cN.P.vn).toBe(1200);expect(a.c1!.P.vn).toBe(1000);expect(a.cashFlow).toBeNull();expect(a.warnings.join(' ')).toContain('durações diferentes');
    const text=JSON.stringify(buildFinancialHistoricalReport(a));expect(text).toContain('31/07/2026');expect(text).toContain('31/08/2026');
  });
  it('aceita uma abertura do mesmo ano imediatamente anterior a um período mensal',()=>{
    const a=analyzeFinancialHistory({...historicalInput,anos:['2026','2026'],periods:{N1:{from:'2026-01-01',to:'2026-07-31'},N:{from:'2026-08-01',to:'2026-08-31'}}});
    expect(a.cashFlow).not.toBeNull();
  });
  it('recusa comparativos futuros, datas repetidas e anos iguais sem datas identificadas',()=>{
    const attempts=[{anos:['2027','2026']},{anos:['2026','2026']},{anos:['2026','2026'],periods:{N:{from:'2026-01-01',to:'2026-08-31'},N1:{from:'2026-01-01',to:'2026-08-31'}}}];
    for(const attempt of attempts)expect(()=>analyzeFinancialHistory({...historicalInput,...attempt})).toThrow();
  });
  it('a ausência de N identifica o campo obrigatório antes de validar o comparativo',()=>{
    try{analyzeFinancialHistory({...historicalInput,N:'',anos:['2026','2026']});throw Error('não recusou');}catch(error){expect(error).toMatchObject({issues:[{path:'N',message:expect.stringContaining('apenas o comparativo')}]});}
    expect(()=>analyzeFinancialHistory({...historicalInput,N1:'',anos:['2026','2026']})).not.toThrow();
  });
  it.each(['31/08/2026','2026-08-31'])('interpreta a referência %s sem a confundir com um exercício anual',value=>{
    expect(parseHistoricalReference(value)).toEqual({year:'2026',period:{from:'2026-01-01',to:'2026-08-31'}});
    expect(parseHistoricalReference(value,{from:'2026-08-01',to:'2026-08-31'})?.period?.from).toBe('2026-08-01');
  });
  it('mantém anos completos e recusa datas inválidas na leitura dos campos',()=>{
    expect(parseHistoricalReference('2026')).toEqual({year:'2026'});
    for(const value of ['31/02/2026','2026-02-30','','2026abc','2200'])expect(parseHistoricalReference(value)).toBeNull();
  });
});
