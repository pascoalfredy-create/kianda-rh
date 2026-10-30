import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertFinancialCurrency, financialTemplate } from '@kianda/core';
import { ModelingApiError, ModelingStore, type ModelRecord, type ModelingTransport, type UiModel } from './store';
import { historicalInput } from '../../../packages/core/test/fixtures/financial-history.js';
const record = (id = 'm1', revision = 1): ModelRecord => ({ id, name: 'Projecto mineiro', sector: 'mineracao', currency: 'USD', assumptions: financialTemplate('mineracao').assumptions as unknown as Record<string, unknown>, revision, createdAt: '2026-10-28T00:00:00Z', archivedAt: null });
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('persistência da interface Integra', () => {
  it('o logout cancela gravações agendadas e não inicia outras depois de fechar a sessão', async () => {
    vi.useFakeTimers(); const request = vi.fn(), store = new ModelingStore(true, request);
    store.load([record()]); const m = store.models[0]!; m.pessoal = 999; store.change(m);
    store.stopAutosave(); await vi.advanceTimersByTimeAsync(1000); await store.flush();
    m.pessoal = 1000; store.change(m); await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
  });
  it('uma gravação já enviada não encadeia a edição seguinte depois do logout', async () => {
    let finish!: (value: ModelRecord) => void;
    const request = vi.fn(() => new Promise<ModelRecord>(resolve=>{finish=resolve;})) as unknown as ModelingTransport;
    const store = new ModelingStore(true,request); store.load([record()]); const m=store.models[0]!;
    m.pessoal=100; store.change(m); const pending=store.flush(); await settle();
    m.pessoal=200; store.change(m); store.stopAutosave(); finish({...record(),revision:2}); await pending;
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('não cria exemplos nem grava ao carregar projectos existentes', async () => {
    const request = vi.fn(), store = new ModelingStore(true, request);
    store.load([]); expect(store.models).toEqual([]);
    store.load([record(), { ...record('arquivo'), archivedAt: '2026-10-28' }]);
    expect(store.models).toHaveLength(1); await store.flush(); expect(request).not.toHaveBeenCalled();
  });
  it('agrupa alterações rápidas e separa identificação dos pressupostos', async () => {
    vi.useFakeTimers(); const request = vi.fn(async (_p, _m, body) => ({ ...record(), ...body, revision: 2 })) as unknown as ModelingTransport;
    const store = new ModelingStore(true, request); store.load([record()]); const m = store.models[0]!;
    for (const cost of [100, 200, 300]) { m.pessoal = cost; store.change(m); }
    expect(store.dirty).toBe(true); await store.flush();
    expect(request).toHaveBeenCalledTimes(1); const payload = vi.mocked(request).mock.calls[0]![2] as any;
    expect(payload).toMatchObject({ name: m.nome, sector: 'mineracao', currency: 'USD', revision: 1, assumptions: { pessoal: 300 } });
    for (const key of ['id', 'nome', 'sector', 'moeda', 'criado']) expect(payload.assumptions).not.toHaveProperty(key);
    expect(store.revision(m.id)).toBe(2); expect(store.dirty).toBe(false);
  });
  it('preserva uma edição feita enquanto a gravação anterior estava em curso', async () => {
    let finish!: (value: ModelRecord) => void;
    const calls: { revision: number; assumptions: { pessoal: number } }[] = [];
    const request: ModelingTransport = <T>(_p: string, _m?: string, body?: any) => {
      calls.push(body); return (calls.length === 1 ? new Promise<ModelRecord>(r => { finish = r; }) : Promise.resolve({ ...record(), revision: 3 })) as Promise<T>;
    };
    const store = new ModelingStore(true, request); store.load([record()]); const m = store.models[0]!;
    m.pessoal = 100; store.change(m); const first = store.flush(); await settle();
    m.pessoal = 200; store.change(m); const second = store.flush(); finish({ ...record(), revision: 2 });
    await Promise.all([first, second]); expect(calls.map(p => [p.revision, p.assumptions.pessoal])).toEqual([[1, 100], [2, 200]]);
    expect(m.pessoal).toBe(200); expect(store.revision(m.id)).toBe(3); expect(store.dirty).toBe(false);
  });
  it('bloqueia novas tentativas após conflito sem perder os dados por guardar', async () => {
    const request = vi.fn().mockRejectedValue(new ModelingApiError(409, 'Outra revisão')), error = vi.fn();
    const store = new ModelingStore(true, request, error); store.load([record()]); const m = store.models[0]!;
    m.pessoal = 99; store.change(m); await expect(store.flush()).rejects.toThrow('Outra revisão');
    m.pessoal = 123; store.change(m); await expect(store.flush()).rejects.toThrow('Outra revisão');
    expect(m.pessoal).toBe(123); expect(store.dirty).toBe(true); expect(request).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledTimes(1);
    await expect(store.create({ ...m, nome: 'Cópia' })).rejects.toThrow('Outra revisão');
    expect(store.models).toHaveLength(1);
  });
  it('uma falha de rede não é tratada como gravação concluída', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Sem rede')), store = new ModelingStore(true, request); store.load([record()]);
    const m = store.models[0]!; m.nome = 'Nome em memória'; store.change(m);
    await expect(store.flush()).rejects.toThrow('Sem rede'); expect(store.dirty).toBe(true); expect(store.revision(m.id)).toBe(1);
    expect(() => store.load([record()])).toThrow('por guardar');
  });
  it('consulta permite cenário temporário mas não grava nem duplica projectos', async () => {
    const request = vi.fn(), store = new ModelingStore(false, request); store.load([record()]);
    const m = store.models[0]!; m.cen = 'pess'; store.change(m); await store.flush();
    expect(request).not.toHaveBeenCalled(); expect(store.dirty).toBe(false); await expect(store.create(m)).rejects.toThrow('consulta');
  });
  it('criação recusada por quota não deixa projectos fictícios na interface', async () => {
    const request = vi.fn().mockRejectedValue(new ModelingApiError(409, 'Limite de projectos')), store = new ModelingStore(true, request); store.load([record()]);
    await expect(store.create({ ...store.models[0]!, nome: 'Duplicado' })).rejects.toThrow('Limite de projectos'); expect(store.models).toHaveLength(1);
  });
  it('espera pela gravação e inclui revisão/cenário no download PDF', async () => {
    const request = vi.fn(async () => ({ ...record(), revision: 2 })) as unknown as ModelingTransport;
    const fetchFile = vi.fn().mockResolvedValue(new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })); vi.stubGlobal('fetch', fetchFile);
    const store = new ModelingStore(true, request); store.load([record()]); const m = store.models[0]!; m.cen = 'pess'; store.change(m);
    await store.download(m, 'sumario');
    expect(fetchFile.mock.calls[0]![0]).toBe('/api/v1/modeling/models/m1/reports/sumario?format=pdf&revision=2&scenario=pess');
    await store.download(m, 'sumario', 'approved-id'); expect(fetchFile.mock.calls[1]![0]).toContain('format=pdf&version=approved-id'); expect(fetchFile.mock.calls[1]![0]).not.toContain('scenario');
  });
  it('não apresenta dados de exemplo no lugar de pressupostos ausentes ou inválidos', () => {
    const store = new ModelingStore(true); store.load([{ ...record(), assumptions: { pessoal: '"><script>alert(1)</script>', capex: [{ nome: 'Obra', valor: '<img onerror=x>' }] } }]);
    const m = store.models[0]!; expect(m.pessoal).toBeUndefined(); expect(m.capex[0].valor).toBeUndefined(); expect(m.receitas).toEqual([]); expect(m.wacc).toEqual({}); expect(m.horizonte).toBeUndefined();
  });
  it('a importação histórica espera pelas edições e avança a revisão usada na gravação seguinte', async () => {
    const historical = { inputHash: 'hash', analysis: { input: historicalInput } }, calls: any[] = [];
    const request: ModelingTransport = async <T>(path: string, method?: string, payload?: any) => {
      calls.push({ path, method, payload });
      return (path.endsWith('/history') ? { model: record('m1', 3), historical } : record('m1', payload.revision + 1)) as T;
    };
    const store = new ModelingStore(true, request); store.load([record()]); const m = store.models[0]!;
    m.pessoal = 100; store.change(m); await store.saveHistory(m.id, historicalInput);
    expect(calls.map(c => c.payload.revision)).toEqual([1, 2]); expect(store.revision(m.id)).toBe(3);
    m.pessoal = 200; store.change(m); await store.flush(); expect(calls.at(-1).payload.revision).toBe(3); expect(m.pessoal).toBe(200);
  });
  it('revisão histórica alterada por outro utilizador exige recarregar e nunca muda a revisão local', async () => {
    const store = new ModelingStore(true, vi.fn().mockResolvedValue({ revision: 2, historical: null })); store.load([record()]);
    await expect(store.history('m1')).rejects.toThrow('Projecto alterado'); expect(store.revision('m1')).toBe(1);
  });
  it('download histórico omite o cenário de projecção e consulta não pode importar', async () => {
    const fetchFile = vi.fn().mockResolvedValue(new Response('%PDF-1.7')); vi.stubGlobal('fetch', fetchFile);
    const request = vi.fn(), store = new ModelingStore(false, request); store.load([record()]);
    await store.download(store.models[0]!, 'analise'); expect(fetchFile.mock.calls[0]![0]).toBe('/api/v1/modeling/models/m1/reports/analise?format=pdf&revision=1');
    await expect(store.saveHistory('m1', historicalInput)).rejects.toThrow('consulta'); await expect(store.createFromHistory('m1')).rejects.toThrow('consulta'); expect(request).not.toHaveBeenCalled();
  });
  it('grava as edições antes de converter e substitui moeda e montantes pela resposta atómica', async () => {
    const calls:any[]=[],original=record(),input={from:'USD' as const,to:'Kz' as const,rate:900,rateDate:'2026-10-27',source:'Teste',reference:false};
    const request:ModelingTransport=async<T>(path:string,method?:string,payload?:any)=>{calls.push({path,method,payload});return(path.endsWith('/convert-currency')?{...original,currency:'Kz',revision:3,assumptions:convertFinancialCurrency({...original.assumptions,pessoal:100},'USD','Kz',900)}:{...original,...payload,revision:2})as T;};
    const store=new ModelingStore(true,request);store.load([original]);const m=store.models[0]!;m.pessoal=100;store.change(m);await store.convertCurrency(m.id,input);
    expect(calls.map(c=>c.payload.revision)).toEqual([1,2]);expect(m.moeda).toBe('Kz');expect(m.pessoal).toBe(90000);expect(store.revision(m.id)).toBe(3);expect(store.dirty).toBe(false);
  });
  it('uma conversão recusada não deixa a moeda ou os valores alterados só no browser', async () => {
    const request=vi.fn().mockRejectedValue(new ModelingApiError(409,'Revisão alterada')),store=new ModelingStore(true,request);store.load([record()]);const before=structuredClone(store.models[0]);
    await expect(store.convertCurrency('m1',{from:'USD',to:'EUR',rate:0.9,rateDate:'2026-10-27',source:'Teste',reference:false})).rejects.toThrow('Revisão alterada');expect(store.models[0]).toEqual(before);expect(store.revision('m1')).toBe(1);
  });
  it('duas conversões simultâneas não são enviadas sobre a mesma revisão', async () => {
    let finish!:(v:ModelRecord)=>void;const request=vi.fn(()=>new Promise<ModelRecord>(r=>{finish=r;}))as unknown as ModelingTransport;
    const store=new ModelingStore(true,request);store.load([record()]);const input={from:'USD' as const,to:'EUR' as const,rate:0.9,rateDate:'2026-10-27',source:'Teste',reference:false};
    const one=store.convertCurrency('m1',input);await settle();await expect(store.convertCurrency('m1',input)).rejects.toThrow('Aguarde');expect(store.dirty).toBe(true);
    finish({...record(),currency:'EUR',revision:2});await one;expect(request).toHaveBeenCalledTimes(1);expect(store.dirty).toBe(false);
  });
  it('arquiva só depois de guardar edições e conserva o projecto para consulta', async () => {
    const calls: any[] = [];
    const request: ModelingTransport = async <T>(path: string, method?: string, payload?: any) => {
      calls.push({ path, method, payload });
      return (path.endsWith('/archive') ? { ...record('m1', 3), archivedAt: '2026-10-29T08:00:00Z', assumptions: { ...record().assumptions, pessoal: 321 } } : { ...record('m1', 2), assumptions: payload.assumptions }) as T;
    };
    const store = new ModelingStore(true, request); store.load([record()]);
    const model = store.models[0]!; model.pessoal = 321; store.change(model);
    const archived = await store.setArchived('m1', true);
    expect(calls.map(c => c.path)).toEqual(['/models/m1', '/models/m1/archive']);
    expect(calls[1].payload).toEqual({ archived: true, revision: 2 });
    expect(store.models).toHaveLength(0); expect(store.archivedModels).toEqual([archived]); expect(archived.pessoal).toBe(321);
    expect(store.revision('m1')).toBe(3); expect(store.canEdit('m1')).toBe(false); expect(store.dirty).toBe(false);
    archived.pessoal = 999; store.change(archived); await store.flush(); expect(calls).toHaveLength(2);
  });
  it('um arquivo recusado conserva o modelo activo e a revisão local', async () => {
    const request = vi.fn().mockRejectedValue(new ModelingApiError(409, 'Projecto alterado')), store = new ModelingStore(true, request); store.load([record()]);
    await expect(store.setArchived('m1', true)).rejects.toThrow('Projecto alterado');
    expect(store.models).toHaveLength(1); expect(store.archivedModels).toHaveLength(0); expect(store.revision('m1')).toBe(1); expect(store.canEdit('m1')).toBe(true); expect(store.dirty).toBe(false);
  });
  it('não arquiva quando a gravação anterior falhou', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Sem rede')), store = new ModelingStore(true, request); store.load([record()]);
    store.models[0]!.pessoal = 123; store.change(store.models[0]!);
    await expect(store.setArchived('m1', true)).rejects.toThrow('Sem rede');
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0]![0]).toBe('/models/m1'); expect(store.models).toHaveLength(1); expect(store.dirty).toBe(true);
  });
  it('o restauro recusado por quota não cria um projecto activo fictício', async () => {
    const request = vi.fn().mockRejectedValue(new ModelingApiError(409, 'Limite de projectos')), store = new ModelingStore(true, request);
    store.load([{ ...record('m1', 4), archivedAt: '2026-10-29T08:00:00Z' }]);
    await expect(store.setArchived('m1', false)).rejects.toThrow('Limite de projectos');
    expect(store.models).toHaveLength(0); expect(store.archivedModels).toHaveLength(1); expect(store.revision('m1')).toBe(4); expect(store.dirty).toBe(false);
  });
  it('restaura com a revisão arquivada e volta a permitir gravações', async () => {
    const request = vi.fn().mockResolvedValue(record('m1', 5)), store = new ModelingStore(true, request);
    store.load([{ ...record('m1', 4), archivedAt: '2026-10-29T08:00:00Z' }]);
    const restored = await store.setArchived('m1', false);
    expect(request).toHaveBeenCalledWith('/models/m1/archive', 'POST', { archived: false, revision: 4 });
    expect(store.models).toEqual([restored]); expect(store.archivedModels).toHaveLength(0); expect(store.revision('m1')).toBe(5); expect(store.canEdit('m1')).toBe(true);
  });
  it('arquivados permitem histórico e PDF, mas recusam importações e conversão', async () => {
    const request = vi.fn().mockResolvedValue({ revision: 4, historical: null }), store = new ModelingStore(true, request);
    store.load([{ ...record('m1', 4), archivedAt: '2026-10-29T08:00:00Z' }]);
    expect(await store.history('m1')).toBeNull();
    await expect(store.saveHistory('m1', historicalInput)).rejects.toThrow('arquivado');
    await expect(store.createFromHistory('m1')).rejects.toThrow('arquivado');
    await expect(store.convertCurrency('m1', { from: 'USD', to: 'Kz', rate: 900, rateDate: '2026-10-29', source: 'Teste', reference: false })).rejects.toThrow('arquivado');
    const fetchFile = vi.fn().mockResolvedValue(new Response('%PDF-1.7')); vi.stubGlobal('fetch', fetchFile);
    await store.download(store.archivedModels[0]!, 'sumario'); expect(fetchFile.mock.calls[0]![0]).toContain('format=pdf&revision=4'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('consulta não arquiva nem restaura', async () => {
    const request = vi.fn(), store = new ModelingStore(false, request); store.load([record(), { ...record('m2'), archivedAt: '2026-10-29T08:00:00Z' }]);
    await expect(store.setArchived('m1', true)).rejects.toThrow('consulta'); await expect(store.setArchived('m2', false)).rejects.toThrow('consulta'); expect(request).not.toHaveBeenCalled();
  });
  it('dois cliques não enviam o mesmo arquivo e a moeda não muda durante a operação', async () => {
    let finish!: (v: ModelRecord) => void;
    const request = vi.fn(() => new Promise<ModelRecord>(r => { finish = r; })) as unknown as ModelingTransport;
    const store = new ModelingStore(true, request); store.load([record()]);
    const first = store.setArchived('m1', true); await settle();
    await expect(store.setArchived('m1', true)).rejects.toThrow('Aguarde');
    await expect(store.convertCurrency('m1', { from: 'USD', to: 'EUR', rate: .9, rateDate: '2026-10-29', source: 'Teste', reference: false })).rejects.toThrow('Aguarde');
    expect(() => store.load([])).toThrow('por guardar');
    finish({ ...record('m1', 2), archivedAt: '2026-10-29T08:00:00Z' }); await first;
    expect(request).toHaveBeenCalledTimes(1); expect(store.dirty).toBe(false);
  });
});
