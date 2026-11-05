import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearWorkspaceMemory, compatibleDraft, WORKSPACE_KEY, WorkspaceMemory } from './workspace-memory';
import { contextualHref } from './navigation-context';

afterEach(() => { clearWorkspaceMemory(); vi.unstubAllGlobals(); });
function browser() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage: storage }); vi.stubGlobal('sessionStorage', storage);
  return { values, storage };
}
describe('contexto de trabalho por sessão', () => {
  it('recupera a preparação, sem misturar meses, empresas ou utilizadores', () => {
    browser(); const first = new WorkspaceMemory('a:u');
    first.set('payroll:2026-09:preparation:open', true); first.set('payroll:2026-09:preparation:selected', ['p1']);
    const returned = new WorkspaceMemory('a:u');
    expect(returned.get('payroll:2026-09:preparation:open')).toBe(true);
    expect(returned.get('payroll:2026-09:preparation:selected')).toEqual(['p1']);
    expect(returned.get('payroll:2026-10:preparation:open')).toBeUndefined();
    expect(new WorkspaceMemory('b:u').get('payroll:2026-09:preparation:open')).toBeUndefined();
    first.set('simulator:target', '123');
    expect(new WorkspaceMemory('a:v').get('simulator:target')).toBeUndefined();
  });
  it('cancelar um rascunho limpa apenas esse fluxo', () => {
    browser(); const memory = new WorkspaceMemory('a:u');
    memory.set('payroll:09:variables:amount', '5000'); memory.set('payroll:10:open', true);
    memory.clear('payroll:09:');
    expect(new WorkspaceMemory('a:u').get('payroll:09:variables:amount')).toBeUndefined();
    expect(memory.get('payroll:10:open')).toBe(true);
  });
  it('o logout impede que pagehide volte a gravar o contexto privado', () => {
    const { values } = browser(); const memory = new WorkspaceMemory('a:u'); memory.set('open', true);
    clearWorkspaceMemory(); memory.set('scroll', 800);
    expect(values.has(WORKSPACE_KEY)).toBe(false); expect(memory.get('open')).toBeUndefined();
  });
  it('ignora contexto expirado, JSON danificado e tipos incompatíveis', () => {
    const { storage } = browser();
    storage.setItem(WORKSPACE_KEY, JSON.stringify({ scope: 'a:u', expires: 1, values: { open: true } }));
    expect(new WorkspaceMemory('a:u').get('open')).toBeUndefined();
    storage.setItem(WORKSPACE_KEY, 'danificado');
    expect(new WorkspaceMemory('a:u').get('open')).toBeUndefined();
    expect(compatibleDraft('true', false)).toBe(false);
    expect(compatibleDraft({ amount: 100 }, { amount: '' })).toBe(false);
    expect(compatibleDraft({ amount: '100' }, { amount: '' })).toBe(true);
  });
  it('continua em memória quando o armazenamento está bloqueado', () => {
    browser(); const memory = new WorkspaceMemory('a:u', () => { throw Error('bloqueado'); });
    memory.set('open', true); expect(memory.get('open')).toBe(true);
  });
});
describe('origem das ligações de trabalho', () => {
  it('mantém o mês, separador e filtros ao abrir uma ficha e ao mudar de separador', () => {
    const origin = '/processamento?mes=2026-09&s=folha';
    const profile = contextualHref('/colaboradores/p1?s=contrato', origin);
    expect(new URL(profile, 'https://test').searchParams.get('voltar')).toBe(origin);
    const tab = contextualHref('?s=dados', profile);
    expect(new URL(tab, 'https://test').searchParams.get('voltar')).toBe(origin);
  });
  it('conserva a vista financeira e respeita ligações externas, âncoras e a API', () => {
    const target = contextualHref('/copiloto?modulo=modeling', '/modelagem#pressupostos');
    expect(new URL(target, 'https://test').searchParams.get('voltar')).toBe('/modelagem#pressupostos');
    for (const href of ['https://outro.test/', '//outro.test/', '#balanco', '/api/v1/report']) expect(contextualHref(href, '/processamento')).toBe(href);
  });
});
