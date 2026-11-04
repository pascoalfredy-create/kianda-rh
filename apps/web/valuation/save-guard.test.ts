import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./adapter.js', import.meta.url), 'utf8');
const saveCode = source.slice(source.indexOf('async function flushSave(){'), source.indexOf("addEventListener('beforeunload'"));
const openCode = source.slice(source.indexOf('async function openAnalysis('), source.indexOf('function showEmpty('));

function harness(error?: Record<string, unknown>, issue: string | null = null) {
  const calls: string[] = [], loaded: unknown[] = [];
  const ctx = {
    calls, loaded, JSON, encodeURIComponent,
    clearTimeout() {}, setTimeout() { return 1; },
    valuationDataIssue: () => issue,
    valoraCanWrite: () => true,
    setSave() {}, lockInputs() {}, banner() {}, closeDialog() {}, ESC: String,
    async api(path: string, opt?: { method?: string }) {
      calls.push(`${opt?.method ?? 'GET'} ${path}`);
      if (opt?.method === 'PUT' && error) throw error;
      return { id: 'b', revision: 2, updatedAt: '2026-11-04' };
    },
    loadAnalysis(row: unknown) { loaded.push(row); },
  };
  runInNewContext(`let CUR={id:'a',revision:1},D={orc:{vendas:42}},LIST=[],VS={canWrite:true};
    let pendingSave=true,saving=null,conflict=false,offline=false,saveTimer=null;
    ${saveCode}\n${openCode}\nthis.openAnalysis=openAnalysis;this.ensureSaved=ensureSaved;this.pending=()=>pendingSave;`, ctx);
  return ctx as typeof ctx & { openAnalysis(id: string): Promise<void>; ensureSaved(): Promise<void>; pending(): boolean };
}

describe('Valora conserva o rascunho quando não o consegue gravar', () => {
  for (const [name, error] of [
    ['sem rede', { offline: true, message: 'Sem ligação' }],
    ['conflito', { status: 409, code: 'revisao_invalida', message: 'Conflito' }],
    ['licença expirada', { status: 402, message: 'Em consulta' }],
  ] as const) {
    it(`não abre outra análise ${name}`, async () => {
      const h = harness(error);
      await h.openAnalysis('b');
      expect(h.calls).toEqual(['PUT /analyses/a']); expect(h.loaded).toEqual([]); expect(h.pending()).toBe(true);
    });
  }
  it('mantém o aviso de dados por gravar quando a validação falha', async () => {
    const h = harness(undefined, 'Dados inválidos');
    await expect(h.ensureSaved()).rejects.toThrow('alterações por gravar');
    expect(h.pending()).toBe(true); expect(h.calls).toEqual([]);
  });
  it('depois de gravar abre a análise escolhida', async () => {
    const h = harness();
    await h.openAnalysis('b');
    expect(h.calls).toEqual(['PUT /analyses/a', 'GET /analyses/b']); expect(h.loaded).toHaveLength(1);
  });
});

describe('Valora confirma a licença actual em cada exportação', () => {
  const code = source.slice(source.indexOf('async function valoraCanExport('), source.indexOf('function valoraApplyAutoTable('));
  for (const allowed of [true, false]) {
    it(allowed ? 'reconhece a subscrição paga sem depender do estado antigo' : 'recusa uma licença entretanto suspensa', async () => {
      const msg = { textContent: '' };
      const ctx = { ensureSaved: async () => {}, api: async () => ({ formats: { pdf: allowed }, canWrite: allowed }), lockInputs() {}, $: () => msg };
      runInNewContext(`const VS={formats:{pdf:${!allowed}}};${code};this.check=valoraCanExport;`, ctx);
      expect(await (ctx as typeof ctx & { check(kind: string): Promise<boolean> }).check('pdf')).toBe(allowed);
      if (!allowed) expect(msg.textContent).toContain('Pré-visualização');
    });
  }
  it('a falha de gravação ou de acesso impede gerar o ficheiro', async () => {
    const msg = { textContent: '' };
    const ctx = { ensureSaved: async () => { throw new Error('Alterações por gravar'); }, api: async () => { throw new Error('Não deve consultar'); }, lockInputs() {}, $: () => msg };
    runInNewContext(`const VS={};${code};this.check=valoraCanExport;`, ctx);
    expect(await (ctx as typeof ctx & { check(kind: string): Promise<boolean> }).check('pdf')).toBe(false);
    expect(msg.textContent).toBe('Alterações por gravar');
  });
});
