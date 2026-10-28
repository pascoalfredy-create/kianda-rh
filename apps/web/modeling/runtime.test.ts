import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { analyzeFinancialHistory, convertFinancialCurrency, FINANCIAL_REPORT_KEYS, FINANCIAL_SECTORS, financialTemplate, runFinancialModel, type FinancialAssumptions } from '@kianda/core';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
const runtime = readFileSync(new URL('../public/modeling-runtime.js', import.meta.url), 'utf8');
const views = ['painel', 'pressupostos', 'demonstracoes', 'avaliacao', 'credito', 'sensibilidade', 'relatorios'];
/** Teste do código distribuído e das vistas, sem simular um motor de layout de navegador. */
async function mount(sector: typeof FINANCIAL_SECTORS[number], canWrite = true, incomplete = false, withHistory = false) {
  const template = financialTemplate(sector), handlers = new Map<string, Function>();
  const nodes = new Map<string, any>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style:{}, classList: { add() {}, remove() {} }, insertAdjacentHTML(_position: string, html: string) { this.innerHTML = html + this.innerHTML; } });
    return nodes.get(selector)!;
  };
  node('#integra-session').textContent = JSON.stringify({ canWrite, permission: canWrite ? 'editor' : 'viewer', formats: { pdf: true, xlsx: false, csv: false }, usage: {} });
  const model = { id: 'm1', name: template.name, sector, currency: template.currency, revision: 1, createdAt: '2026-10-28', archivedAt: null, assumptions: incomplete ? { pessoal: 1 } : template.assumptions };
  const requests: { path: string; method?: string; payload?: any }[] = [];
  const currencyField=node('[data-p="moeda"]');currencyField.dataset={p:'moeda',t:'t'};currencyField.value=model.currency;
  node('#fxFrom').value=model.currency;
  const field = { disabled: false, dataset: { p: 'pessoal' } }, baseScenario = { disabled: true, dataset: { cen: 'base.preco' } };
  class Element { constructor(public dataset: Record<string, string>) {} closest(selector: string) { return selector === '[data-go]' && this.dataset.go || selector === '[data-act]' && this.dataset.act ? this : null; } }
  runInNewContext(runtime, {
    document: { querySelector: node, querySelectorAll: (selector: string) => selector === '[data-p],[data-cen]' ? [field, baseScenario, currencyField] : selector === '[data-p]' ? [currencyField] : [], addEventListener: (name: string, fn: Function) => handlers.set(name, fn) },
    Element, window: { addEventListener() {}, scrollTo() {} }, location: { hash: '' }, history: { replaceState() {} },
    setTimeout, clearTimeout, structuredClone, URL, URLSearchParams, TextDecoder, console,
    FileReader: class { result?: ArrayBuffer; onload?: () => void; readAsArrayBuffer(file: { buffer: ArrayBuffer }) { this.result=file.buffer; this.onload?.(); } },
    fetch: async (path: string, init?: {method?:string;body?:string}) => {
      const payload=init?.body?JSON.parse(init.body):undefined;requests.push({path,method:init?.method,payload});
      let data:unknown;
      if(path.includes('/exchange-rate?')){const q=new URLSearchParams(path.split('?')[1]);data={from:q.get('from'),to:q.get('to'),rate:q.get('from')==='Kz'?0.001:1000,rateDate:'2026-10-27',source:'Referência do teste',stale:false};}
      else if(path.endsWith('/convert-currency')){model.currency=payload.to;model.assumptions={...convertFinancialCurrency(model.assumptions as unknown as Record<string,unknown>,payload.from,payload.to,payload.rate),currencyConversion:payload} as any;model.revision++;data=model;}
      else data=path.endsWith('/templates')?FINANCIAL_SECTORS.map(financialTemplate):path.endsWith('/history')?{revision:1,historical:withHistory?{inputHash:'a'.repeat(64),updatedAt:'2026-10-28',analysis:analyzeFinancialHistory(historicalInput)}:null}:[model];
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    },
  });
  // boot() termina depois das respostas JSON e da montagem inicial.
  await new Promise<void>(resolve => setImmediate(resolve));
  return { node, field, baseScenario, requests, model, async currency(to:string){currencyField.value=to;await currencyField.onchange();},async act(act:string){await handlers.get('click')!({target:new Element({act}),preventDefault(){}});}, async go(view: string) { await handlers.get('click')!({ target: new Element({ go: view }), preventDefault() {} }); return node('#view').innerHTML as string; }, async sub(k = 'pt', v = 'custos') { await handlers.get('click')!({ target: new Element({ act: 'sub', k, v }), preventDefault() {} }); return node('#view').innerHTML as string; } };
}
describe('runtime do protótipo ligado à API', () => {
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
