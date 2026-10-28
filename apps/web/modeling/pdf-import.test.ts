import { describe, expect, it } from 'vitest';
import { parseHistoricalTrialBalance } from '@kianda/core';
import { PDF_IMPORT_LIMIT, extractPdfTrialBalance, trialBalanceFromPdfPages, type PdfTextItem } from './pdf-import';

const token = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, width, height: 10, transform: [10, 0, 0, 10, x, y] });
const row = (y: number, code: string, name: string, debit: string, credit: string) => [token(code,40,y),token(name,120,y),token(debit,490-debit.length*5,y),token(credit,620-credit.length*5,y)];
const header = () => [token('Conta',40,750),token('Designação',120,750),token('Saldo Devedor',425,750),token('Saldo Credor',560,750)];
const page = () => [...header(),...row(725,'43','Depósitos à ordem','1 000,25',''),...row(710,'51','Capital social','','1 000,25')];

/** PDF real de teste: texto WinAnsi, objectos, streams e xref, sem dependência de um gerador externo. */
function fixturePdf(pages: PdfTextItem[][]): Uint8Array {
  const objects: string[] = ['', '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const references: string[] = [];
  for (const items of pages) {
    const id=objects.length;references.push(`${id} 0 R`);
    const stream=items.map(t=>`BT /F1 10 Tf 1 0 0 1 ${t.transform[4]} ${t.transform[5]} Tm (${t.str.replace(/[\\()]/g,'\\$&')}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`, `<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${references.join(' ')}] >>`;
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf,'latin1'));
}

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
