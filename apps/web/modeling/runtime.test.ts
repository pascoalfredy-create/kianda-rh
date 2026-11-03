import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { convertFinancialCurrency, FINANCIAL_ENGINE_VERSION, FINANCIAL_REPORT_KEYS, FINANCIAL_SECTORS, financialTemplate, runFinancialModel, type FinancialAssumptions } from '@kianda/core';
const runtime = readFileSync(new URL('../public/modeling-runtime.js', import.meta.url), 'utf8');
const views = ['painel', 'pressupostos', 'demonstracoes', 'avaliacao', 'credito', 'sensibilidade', 'relatorios'];
/** Teste do código distribuído e das vistas, sem simular um motor de layout de navegador. */
async function mount(sector: typeof FINANCIAL_SECTORS[number], canWrite = true, incomplete = false, withHistory = false, deferRead = false, _unused:unknown=null, allowedSectors: readonly typeof FINANCIAL_SECTORS[number][] = FINANCIAL_SECTORS, projects: { canExport?: boolean; bootstrap?: boolean; initialArchived?: boolean; restoreFails?: boolean; deferUsage?: boolean; historyFailsAfterRestore?: boolean; historyFailsOnRefresh?: boolean; logoutFails?: boolean; deferLogout?: boolean; bootFails?: boolean; role?: string; respond?: (path: string, method: string | undefined, payload: any) => unknown } = {}) {
  const template = financialTemplate(sector), handlers = new Map<string, Function>();
  const nodes = new Map<string, any>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) { const classes = new Set<string>(), attributes = new Map<string,string>(); nodes.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style:{}, querySelectorAll: () => [], setAttribute(k:string,v:string){attributes.set(k,v);},getAttribute(k:string){return attributes.get(k);},focus(){this.focused=true;}, classList: { add(v: string) { classes.add(v); }, remove(v: string) { classes.delete(v); }, contains(v: string) { return classes.has(v); } }, insertAdjacentHTML(_position: string, html: string) { this.innerHTML = html + this.innerHTML; } }); }
    return nodes.get(selector)!;
  };
  const model = { id: 'm1', name: template.name, sector, currency: template.currency, revision: 1, createdAt: '2026-10-28', archivedAt: projects.initialArchived ? '2026-10-29T08:00:00Z' : null as string | null, assumptions: incomplete ? { pessoal: 1 } : template.assumptions };
  const records = [model], pendingUsage: (() => void)[] = [], pendingLogout: (() => void)[] = [];
  const redirects: string[] = [], windowHandlers = new Map<string, Function>();
  node('#integra-session').textContent = JSON.stringify({ user: { id: 'u1', name: 'Dona Integra', role: projects.role ?? 'finance' }, canWrite, permission: canWrite ? 'editor' : 'viewer', formats: { pdf: projects.canExport !== false, xlsx: false, csv: false }, usage: {}, ...(projects.bootstrap ? { bootstrap: { models: records, templates: allowedSectors.map(financialTemplate) } } : {}) });
  let restored=false,modelReads=0;
  const requests: { path: string; method?: string; payload?: any }[] = [];
  const pendingReads: (()=>void)[]=[];
  const currencyField=node('[data-p="moeda"]');currencyField.dataset={p:'moeda',t:'t'};currencyField.value=model.currency;
  node('#fxFrom').value=model.currency;
  const field = { disabled: false, dataset: { p: 'pessoal' } }, baseScenario = { disabled: true, dataset: { cen: 'base.preco' } };
  node('#integra-logout').dataset={act:'logout'};
  class Element { constructor(public dataset: Record<string, string>) {} closest(selector: string) { return selector === '[data-go]' && this.dataset.go || selector === '[data-act]' && this.dataset.act ? this : null; } }
  runInNewContext(runtime, {
    document: { querySelector: node, querySelectorAll: (selector: string) => selector === '[data-p],[data-cen]' ? [field, baseScenario, currencyField] : selector === '[data-p]' ? [currencyField] : selector==='button,select' ? [node('#integra-logout'),node('#mSel')] : /^\[data-act="download(?:FS|Report)"\]$/.test(selector) ? [node(selector)] : [], addEventListener: (name: string, fn: Function) => handlers.set(name, fn) },
    Element, window: { addEventListener(name:string,fn:Function) { windowHandlers.set(name,fn); }, removeEventListener() {}, scrollTo() {}, location: { replace(path:string){redirects.push(path);},reload(){} } }, location: { hash: '' }, history: { replaceState() {} },
    setTimeout, clearTimeout, structuredClone, URL, URLSearchParams, TextDecoder, AbortController, AbortSignal, console,
    FileReader: class { result?: ArrayBuffer; onload?: () => void; readAsArrayBuffer(file: { buffer: ArrayBuffer }) { this.result=file.buffer;if(deferRead)pendingReads.push(()=>this.onload?.());else this.onload?.(); } },
    fetch: async (path: string, init?: {method?:string;body?:string}) => {
      const payload=init?.body?JSON.parse(init.body):undefined;requests.push({path,method:init?.method,payload});
      let data:unknown;
      const custom=projects.respond?.(path,init?.method,payload);if(custom!==undefined)return new Response(JSON.stringify(custom),{headers:{'content-type':'application/json'}});
      if(path.endsWith('/auth/logout')){if(projects.deferLogout)await new Promise<void>(resolve=>pendingLogout.push(resolve));if(projects.logoutFails)return new Response(JSON.stringify({message:'Fim de sessão indisponível'}),{status:503,headers:{'content-type':'application/json'}});data={ok:true};}
      else if(path.endsWith('/usage')){const activeProjects=records.filter(r=>!r.archivedAt).length;data={activeProjects,projectLimit:2,userLimit:5,enabledUsers:1,canCreateProject:activeProjects<2};if(projects.deferUsage)await new Promise<void>(resolve=>pendingUsage.push(resolve));}
      else if(path.endsWith('/archive')){const target=records.find(r=>path.includes('/'+r.id+'/'))!;if(!payload.archived&&projects.restoreFails)return new Response(JSON.stringify({message:'Atingiu o limite de projectos activos.'}),{status:409,headers:{'content-type':'application/json'}});target.archivedAt=payload.archived?'2026-10-29T08:00:00Z':null;target.revision++;restored=!payload.archived;data=target;}
      else if(path.includes('/exchange-rate?')){const q=new URLSearchParams(path.split('?')[1]);data={from:q.get('from'),to:q.get('to'),rate:q.get('from')==='Kz'?0.001:1000,rateDate:'2026-10-27',source:'Referência do teste',stale:false};}
      else if(path.endsWith('/convert-currency')){model.currency=payload.to;model.assumptions={...convertFinancialCurrency(model.assumptions as unknown as Record<string,unknown>,payload.from,payload.to,payload.rate),currencyConversion:payload} as any;model.revision++;data=model;}
      else if(path.endsWith('/models')){if(projects.bootFails)return new Response(JSON.stringify({message:'Projectos indisponíveis'}),{status:503,headers:{'content-type':'application/json'}});modelReads++;data=records;}
      else data=path.endsWith('/templates')?allowedSectors.map(financialTemplate):records;
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    },
  });
  // boot() termina depois das respostas JSON e da montagem inicial.
  await new Promise<void>(resolve => setImmediate(resolve));
  return { node, field, baseScenario, requests, model, records, pendingReads, pendingUsage, pendingLogout, redirects, beforeUnload(){let blocked=false;windowHandlers.get('beforeunload')!({preventDefault(){blocked=true;}});return blocked;}, escape(){handlers.get('keydown')!({key:'Escape'});}, async select(id:string){node('#mSel').value=id;await node('#mSel').onchange();}, edit(id:string,value:string){node('#'+id).value=value;handlers.get('input')!({target:{id}});}, async currency(to:string){currencyField.value=to;await currencyField.onchange();},async act(act:string,extra:Record<string,string>={}){await handlers.get('click')!({target:new Element({act,...extra}),preventDefault(){}});}, async go(view: string) { await handlers.get('click')!({ target: new Element({ go: view }), preventDefault() {} }); return node('#view').innerHTML as string; }, async sub(k = 'pt', v = 'custos') { await handlers.get('click')!({ target: new Element({ act: 'sub', k, v }), preventDefault() {} }); return node('#view').innerHTML as string; } };
}
describe('runtime do protótipo ligado à API', () => {
  it('o teste mantém os relatórios visíveis mas bloqueia o download, mesmo por acção directa', async () => {
    const ui = await mount('servicos',true,false,false,false,null,FINANCIAL_SECTORS,{canExport:false});
    await ui.go('relatorios');
    expect(ui.node('#view').innerHTML).toContain('Sumário');
    expect(ui.node('[data-act="downloadReport"]').disabled).toBe(true);
    await ui.act('downloadReport');
    expect(ui.requests.some(r=>r.path.includes('/reports/'))).toBe(false);
    expect(ui.node('#view').innerHTML).toContain('pré-visualizar');
    await ui.go('demonstracoes');
    expect(ui.node('[data-act="downloadFS"]').disabled).toBe(true);
  });
  it('consegue terminar sessão mesmo quando os projectos não carregaram', async () => {
    const ui = await mount('servicos',true,false,false,false,null,FINANCIAL_SECTORS,{bootFails:true});
    expect(ui.node('#view').innerHTML).toContain('Projectos indisponíveis');
    expect(ui.node('#integra-logout').disabled).toBe(false); await ui.act('logout'); expect(ui.redirects).toEqual(['/']);
  });
  it('um utilizador de consulta também pode terminar sessão e os dados desaparecem antes de regressar à página pública', async () => {
    const ui = await mount('servicos', false); await ui.act('logout');
    expect(ui.requests.filter(r=>r.path.endsWith('/auth/logout'))).toHaveLength(1);
    expect(ui.node('#integra-session').textContent).toBe(''); expect(ui.node('#nav').innerHTML).toBe('');
    expect(ui.node('#view').innerHTML).toContain('Sessão terminada'); expect(ui.redirects).toEqual(['/']);
    expect(ui.beforeUnload()).toBe(false);
  });
  it('uma falha no logout conserva a sessão e a possibilidade de tentar de novo', async () => {
    const options = { logoutFails: true };
    const ui = await mount('servicos',true,false,false,false,null,FINANCIAL_SECTORS,options);
    await ui.act('logout');
    expect(ui.node('#integra-session-status').textContent).toContain('Fim de sessão indisponível');
    expect(ui.node('#integra-session').textContent).not.toBe(''); expect(ui.redirects).toEqual([]);
    options.logoutFails=false; await ui.act('logout'); expect(ui.redirects).toEqual(['/']);
  });
  it('dois cliques enquanto o logout aguarda resposta enviam apenas um pedido', async () => {
    const ui = await mount('servicos',true,false,false,false,null,FINANCIAL_SECTORS,{deferLogout:true});
    const first = ui.act('logout'); await new Promise<void>(resolve=>setImmediate(resolve));
    await ui.act('logout'); expect(ui.requests.filter(r=>r.path.endsWith('/auth/logout'))).toHaveLength(1);
    ui.pendingLogout.shift()!(); await first; expect(ui.redirects).toEqual(['/']);
  });
  it('o menu móvel fecha pelo botão, por Escape ou ao escolher um ecrã, sem deixar o conteúdo bloqueado', async () => {
    const ui = await mount('servicos');
    await ui.act('toggleMenu');
    expect(ui.node('.app').classList.contains('menu-open')).toBe(true);
    expect(ui.node('.main').inert).toBe(true);
    expect(ui.node('#integra-menu-toggle').getAttribute('aria-expanded')).toBe('true');
    ui.escape();
    expect(ui.node('.main').inert).toBe(false);
    expect(ui.node('#integra-menu-toggle').focused).toBe(true);
    await ui.act('toggleMenu'); await ui.go('demonstracoes');
    expect(ui.node('.app').classList.contains('menu-open')).toBe(false);
    expect(ui.node('.main').inert).toBe(false);
    await ui.act('toggleMenu'); await ui.act('closeMenu');
    expect(ui.node('#integra-menu-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(ui.requests.some(r=>r.method&&r.method!=='GET')).toBe(false);
  });
  it('abre com os dados autenticados iniciais sem repetir modelos nem templates', async () => {
    const ui = await mount('servicos', true, false, true, false, null, FINANCIAL_SECTORS, { bootstrap: true });
    expect(ui.node('#view').innerHTML).toContain('Perspectiva do investidor');
    expect(ui.requests).toHaveLength(0);
    await ui.go('analise');
    expect(ui.node('#view').innerHTML).toContain('Rácios por ano');
    expect(ui.requests).toHaveLength(0);
  });
  it('recolhe um grupo sem recalcular a vista ou alterar os pressupostos', async () => {
    const ui = await mount('servicos');
    const view = ui.node('#view').innerHTML, requestCount = ui.requests.length;
    expect(ui.node('#nav').innerHTML).toContain('aria-controls="integra-nav-1"');
    await ui.act('navToggle', { group: '1' });
    expect(ui.node('#nav').innerHTML).toContain('id="integra-nav-1">');
    expect(ui.node('#nav').innerHTML).toContain('id="integra-nav-0" hidden');
    expect(ui.node('#view').innerHTML).toBe(view);
    expect(ui.requests).toHaveLength(requestCount);
    await ui.act('navToggle', { group: '1' });
    expect(ui.node('#nav').innerHTML).toContain('id="integra-nav-1" hidden');
  });
  it('a gestão está no selector existente, mesmo sem projectos activos', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { initialArchived: true });
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
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { initialArchived: true, restoreFails: true });
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' }); await ui.act('restoreProject', { id: 'm1' });
    expect(ui.model.archivedAt).toBeTruthy(); expect(ui.node('#projectError').textContent).toContain('limite de projectos'); expect(ui.node('#modal').innerHTML).toContain('Activos (0)');
  });
  it('consulta pode abrir o arquivo e não recebe comandos de arquivo ou restauro', async () => {
    const ui = await mount('servicos', false, false, false, false, null, FINANCIAL_SECTORS, { initialArchived: true });
    await ui.select('__projects'); await ui.act('projectTab', { v: 'archived' });
    expect(ui.node('#modal').innerHTML).not.toContain('data-act="restoreProject"');
    await ui.act('restoreProject', { id: 'm1' }); expect(ui.requests.some(r => r.path.endsWith('/archive'))).toBe(false);
    await ui.act('viewProject', { id: 'm1' }); expect(ui.field.disabled).toBe(true);
  });
  it('actualiza projectos de outra sessão e escapa os nomes na lista', async () => {
    const ui = await mount('servicos'); ui.records.push({ ...ui.model, id: 'm2', name: '<img src=x onerror=bad>' });
    await ui.select('__projects'); await ui.act('refreshProjects');
    expect(ui.node('#mSel').innerHTML).toContain('m2'); expect(ui.node('#modal').innerHTML).toContain('&lt;img'); expect(ui.node('#modal').innerHTML).not.toContain('<img src=x');
    await ui.act('viewProject', { id: 'm2' }); expect(ui.node('#mSel').value).toBe('m2');
  });
  it('fechar durante a consulta da quota não reabre a janela quando a resposta chega', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { deferUsage: true });
    const opening = ui.select('__projects'); await new Promise<void>(resolve => setImmediate(resolve));
    expect(ui.node('#ov').classList.contains('on')).toBe(true); ui.escape();
    ui.pendingUsage.shift()!(); await opening; expect(ui.node('#ov').classList.contains('on')).toBe(false);
  });
  it('o selector de novos modelos mostra apenas os sectores licenciados, sem confundir sectores e projectos', async () => {
    const ui = await mount('mineracao', true, false, false, false, null, ['mineracao', 'servicos']);
    await ui.act('newM');
    const html = ui.node('#modal').innerHTML;
    expect(html.match(/name="nmS"/g)).toHaveLength(2);
    expect(html).toContain('value="mineracao"'); expect(html).toContain('value="servicos"'); expect(html).not.toContain('value="petroleo"');
    const corporate = await mount('mineracao', true, false, false, false, null, ['mineracao', 'servicos', 'comercio', 'agro']);
    await corporate.act('newM'); expect(corporate.node('#modal').innerHTML.match(/name="nmS"/g)).toHaveLength(4);
  });
  for (const sector of FINANCIAL_SECTORS) it(`renderiza sete vistas com o motor partilhado: ${sector}`, async () => {
    const ui = await mount(sector);
    expect(ui.node('#mSel').innerHTML).toContain('m1');
    for (const view of views) {
      const html = await ui.go(view); expect(html.length).toBeGreaterThan(100);
      expect(html, view).not.toContain('Pressupostos por rever'); expect(html, view).not.toMatch(/NaN|Infinity/);
    }
    const analysis = await ui.go('analise');
    expect(analysis).toContain('Rácios por ano'); expect(analysis).not.toMatch(/NaN|Infinity|[Bb]alancete|type="file"/);
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
  it('a análise de demonstrações usa só o projecto: anos do horizonte, rácios e diagnóstico, sem importar documentos', async () => {
    const ui = await mount('comercio'); const html = await ui.go('analise');
    const result = runFinancialModel(ui.model.assumptions as FinancialAssumptions);
    for (const year of result.years.slice(1)) expect(html).toContain(`<th class="num">${year}</th>`);
    for (const text of ['Liquidez geral', 'Autonomia financeira', 'Margem EBITDA', 'Ciclo de conversão de caixa', 'Diagnóstico', 'Demonstração de resultados (síntese)', 'Balanço (síntese)', 'Fluxos de caixa (síntese)']) expect(html).toContain(text);
    expect(html).not.toMatch(/NaN|Infinity|[Bb]alancete|type="file"|anRun|Exemplo \(distribuidora\)/);
    expect(ui.node('#nav').innerHTML).not.toContain('Histórico');
    expect(ui.requests.some(r => r.path.includes('/history'))).toBe(false);
  });
  it('o relatório de análise é preenchido com o projecto e segue o cenário escolhido', async () => {
    const ui = await mount('comercio'); await ui.go('relatorios'); const html = await ui.sub('rep', 'analise');
    expect(html).toContain('Relatório de análise económico-financeira'); expect(html).toContain(ui.model.name.replace(/&/g,'&amp;'));
    expect(html).toContain('Rácios'); expect(html).toContain('Diagnóstico'); expect(html).not.toMatch(/NaN|Infinity|[Bb]alancete|Empresa analisada/);
  });
  it('alarga mapas extensos e os quadros de investimento, mantendo as outras vistas com a largura original', async () => {
    const ui=await mount('comercio');
    for(const view of ['demonstracoes','credito','sensibilidade','analise']){await ui.go(view);expect(ui.node('#view').dataset).toMatchObject({view,wide:'true'});}
    for(const view of ['painel','avaliacao','relatorios']){await ui.go(view);expect(ui.node('#view').dataset.wide).toBe('false');}
    await ui.go('pressupostos');await ui.sub('pt','capex');expect(ui.node('#view').dataset.wide).toBe('true');
    await ui.sub('pt','geral');expect(ui.node('#view').dataset.wide).toBe('false');
  });
  it('a mudança para EUR converte os valores e apresenta EUR nos montantes e nas instruções', async () => {
    const ui=await mount('mineracao');await ui.go('pressupostos');const before=ui.model.assumptions.pessoal;
    await ui.currency('EUR');expect(ui.node('[data-p="moeda"]').value).toBe('USD');expect(ui.model.currency).toBe('USD');
    expect(ui.node('#modal').innerHTML).toContain('Moeda real dos valores actuais');
    await ui.act('applyCurrency');expect(ui.model.currency).toBe('EUR');expect(ui.model.assumptions.pessoal).toBe(before!*1000);
    {const p=await ui.go('painel');expect(p).toContain('valores em EUR');expect(p).not.toMatch(/\b(?:M|mil) EUR\b/);}const html=await ui.go('pressupostos');expect(html).toContain('EUR: inflação esperada nesta moeda');expect(html).toContain('Última conversão');
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
      const html=await ui.sub('dt',tab);expect(html).toContain(caption);expect(html).toContain(' · '+currency+' · Moeda global');expect(html).not.toContain(currency+' · milhões');
      const row=html.split(`<td>${label}</td>`)[1]!.split('</tr>')[0]!;
      const value=money.format(Math.abs(amount!));expect(row).toContain(amount!<0?'('+value+')':value);
    }
    for(const view of ['painel','avaliacao','credito','sensibilidade']){const html=await ui.go(view);expect(html,view).toContain(caption);expect(html,view).not.toMatch(/\b(?:M|mil) Kz\b/);}
    await ui.go('relatorios');for(const key of FINANCIAL_REPORT_KEYS){const html=await ui.sub('rep',key);expect(html,key).toContain(caption);expect(html,key).toContain(currency+' · cenário');expect(html,key).not.toMatch(/\b(?:M|mil) Kz\b/);}
  });
});

describe('controlos do Integra na interface aprovada', () => {
  const tpl = financialTemplate('servicos');
  const approved = (npv = runFinancialModel(tpl.assumptions as unknown as FinancialAssumptions).npv) => ({ id: 'v1', versionNumber: 1, label: 'Comité de investimento', sourceRevision: 1, approvedAt: '2026-11-01T10:00:00Z', approvedByName: 'Dona Integra', engineVersion: FINANCIAL_ENGINE_VERSION,
    payload: { inputAssumptions: tpl.assumptions, source: { projectName: 'Projecto aprovado', sector: 'servicos', currency: 'Kz' }, result: { engineVersion: FINANCIAL_ENGINE_VERSION, npv, scenario: 'base' } } });
  const versionsApi = (npv?: number) => (path: string, method?: string, payload?: any) => {
    if (path.endsWith('/models/m1/versions') && method === 'POST') return { id: 'v2', versionNumber: 2, label: payload.label, sourceRevision: payload.revision, approvedAt: '2026-11-01T11:00:00Z', approvedByName: 'Dona Integra' };
    if (path.endsWith('/models/m1/versions')) return [approved(npv)];
    if (path.endsWith('/versions/v1')) return approved(npv);
    if (path.includes('/reports?version=')) return { reports: [{ key: 'analise', available: false }] };
    return undefined;
  };
  it('o proprietário aprova a revisão actual com destino; outros perfis só consultam', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { role: 'owner', respond: versionsApi() });
    await ui.act('versions');
    const html = ui.node('#modal').innerHTML as string;
    expect(html).toContain('Aprovar a revisão actual (r1)'); expect(html).toContain('Comité de investimento'); expect(html).toContain('v1');
    ui.node('#versionLabel').value = '';
    await ui.act('approveVersion');
    expect(ui.requests.some(r => r.method === 'POST' && r.path.endsWith('/versions'))).toBe(false);
    ui.node('#versionLabel').value = 'Proposta ao banco';
    await ui.act('approveVersion');
    expect(ui.requests.find(r => r.method === 'POST' && r.path.endsWith('/models/m1/versions'))?.payload).toEqual({ revision: 1, label: 'Proposta ao banco' });
    const other = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { role: 'finance', respond: versionsApi() });
    await other.act('versions');
    expect(other.node('#modal').innerHTML).toContain('reservada ao proprietário'); expect(other.node('#modal').innerHTML).not.toContain('data-act="approveVersion"');
  });
  it('consultar uma versão bloqueia a edição, confirma o cálculo e descarrega o documento aprovado', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { role: 'owner', respond: versionsApi() });
    await ui.act('versions'); await ui.act('openVersion', { id: 'v1' });
    expect(ui.node('#view').innerHTML).toContain('Versão aprovada v1 · Comité de investimento');
    expect(ui.node('#view').innerHTML).toContain('reproduzem o cálculo aprovado');
    expect(ui.field.disabled).toBe(true);
    await ui.act('addRev'); await new Promise(r => setTimeout(r, 700));
    expect(ui.requests.some(r => r.method === 'PUT')).toBe(false);
    await ui.act('downloadReport');
    expect(ui.requests.some(r => r.path.includes('/reports/sumario?') && r.path.includes('version=v1'))).toBe(true);
    await ui.act('leaveVersion');
    expect(ui.node('#view').innerHTML).not.toContain('Versão aprovada v1');
    expect(ui.field.disabled).toBe(false);
  });
  it('avisa quando o ecrã não reproduz o valor aprovado', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { role: 'owner', respond: versionsApi(123) });
    await ui.act('versions'); await ui.act('openVersion', { id: 'v1' });
    expect(ui.node('#view').innerHTML).toContain('difere do aprovado');
  });
  const hrApi = (pessoal = 5000) => (path: string, method?: string, payload?: any) => {
    if (path.endsWith('/personnel-sources')) return { hr: { active: true }, budgets: [{ id: 'b1', year: 2027, approvedAt: '2026-10-30', totalMinor: 500000 }], windows: [{ from: '2025-01', to: '2025-12' }], closedPeriods: 12, lastClosed: '2025-12' };
    if (path.endsWith('/import-personnel')) return { model: { id: 'm1', name: 'Projecto', sector: payload.exchangeRate ? 'mineracao' : 'servicos', currency: payload.exchangeRate ? 'USD' : 'Kz', revision: 2, createdAt: '2026-10-28', archivedAt: null, assumptions: { ...(payload.exchangeRate ? financialTemplate('mineracao') : tpl).assumptions, pessoal } }, import: { id: 'i1', source: payload.source, fromPeriod: '2027-01', toPeriod: '2027-12', importedAt: '2026-11-01T12:00:00Z', snapshot: { currency: 'Kz', exchangeRate: 1, totalMinor: 500000, annualPersonnel: pessoal, months: [] } } };
    if (path.endsWith('/models/m1') && (!method || method === 'GET')) return { id: 'm1', imports: [] };
    return undefined;
  };
  it('importa do orçamento aprovado com origem explícita e actualiza o projecto', async () => {
    const ui = await mount('servicos', true, false, false, false, null, FINANCIAL_SECTORS, { respond: hrApi() });
    await ui.go('pressupostos'); await ui.sub('pt', 'custos');
    await ui.act('hrImport');
    const html = ui.node('#modal').innerHTML as string;
    expect(html).toContain('Importar custos com pessoal do RH'); expect(html).toContain('2027 · 5'); expect(html).toContain('01/2025 a 12/2025');
    ui.node('[name=hrSource]:checked').value = 'budget'; ui.node('#hrBudget').value = 'b1';
    await ui.act('hrImportApply');
    expect(ui.requests.find(r => r.path.endsWith('/import-personnel'))?.payload).toEqual({ source: 'budget', budgetId: 'b1', revision: 1 });
    expect(ui.model.revision).toBe(1); // o simulador não muda o registo; a interface usa a resposta do servidor
    expect(ui.node('#view').innerHTML).toContain('5000');
  });
  it('em moeda estrangeira exige o câmbio antes de importar', async () => {
    const ui = await mount('mineracao', true, false, false, false, null, FINANCIAL_SECTORS, { respond: hrApi(9.5) });
    await ui.go('pressupostos'); await ui.sub('pt', 'custos');
    await ui.act('hrImport');
    expect(ui.node('#modal').innerHTML).toContain('Câmbio: USD por 1 Kz');
    ui.node('[name=hrSource]:checked').value = 'actual'; ui.node('#hrWindow').value = '2025-01|2025-12'; ui.node('#hrRate').value = '';
    await ui.act('hrImportApply');
    expect(ui.requests.some(r => r.path.endsWith('/import-personnel'))).toBe(false);
    ui.node('#hrRate').value = '0.001';
    await ui.act('hrImportApply');
    expect(ui.requests.find(r => r.path.endsWith('/import-personnel'))?.payload).toEqual({ source: 'actual', from: '2025-01', to: '2025-12', exchangeRate: 0.001, revision: 1 });
  });
  it('quem só consulta não vê a importação', async () => {
    const ui = await mount('servicos', false, false, false, false, null, FINANCIAL_SECTORS, { respond: hrApi() });
    await ui.go('pressupostos'); await ui.sub('pt', 'custos');
    await ui.act('hrImport');
    expect(ui.requests.some(r => r.path.endsWith('/personnel-sources'))).toBe(false);
  });
});
