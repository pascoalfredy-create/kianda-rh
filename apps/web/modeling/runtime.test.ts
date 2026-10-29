import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { analyzeFinancialHistory, convertFinancialCurrency, FINANCIAL_REPORT_KEYS, FINANCIAL_SECTORS, financialTemplate, runFinancialModel, type FinancialAssumptions, type FinancialHistoricalInput } from '@kianda/core';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
const runtime = readFileSync(new URL('../public/modeling-runtime.js', import.meta.url), 'utf8');
const views = ['painel', 'pressupostos', 'demonstracoes', 'avaliacao', 'credito', 'sensibilidade', 'relatorios'];
/** Teste do código distribuído e das vistas, sem simular um motor de layout de navegador. */
async function mount(sector: typeof FINANCIAL_SECTORS[number], canWrite = true, incomplete = false, withHistory = false, deferRead = false, historyInput:FinancialHistoricalInput=historicalInput, allowedSectors: readonly typeof FINANCIAL_SECTORS[number][] = FINANCIAL_SECTORS, projects: { initialArchived?: boolean; restoreFails?: boolean; deferUsage?: boolean; historyFailsAfterRestore?: boolean; historyFailsOnRefresh?: boolean } = {}) {
  const template = financialTemplate(sector), handlers = new Map<string, Function>();
  const nodes = new Map<string, any>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) { const classes = new Set<string>(); nodes.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style:{}, classList: { add(v: string) { classes.add(v); }, remove(v: string) { classes.delete(v); }, contains(v: string) { return classes.has(v); } }, insertAdjacentHTML(_position: string, html: string) { this.innerHTML = html + this.innerHTML; } }); }
    return nodes.get(selector)!;
  };
  node('#integra-session').textContent = JSON.stringify({ canWrite, permission: canWrite ? 'editor' : 'viewer', formats: { pdf: true, xlsx: false, csv: false }, usage: {} });
  const model = { id: 'm1', name: template.name, sector, currency: template.currency, revision: 1, createdAt: '2026-10-28', archivedAt: projects.initialArchived ? '2026-10-29T08:00:00Z' : null as string | null, assumptions: incomplete ? { pessoal: 1 } : template.assumptions };
  const records = [model], pendingUsage: (() => void)[] = [];
  let restored=false,modelReads=0;
  const requests: { path: string; method?: string; payload?: any }[] = [];
  const pendingReads: (()=>void)[]=[];
  const currencyField=node('[data-p="moeda"]');currencyField.dataset={p:'moeda',t:'t'};currencyField.value=model.currency;
  node('#fxFrom').value=model.currency;
  const field = { disabled: false, dataset: { p: 'pessoal' } }, baseScenario = { disabled: true, dataset: { cen: 'base.preco' } };
  class Element { constructor(public dataset: Record<string, string>) {} closest(selector: string) { return selector === '[data-go]' && this.dataset.go || selector === '[data-act]' && this.dataset.act ? this : null; } }
  runInNewContext(runtime, {
    document: { querySelector: node, querySelectorAll: (selector: string) => selector === '[data-p],[data-cen]' ? [field, baseScenario, currencyField] : selector === '[data-p]' ? [currencyField] : [], addEventListener: (name: string, fn: Function) => handlers.set(name, fn) },
    Element, window: { addEventListener() {}, scrollTo() {} }, location: { hash: '' }, history: { replaceState() {} },
    setTimeout, clearTimeout, structuredClone, URL, URLSearchParams, TextDecoder, AbortController, console,
    FileReader: class { result?: ArrayBuffer; onload?: () => void; readAsArrayBuffer(file: { buffer: ArrayBuffer }) { this.result=file.buffer;if(deferRead)pendingReads.push(()=>this.onload?.());else this.onload?.(); } },
    fetch: async (path: string, init?: {method?:string;body?:string}) => {
      const payload=init?.body?JSON.parse(init.body):undefined;requests.push({path,method:init?.method,payload});
      let data:unknown;
      if(path.endsWith('/usage')){const activeProjects=records.filter(r=>!r.archivedAt).length;data={activeProjects,projectLimit:2,userLimit:5,enabledUsers:1,canCreateProject:activeProjects<2};if(projects.deferUsage)await new Promise<void>(resolve=>pendingUsage.push(resolve));}
      else if(path.endsWith('/archive')){const target=records.find(r=>path.includes('/'+r.id+'/'))!;if(!payload.archived&&projects.restoreFails)return new Response(JSON.stringify({message:'Atingiu o limite de projectos activos.'}),{status:409,headers:{'content-type':'application/json'}});target.archivedAt=payload.archived?'2026-10-29T08:00:00Z':null;target.revision++;restored=!payload.archived;data=target;}
      else if(path.endsWith('/history')&&init?.method!=='PUT'&&(projects.historyFailsAfterRestore&&restored||projects.historyFailsOnRefresh&&modelReads>1))return new Response(JSON.stringify({message:'Histórico indisponível'}),{status:503,headers:{'content-type':'application/json'}});
      else if(path.includes('/exchange-rate?')){const q=new URLSearchParams(path.split('?')[1]);data={from:q.get('from'),to:q.get('to'),rate:q.get('from')==='Kz'?0.001:1000,rateDate:'2026-10-27',source:'Referência do teste',stale:false};}
      else if(path.endsWith('/convert-currency')){model.currency=payload.to;model.assumptions={...convertFinancialCurrency(model.assumptions as unknown as Record<string,unknown>,payload.from,payload.to,payload.rate),currencyConversion:payload} as any;model.revision++;data=model;}
      else if(path.endsWith('/history')&&init?.method==='PUT'){model.revision++;data={model,historical:{inputHash:'a'.repeat(64),updatedAt:'2026-10-28',analysis:analyzeFinancialHistory(payload.input)}};}
      else if(path.endsWith('/models')){modelReads++;data=records;}
      else data=path.endsWith('/templates')?allowedSectors.map(financialTemplate):path.endsWith('/history')?{revision:records.find(r=>path.includes('/'+r.id+'/'))?.revision??1,historical:withHistory?{inputHash:'a'.repeat(64),updatedAt:'2026-10-28',analysis:analyzeFinancialHistory(historyInput)}:null}:records;
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    },
  });
  // boot() termina depois das respostas JSON e da montagem inicial.
  await new Promise<void>(resolve => setImmediate(resolve));
  return { node, field, baseScenario, requests, model, records, pendingReads, pendingUsage, escape(){handlers.get('keydown')!({key:'Escape'});}, async select(id:string){node('#mSel').value=id;await node('#mSel').onchange();}, edit(id:string,value:string){node('#'+id).value=value;handlers.get('input')!({target:{id}});}, async currency(to:string){currencyField.value=to;await currencyField.onchange();},async act(act:string,extra:Record<string,string>={}){await handlers.get('click')!({target:new Element({act,...extra}),preventDefault(){}});}, async go(view: string) { await handlers.get('click')!({ target: new Element({ go: view }), preventDefault() {} }); return node('#view').innerHTML as string; }, async sub(k = 'pt', v = 'custos') { await handlers.get('click')!({ target: new Element({ act: 'sub', k, v }), preventDefault() {} }); return node('#view').innerHTML as string; } };
}
describe('runtime do protótipo ligado à API', () => {
  it('a gestão está no selector existente, mesmo sem projectos activos', async () => {
    const ui = await mount('servicos', true, false, false, false, historicalInput, FINANCIAL_SECTORS, { initialArchived: true });
    expect(ui.node('#mSel').disabled).toBe(false); expect(ui.node('#mSel').innerHTML).toContain('Gerir projectos…');
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' });
    expect(ui.node('#modal').innerHTML).toContain('Arquivados (1)'); expect(ui.node('#modal').innerHTML).toContain('Restaurar');
    await ui.act('viewProject', { id: 'm1' });
    expect(ui.node('#view').innerHTML).toContain('Projecto arquivado · consulta'); expect(ui.field.disabled).toBe(true); expect(ui.node('#ov').classList.contains('on')).toBe(false);
    expect(ui.node('#mSel').innerHTML).toContain('Arquivado ·');
  });
  it('arquivar pede confirmação, conserva a consulta e restaurar volta a permitir edição', async () => {
    const ui = await mount('servicos');
    await ui.select('__projects'); await ui.act('archiveProject', { id: 'm1' });
    expect(ui.node('#modal').innerHTML).toContain('Arquivar projecto'); expect(ui.requests.some(r => r.path.endsWith('/archive'))).toBe(false);
    await ui.act('confirmArchive');
    expect(ui.requests.find(r => r.path.endsWith('/archive'))!.payload).toEqual({ archived: true, revision: 1 });
    expect(ui.node('#view').innerHTML).toContain('Projecto arquivado · consulta'); expect(ui.field.disabled).toBe(true);
    await ui.act('restoreProject', { id: 'm1' });
    expect(ui.requests.filter(r => r.path.endsWith('/archive')).at(-1)!.payload).toEqual({ archived: false, revision: 2 });
    expect(ui.model.archivedAt).toBeNull(); expect(ui.node('#view').innerHTML).not.toContain('Projecto arquivado · consulta'); expect(ui.field.disabled).toBe(false); expect(ui.baseScenario.disabled).toBe(true);
  });
  it('o restauro recusado por quota mantém o arquivo e apresenta o motivo', async () => {
    const ui = await mount('servicos', true, false, false, false, historicalInput, FINANCIAL_SECTORS, { initialArchived: true, restoreFails: true });
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' }); await ui.act('restoreProject', { id: 'm1' });
    expect(ui.model.archivedAt).toBeTruthy(); expect(ui.node('#projectError').textContent).toContain('limite de projectos'); expect(ui.node('#modal').innerHTML).toContain('Activos (0)');
  });
  it('consulta pode abrir o arquivo e não recebe comandos de arquivo ou restauro', async () => {
    const ui = await mount('servicos', false, false, false, false, historicalInput, FINANCIAL_SECTORS, { initialArchived: true });
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' });
    expect(ui.node('#modal').innerHTML).not.toContain('data-act="restoreProject"');
    await ui.act('restoreProject', { id: 'm1' }); expect(ui.requests.some(r => r.path.endsWith('/archive'))).toBe(false);
    await ui.act('viewProject', { id: 'm1' }); expect(ui.field.disabled).toBe(true);
  });
  it('não arquiva nem substitui a lista com balancetes por analisar', async () => {
    const ui = await mount('servicos', true, false, true); await ui.go('analise'); ui.edit('anEmp', 'Em edição');
    await ui.select('__projects'); await ui.act('archiveProject', { id: 'm1' });
    expect(ui.node('#projectError').textContent).toContain('Analise e guarde'); expect(ui.requests.some(r => r.path.endsWith('/archive'))).toBe(false);
    const before = ui.requests.filter(r => r.path.endsWith('/models')).length;
    await ui.act('refreshProjects'); expect(ui.requests.filter(r => r.path.endsWith('/models'))).toHaveLength(before);
  });
  it('actualiza projectos de outra sessão e escapa os nomes na lista', async () => {
    const ui = await mount('servicos'); ui.records.push({ ...ui.model, id: 'm2', name: '<img src=x onerror=bad>' });
    await ui.select('__projects'); await ui.act('refreshProjects');
    expect(ui.node('#mSel').innerHTML).toContain('m2'); expect(ui.node('#modal').innerHTML).toContain('&lt;img'); expect(ui.node('#modal').innerHTML).not.toContain('<img src=x');
    await ui.act('viewProject', { id: 'm2' }); expect(ui.node('#mSel').value).toBe('m2');
  });
  it('fechar durante a consulta da quota não reabre a janela quando a resposta chega', async () => {
    const ui = await mount('servicos', true, false, false, false, historicalInput, FINANCIAL_SECTORS, { deferUsage: true });
    const opening = ui.select('__projects'); await new Promise<void>(resolve => setImmediate(resolve));
    expect(ui.node('#ov').classList.contains('on')).toBe(true); ui.escape();
    ui.pendingUsage.shift()!(); await opening; expect(ui.node('#ov').classList.contains('on')).toBe(false);
  });
  it('uma falha ao carregar balancetes não desfaz nem oculta um restauro confirmado', async () => {
    const ui = await mount('servicos', true, false, false, false, historicalInput, FINANCIAL_SECTORS, { initialArchived: true, historyFailsAfterRestore: true });
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' }); await ui.act('restoreProject', { id: 'm1' });
    expect(ui.model.archivedAt).toBeNull(); expect(ui.field.disabled).toBe(false); expect(ui.node('#view').innerHTML).toContain('Projecto restaurado. Não foi possível carregar'); expect(ui.node('#ov').classList.contains('on')).toBe(false);
  });
  it('uma falha de leitura na actualização não mostra os balancetes do projecto anterior no novo', async () => {
    const ui = await mount('servicos', true, false, true, false, historicalInput, FINANCIAL_SECTORS, { historyFailsOnRefresh: true });
    await ui.go('analise'); ui.records.splice(0,1,{...ui.model,id:'m2',name:'Outro projecto'});
    await ui.select('__projects'); await ui.act('refreshProjects');
    expect(ui.node('#mSel').value).toBe('m2'); expect(ui.node('#view').innerHTML).not.toContain(`value="${historicalInput.empresa}"`); expect(ui.node('#view').innerHTML).toContain('Histórico indisponível');
  });
  it('o selector de novos modelos mostra apenas os sectores licenciados, sem confundir sectores e projectos', async () => {
    const ui = await mount('mineracao', true, false, false, false, historicalInput, ['mineracao', 'servicos']);
    await ui.act('newM');
    const html = ui.node('#modal').innerHTML;
    expect(html.match(/name="nmS"/g)).toHaveLength(2);
    expect(html).toContain('value="mineracao"'); expect(html).toContain('value="servicos"'); expect(html).not.toContain('value="petroleo"');
    const corporate = await mount('mineracao', true, false, false, false, historicalInput, ['mineracao', 'servicos', 'comercio', 'agro']);
    await corporate.act('newM'); expect(corporate.node('#modal').innerHTML.match(/name="nmS"/g)).toHaveLength(4);
  });
  for (const sector of FINANCIAL_SECTORS) it(`renderiza sete vistas com o motor partilhado: ${sector}`, async () => {
    const ui = await mount(sector);
    expect(ui.node('#mSel').innerHTML).toContain('m1');
    for (const view of views) {
      const html = await ui.go(view); expect(html.length).toBeGreaterThan(100);
      expect(html, view).not.toContain('Pressupostos por rever'); expect(html, view).not.toMatch(/NaN|Infinity/);
    }
    expect(await ui.go('analise')).toContain('Balancete N (obrigatório)');
  });
  it('um rascunho incompleto permite abrir pressupostos sem inventar projecções', async () => {
    const ui = await mount('mineracao', true, true);
    expect(await ui.go('painel')).toContain('Pressupostos por rever');
    const form = await ui.go('pressupostos'); expect(form).toContain('Identificação e horizonte'); expect(form).toContain('Número inteiro');
  });
  it('repõe os campos editáveis depois de uma acção e conserva os campos originalmente bloqueados', async () => {
    const ui = await mount('mineracao'); await ui.go('pressupostos'); await ui.sub();
    expect(ui.field.disabled).toBe(false); expect(ui.baseScenario.disabled).toBe(true);
  });
  it('os campos de consulta ficam bloqueados mesmo depois de mudar de separador', async () => {
    const ui = await mount('mineracao', false); await ui.go('pressupostos'); await ui.sub(); expect(ui.field.disabled).toBe(true);
  });
  it('os cinco separadores históricos apresentam os cálculos partilhados sem NaN', async () => {
    const ui = await mount('comercio', true, false, true); await ui.go('analise');
    for (const tab of ['dados', 'balanco', 'dr', 'fc', 'racios']) {
      const html = await ui.sub('at', tab); expect(html.length).toBeGreaterThan(100); expect(html).not.toMatch(/NaN|Infinity|Pressupostos por rever/);
      if (tab === 'fc') { expect(html).toContain('reconciliação é algébrica'); expect(html).not.toContain('Dividendos / distribuições (implícitos)'); }
    }
  });
  it('a pré-visualização do relatório histórico funciona num projecto com projecção incompleta', async () => {
    const ui = await mount('comercio', true, true, true); await ui.sub('rep', 'analise');
    const html = await ui.go('relatorios'); expect(html).toContain('Empresa de teste'); expect(html).toContain('Relatório de análise económico-financeira'); expect(html).not.toContain('Pressupostos por rever');
  });
  it('os ficheiros de Excel em Windows-1252 conservam acentos e valores no formulário', async () => {
    const ui = await mount('comercio'); await ui.go('analise');
    const text = 'Conta;Designação;Saldo\n43;Depósito;100,25', bytes = Uint8Array.from([...text].map(c=>c.charCodeAt(0)));
    const file = { size: bytes.length, buffer: bytes.buffer }; ui.node('#anF2').files = [file]; ui.node('#anF2').onchange();
    expect(ui.node('#anT2').value).toBe(text);
  });
  it('alarga mapas extensos e os quadros de investimento, mantendo as outras vistas com a largura original', async () => {
    const ui=await mount('comercio');
    for(const view of ['demonstracoes','credito','sensibilidade','analise']){await ui.go(view);expect(ui.node('#view').dataset).toMatchObject({view,wide:'true'});}
    for(const view of ['painel','avaliacao','relatorios']){await ui.go(view);expect(ui.node('#view').dataset.wide).toBe('false');}
    await ui.go('pressupostos');await ui.sub('pt','capex');expect(ui.node('#view').dataset.wide).toBe('true');
    await ui.sub('pt','geral');expect(ui.node('#view').dataset.wide).toBe('false');
  });
  it('aceita PDF nos dois exercícios e apresenta o resultado da leitura sem guardar automaticamente', async () => {
    const ui=await mount('comercio');const html=await ui.go('analise');
    expect(html.match(/accept="\.csv,\.txt,\.pdf,text\/csv,text\/plain,application\/pdf"/g)).toHaveLength(2);
    expect(html).toContain('anStatus1');expect(html).toContain('anStatus2');expect(html).toContain('Confira as contas extraídas');
    const text='Conta;Designação;Saldo\n43;Banco;100,25',bytes=new TextEncoder().encode(text);
    ui.node('#anF2').files=[{name:'balancete.csv',size:bytes.length,buffer:bytes.buffer}];ui.node('#anF2').onchange();
    expect(ui.node('#anStatus2').textContent).toContain('prima Analisar');
    expect(ui.requests.filter(r=>r.method==='PUT'||r.method==='POST')).toHaveLength(0);
  });
  it('uma importação PDF demasiado grande conserva os dados anteriores sem alterar a base', async () => {
    const ui=await mount('comercio');await ui.go('analise');ui.node('#anT2').value='origem existente';
    ui.node('#anF2').files=[{name:'balancete.pdf',size:11*1024*1024}];ui.node('#anF2').onchange();
    expect(ui.node('#anStatus2').textContent).toContain('10 MB');expect(ui.node('#anT2').value).toBe('origem existente');
    expect(ui.requests.filter(r=>r.method==='PUT'||r.method==='POST')).toHaveLength(0);
    await ui.act('anRun');expect(ui.node('#view').innerHTML).toContain('10 MB');expect(ui.node('#view').innerHTML).not.toContain('250 000 caracteres');
  });
  it('uma edição manual permite corrigir a origem depois de uma falha de importação', async()=>{
    const ui=await mount('comercio');await ui.go('analise');ui.node('#anF2').files=[{name:'grande.pdf',size:11*1024*1024}];ui.node('#anF2').onchange();
    for(const [id,value]of Object.entries({anEmp:'Externa',anY1:'2024',anY2:'2025',anCP:'25',anMo:'Kz',anT1:'',anT2:historicalInput.N}))ui.edit(id,value);
    await ui.act('anRun');expect(ui.requests.filter(r=>r.method==='PUT')).toHaveLength(1);expect(ui.node('#view').innerHTML).not.toContain('10 MB');
  });
  it('mostra e conserva o período do documento externo ao analisar e guardar', async()=>{
    const input:FinancialHistoricalInput={...historicalInput,anos:['2025','2026'],periods:{N:{from:'2026-01-01',to:'2026-08-31'}}};
    const ui=await mount('comercio',true,false,true,false,input);await ui.go('analise');
    for(const[id,value]of Object.entries({anEmp:input.empresa,anY1:'2025',anY2:'31/08/2026',anCP:'25',anMo:'Kz',anT1:input.N1,anT2:input.N}))ui.edit(id,value);
    await ui.act('anRun');expect(ui.requests.find(r=>r.method==='PUT')?.payload.input.periods).toEqual(input.periods);
    expect(ui.node('#view').innerHTML).toContain('01/01/2026 a 31/08/2026');
  });
  it('um resultado apurado sem detalhe não apresenta zeros como EBITDA confirmado nem inventa fluxos', async()=>{
    const input={...historicalInput,N1:'',N:'Conta;Designação;Saldo\n43;Banco;100\n51;Capital;-120\n88;Resultado;20'};
    const ui=await mount('comercio',true,false,true,false,input);await ui.go('analise');const html=await ui.sub('at','dr');
    expect(html).toContain('detalhe suficiente');expect(html).not.toContain('Pressupostos por rever');
    const ebitda=html.split('<td>EBITDA</td>')[1]!.split('</tr>')[0]!;expect(ebitda).toContain('—');
    expect(await ui.sub('at','fc')).toContain('balancete de abertura coerente');
    await ui.sub('rep','analise');expect(await ui.go('relatorios')).not.toMatch(/NaN|Pressupostos por rever/);
  });
  it('compara datas do mesmo ano nos campos existentes e guarda os metadados correctos',async()=>{
    const ui=await mount('comercio');const form=await ui.go('analise');expect(form).toContain('Referência do comparativo');expect(form).toContain('2026 ou 31/08/2026');
    for(const[id,value]of Object.entries({anEmp:'Externa',anY1:'31/07/2026',anY2:'31/08/2026',anCP:'25',anMo:'Kz',anT1:historicalInput.N1,anT2:historicalInput.N}))ui.edit(id,value);
    await ui.act('anRun');const input=ui.requests.find(r=>r.method==='PUT')?.payload.input;
    expect(input.anos).toEqual(['2026','2026']);expect(input.periods).toEqual({N1:{from:'2026-01-01',to:'2026-07-31'},N:{from:'2026-01-01',to:'2026-08-31'}});expect(ui.node('#view').innerHTML).toContain('31/08/2026');
  });
  it('um único balancete em N não exige preencher a referência do comparativo',async()=>{
    const ui=await mount('comercio');await ui.go('analise');
    for(const[id,value]of Object.entries({anEmp:'Externa',anY1:'',anY2:'31/08/2026',anCP:'25',anMo:'Kz',anT1:'',anT2:historicalInput.N}))ui.edit(id,value);
    await ui.act('anRun');expect(ui.requests.find(r=>r.method==='PUT')?.payload.input.anos).toEqual(['2025','2026']);
  });
  it('apenas um comparativo dá indicação de N, sem erro enganador sobre o ano anterior',async()=>{
    const ui=await mount('comercio');await ui.go('analise');
    for(const[id,value]of Object.entries({anEmp:'Externa',anY1:'31/08/2026',anY2:'2026',anCP:'25',anMo:'Kz',anT1:historicalInput.N,anT2:''}))ui.edit(id,value);
    await ui.act('anRun');expect(ui.node('#view').innerHTML).toContain('apenas o comparativo');expect(ui.node('#view').innerHTML).not.toContain('exercício imediatamente anterior');expect(ui.requests.filter(r=>r.method==='PUT')).toHaveLength(0);
  });
  it('datas iguais e referências inválidas não são guardadas',async()=>{
    const ui=await mount('comercio');await ui.go('analise');
    for(const[id,value]of Object.entries({anEmp:'Externa',anY1:'31/08/2026',anY2:'31/08/2026',anCP:'25',anMo:'Kz',anT1:historicalInput.N1,anT2:historicalInput.N}))ui.edit(id,value);
    await ui.act('anRun');expect(ui.node('#view').innerHTML).toContain('mesma data');
    ui.edit('anY2','31/02/2026');await ui.act('anRun');expect(ui.node('#view').innerHTML).toContain('Referência do período N inválida');expect(ui.requests.filter(r=>r.method==='PUT')).toHaveLength(0);
  });
  it('não substitui texto editado enquanto um ficheiro está a ser lido', async () => {
    const ui=await mount('comercio',true,false,false,true);await ui.go('analise');
    const bytes=new TextEncoder().encode('Conta;Designação;Saldo\n43;Banco;10,00');
    ui.node('#anF2').files=[{name:'balancete.csv',size:bytes.length,buffer:bytes.buffer}];ui.node('#anF2').onchange();
    ui.node('#anT2').value='Edição posterior';ui.pendingReads[0]!();
    expect(ui.node('#anT2').value).toBe('Edição posterior');expect(ui.node('#anStatus2').textContent).toContain('foi editado');
  });
  it('cancela uma leitura ao mudar de vista e não grava dados parciais', async () => {
    const ui=await mount('comercio',true,false,false,true);await ui.go('analise');
    const bytes=new TextEncoder().encode('Conta;Designação;Saldo\n43;Banco;10,00');
    ui.node('#anT2').value='Origem anterior';ui.node('#anF2').files=[{name:'balancete.csv',size:bytes.length,buffer:bytes.buffer}];ui.node('#anF2').onchange();
    await ui.go('demonstracoes');ui.pendingReads[0]!();
    expect(ui.node('#anT2').value).toBe('Origem anterior');expect(ui.requests.filter(r=>r.method==='PUT'||r.method==='POST')).toHaveLength(0);
  });
  it('a mudança para EUR converte os valores e apresenta EUR nos montantes e nas instruções', async () => {
    const ui=await mount('mineracao');await ui.go('pressupostos');const before=ui.model.assumptions.pessoal;
    await ui.currency('EUR');expect(ui.node('[data-p="moeda"]').value).toBe('USD');expect(ui.model.currency).toBe('USD');
    expect(ui.node('#modal').innerHTML).toContain('Moeda real dos valores actuais');
    await ui.act('applyCurrency');expect(ui.model.currency).toBe('EUR');expect(ui.model.assumptions.pessoal).toBe(before!*1000);
    expect(await ui.go('painel')).toContain('M EUR');const html=await ui.go('pressupostos');expect(html).toContain('EUR: inflação esperada nesta moeda');expect(html).toContain('Última conversão');
    expect(ui.requests.filter(r=>r.path.endsWith('/convert-currency'))).toHaveLength(1);
  });
  it('cancelar a mudança de moeda mantém valores, moeda e revisão sem gravar', async () => {
    const ui=await mount('mineracao');await ui.go('pressupostos');const before=structuredClone(ui.model);
    await ui.currency('Kz');await ui.act('close');expect(ui.model).toEqual(before);expect(ui.requests.filter(r=>r.method==='POST'||r.method==='PUT')).toEqual([]);
  });
  for(const currency of ['USD','EUR'])it(`${currency}: investimento, DRE, Balanço, fluxos, avaliação e sete relatórios usam a moeda global`,async()=>{
    const ui=await mount('comercio');await ui.go('pressupostos');await ui.currency(currency);await ui.act('applyCurrency');
    const result=runFinancialModel(ui.model.assumptions);
    const caption=`Moeda global: ${currency}`,money=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2});
    for(const tab of ['geral','receitas','custos','capex','fm','fin','taxa']){
      const html=await ui.sub('pt',tab);expect(html,tab).toContain(caption);
      if(tab==='capex'){
        expect(html).toContain(`Valor (${currency})`);
        const table=html.match(/<table>[\s\S]*?<\/table>/)![0],capex=(ui.model.assumptions as FinancialAssumptions).capex;
        const total=capex.reduce((s,c)=>s+c.valor,0),amort=capex[0]!.valor/capex[0]!.vida;
        expect(table).toContain(money.format(total)+' '+currency);expect(table).toContain(money.format(amort)+' '+currency);
        expect(table).not.toMatch(new RegExp(`(?:M|mil) ${currency}`));
      }
      if(tab==='fin')expect(html).toContain('Financiamento em '+currency);
    }
    await ui.go('demonstracoes');
    for(const [tab,label,amount] of [['dr','Resultado operacional (82)',result.k.ebit[1]],['bal','Total do activo',result.k.assets[1]],['fc','Caixa no fim do ano',result.k.cash[1]]]as const){
      const html=await ui.sub('dt',tab);expect(html).toContain(caption);expect(html).toContain(currency+' · milhões');
      const row=html.split(`<td>${label}</td>`)[1]!.split('</tr>')[0]!;
      const value=money.format(Math.abs(amount!)/1e6);expect(row).toContain(amount!<0?'('+value+')':value);
    }
    for(const view of ['painel','avaliacao','credito','sensibilidade']){const html=await ui.go(view);expect(html,view).toContain(caption);expect(html,view).not.toMatch(/\b(?:M|mil) Kz\b/);}
    await ui.go('relatorios');for(const key of FINANCIAL_REPORT_KEYS){const html=await ui.sub('rep',key);expect(html,key).toContain(caption);expect(html,key).toContain(currency+' · cenário');expect(html,key).not.toMatch(/\b(?:M|mil) Kz\b/);}
  });
});
