import { describe, expect, it } from 'vitest';
import { fixturePdf } from '../test-fixtures/pdf';
import { parseHistoricalTrialBalance } from '@kianda/core';
import { PDF_IMPORT_LIMIT, extractPdfTrialBalance, trialBalanceFromPdfPages, type PdfTextItem } from './pdf-import';

const token = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, width, height: 10, transform: [10, 0, 0, 10, x, y] });
const row = (y: number, code: string, name: string, debit: string, credit: string) => [token(code,40,y),token(name,120,y),token(debit,490-debit.length*5,y),token(credit,620-credit.length*5,y)];
const header = () => [token('Conta',40,750),token('Designação',120,750),token('Saldo Devedor',425,750),token('Saldo Credor',560,750)];
const page = () => [...header(),...row(725,'43','Depósitos à ordem','1 000,25',''),...row(710,'51','Capital social','','1 000,25')];
const erpHeader=()=>[token('Empresa de exemplo',40,825),token('Balancete Geral (Período[Abertura - Agosto] e Acumulado) - 2026',40,805),token('Valores em AKZ',550,790),token('Data Contab.: 31-08-2026',40,790),token('Agosto',320,770),token('Acumulado',540,770),token('Conta',40,750),token('Descrição',100,750),token('Mov. Débito',215,750),token('Mov. Crédito',290,750),token('Saldo',390,750),token('Mov. Débito',465,750),token('Mov. Crédito',540,750),token('Saldo',640,750)];
const erpRow=(y:number,code:string,name:string,values:string[])=>[token(code,40,y),token(name,100,y),...values.map((v,i)=>token(v,[255,330,425,505,580,680][i]!-v.length*5,y))];
const erpPage=()=>[...erpHeader(),...erpRow(725,'43','Banco',['500,00','100,00','400,00 D','1100,00','100,00','1000,00 D']),...erpRow(710,'51','Capital',['0,00','400,00','400,00 C','0,00','1000,00','1000,00 C'])];


describe('importação de balancetes PDF por coordenadas', () => {
  it('lê saldos finais, preserva cêntimos e normaliza um CSV conferível', () => {
    const result=trialBalanceFromPdfPages([page()]);
    expect(result).toMatchObject({accounts:2,pages:1,difference:0});
    expect(parseHistoricalTrialBalance(result.text).lines).toMatchObject([{code:'43',v:1000.25},{code:'51',v:-1000.25}]);
  });
  it('extrai um PDF binário real de várias páginas usando a mesma versão PDF.js distribuída', async () => {
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=pdfjs.getDocument({data:fixturePdf([[...header(),...row(725,'43','Depósitos à ordem','1000,25','')],[...header(),...row(725,'51','Capital','','1000,25')]]),disableFontFace:true,useSystemFonts:true,useWorkerFetch:false,stopAtErrors:true,verbosity:0});
    try{
      const doc=await task.promise,items:PdfTextItem[][]=[];
      for(let i=1;i<=doc.numPages;i++){const content=await (await doc.getPage(i)).getTextContent();items.push(content.items.filter((v):v is typeof v & PdfTextItem=>'str'in v));}
      const result=trialBalanceFromPdfPages(items);expect(result).toMatchObject({accounts:2,pages:2,difference:0});
      expect(result.text).toContain('Depósitos à ordem');expect(parseHistoricalTrialBalance(result.text).lines[0]!.v).toBe(1000.25);
    }finally{await task.destroy();}
  });
  it('reordena texto fora de sequência e vários fragmentos por montante', () => {
    const items=page().filter(t=>t.str!=='1 000,25');
    items.push(token('1',450,725,5),token('000,25',460,725,30),token('1',580,710,5),token('000,25',590,710,30));
    expect(trialBalanceFromPdfPages([items.reverse()]).difference).toBe(0);
  });
  it('conserva várias páginas com cabeçalhos repetidos, sem repetir os títulos como contas', () => {
    const p1=[...header(),...row(725,'43','Banco','500,00','')],p2=[...header(),...row(725,'51','Capital','','500,00')];
    expect(trialBalanceFromPdfPages([p1,p2])).toMatchObject({accounts:2,pages:2,difference:0});
  });
  it('selecciona o saldo acumulado num relatório ERP com dois blocos e não o saldo do período', () => {
    const result=trialBalanceFromPdfPages([erpPage()]);
    expect(result).toMatchObject({accounts:2,difference:0,scope:'accumulated',period:{from:'2026-01-01',to:'2026-08-31'},currency:'Kz',entityName:'Empresa de exemplo'});
    expect(parseHistoricalTrialBalance(result.text).lines).toMatchObject([{code:'43',v:1000},{code:'51',v:-1000}]);
  });
  it('lê o mesmo formato ERP num PDF binário real e conserva o período e a moeda',async()=>{
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:fixturePdf([erpPage()]),disableFontFace:true,useSystemFonts:true,useWorkerFetch:false,stopAtErrors:true,verbosity:0});
    try{const doc=await task.promise,content=await(await doc.getPage(1)).getTextContent();const r=trialBalanceFromPdfPages([content.items.filter((v):v is typeof v & PdfTextItem=>'str'in v)]);expect(r).toMatchObject({scope:'accumulated',accounts:2,difference:0,period:{to:'2026-08-31'}});}finally{await task.destroy();}
  });
  it('confere a soma líquida impressa com as contas extraídas',()=>{
    const result=trialBalanceFromPdfPages([[...erpPage(),...erpRow(690,'','Soma Líquida',['500,00','500,00','0,00','1100,00','1100,00','0,00'])]]);expect(result.difference).toBe(0);
    expect(()=>trialBalanceFromPdfPages([[...erpPage(),...erpRow(690,'','Soma Líquida',['500,00','500,00','0,00','1100,00','1101,00','1,00 C'])]])).toThrow('soma líquida do PDF');
  });
  it('recusa saldos acumulados incompatíveis com os débitos e créditos desse bloco',()=>{
    expect(()=>trialBalanceFromPdfPages([[...erpHeader(),...erpRow(725,'43','Banco',['0,00','0,00','0,00','100,00','10,00','95,00 D'])]])).toThrow('saldo acumulado não corresponde');
  });
  it('não escolhe uma das colunas duplicadas sem indicação inequívoca de Acumulado',()=>{
    expect(()=>trialBalanceFromPdfPages([erpPage().filter(t=>t.str!=='Acumulado')])).toThrow('ambíguas');
  });
  it('preserva uma descrição longa sem a confundir com um montante',()=>{
    const items=erpPage();const label=items.find(t=>t.str==='Banco')!;label.str='Banco em moeda estrangeira - conta de exemplo';label.width=200;
    expect(trialBalanceFromPdfPages([items]).text).toContain(label.str);
  });
  it('reconhece cabeçalhos de saldo devedor e credor numa segunda linha', () => {
    const items=[token('Conta',40,760),token('Designação',120,760),token('Saldos finais',460,760),token('Devedor',450,750),token('Credor',580,750),...page().filter(t=>t.transform[5]!==750)];
    expect(trialBalanceFromPdfPages([items])).toMatchObject({accounts:2,difference:0});
  });
  it('não usa os débitos/créditos do período quando há colunas de saldo final', () => {
    const items=[token('Conta',40,750),token('Designação',110,750),token('Débito',270,750),token('Crédito',355,750),token('Saldo Devedor',440,750),token('Saldo Credor',570,750),token('43',40,725),token('Banco',110,725),token('9999,00',270,725),token('9998,00',355,725),token('500,00',470,725)];
    expect(parseHistoricalTrialBalance(trialBalanceFromPdfPages([items]).text).lines[0]!.v).toBe(500);
  });
  it('interpreta saldos positivos com natureza D/C e rejeita natureza ausente', () => {
    const items=[token('Conta',40,750),token('Designação',120,750),token('Saldo',450,750),token('D/C',560,750),token('51',40,725),token('Capital',120,725),token('1 000,25',435,725),token('C',560,725)];
    expect(parseHistoricalTrialBalance(trialBalanceFromPdfPages([items]).text).lines[0]!.v).toBe(-1000.25);
    expect(()=>trialBalanceFromPdfPages([items.filter(t=>t.str!=='C')])).toThrow('natureza D/C');
  });
  it('interpreta a natureza D/C explícita no próprio saldo sem trocar o sinal', () => {
    const items=[token('Conta',40,750),token('Designação',120,750),token('Saldo',450,750),token('51',40,725),token('Capital',120,725),token('1 000,25 C',435,725)];
    expect(parseHistoricalTrialBalance(trialBalanceFromPdfPages([items]).text).lines[0]!.v).toBe(-1000.25);
    expect(()=>trialBalanceFromPdfPages([[...items.filter(t=>t.str!=='1 000,25 C'),token('-1000,25 C',435,725)]])).toThrow('ambíguos');
  });
  it('recusa movimentos sem saldos finais e extractos bancários sem PGC', () => {
    expect(()=>trialBalanceFromPdfPages([[token('Data',40,750),token('Movimento',120,750),token('Débito',440,750),token('Crédito',570,750)]])).toThrow('Extractos bancários');
  });
  it('não perde uma página digitalizada num documento misto', () => {
    expect(()=>trialBalanceFromPdfPages([page(),[]])).toThrow('página 2 não contém texto');
  });
  it('exige cabeçalhos em todas as páginas e não reutiliza coordenadas de outra página', () => {
    expect(()=>trialBalanceFromPdfPages([page(),row(725,'61','Vendas','','100,00')])).toThrow('cabeçalhos em todas');
  });
  it('recusa colunas ambíguas em vez de adivinhar saldos de abertura e fecho', () => {
    expect(()=>trialBalanceFromPdfPages([[token('Conta',40,750),token('Designação',120,750),token('Saldo',450,750),token('Saldo',570,750)]])).toThrow('ambíguas');
  });
  it('recusa saldos inválidos, linhas incompletas e contas repetidas sem importar parcialmente', () => {
    expect(()=>trialBalanceFromPdfPages([[...header(),...row(725,'43','Banco','1,2345','')]])).toThrow();
    expect(()=>trialBalanceFromPdfPages([[...header(),...row(725,'43','Banco','','')]])).toThrow('faltam');
    expect(()=>trialBalanceFromPdfPages([[...page(),...row(695,'43','Repetida','20,00','')]])).toThrow();
  });
  it('confronta os totais de classe e os totais das contas-mãe com as subcontas', () => {
    expect(trialBalanceFromPdfPages([[...page(),...row(695,'4','Classe 4','1 000,25','')]]).accounts).toBe(2);
    expect(()=>trialBalanceFromPdfPages([[...page(),...row(695,'4','Classe 4','999,00','')]])).toThrow('total da classe 4');
    expect(()=>trialBalanceFromPdfPages([[...page(),...row(695,'431','Banco 1','999,00','')]])).toThrow();
  });
  it('não interpreta valores em milhares como unidades', () => {
    expect(()=>trialBalanceFromPdfPages([[token('Valores em milhares de Kz',40,790),...page()]])).toThrow('em unidades');
  });
  it('rejeita limites e ficheiros falsos antes de carregar o leitor', async () => {
    await expect(extractPdfTrialBalance(new ArrayBuffer(PDF_IMPORT_LIMIT+1))).rejects.toThrow('10 MB');
    await expect(extractPdfTrialBalance(new TextEncoder().encode('não é PDF').buffer)).rejects.toThrow('não é um PDF');
    expect(()=>trialBalanceFromPdfPages(Array.from({length:81},page))).toThrow('80 páginas');
  });
});
