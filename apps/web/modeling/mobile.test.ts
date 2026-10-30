import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareFinancialTables, setupModelingMobile } from './mobile';

afterEach(() => vi.unstubAllGlobals());
function mobile(ios = false, standalone = false) {
  const listeners = new Map<string, (e?: any) => void>();
  const button = { hidden: true, disabled: false, addEventListener: (name: string, fn: any) => listeners.set(`button:${name}`, fn) };
  const status = { hidden: true, textContent: '' };
  const register = vi.fn().mockResolvedValue({});
  const nav = { onLine: true, userAgent: ios ? 'iPhone Safari' : 'Android Chrome', serviceWorker: { register } };
  const media = { matches: standalone, addEventListener: (name: string, fn: any) => listeners.set(`media:${name}`, fn) };
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('window', { matchMedia: () => media, addEventListener: (name: string, fn: any) => listeners.set(name, fn) });
  vi.stubGlobal('document', { querySelector: (selector: string) => selector === '#integra-install' ? button : status });
  const instructions = vi.fn(); setupModelingMobile(instructions);
  return { button, status, register, nav, media, instructions, listeners };
}
describe('Integra no telefone', () => {
  it('usa o SW comum e só oferece instalação Android quando o navegador a disponibiliza', async () => {
    const ui = mobile(); expect(ui.button.hidden).toBe(true);
    expect(ui.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    const event = { preventDefault: vi.fn(), prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) };
    ui.listeners.get('beforeinstallprompt')!(event); expect(ui.button.hidden).toBe(false);
    expect(event.prompt).not.toHaveBeenCalled();
    await ui.listeners.get('button:click')!();
    expect(event.prompt).toHaveBeenCalledTimes(1); expect(ui.button.hidden).toBe(true); expect(ui.button.disabled).toBe(false);
  });
  it('mostra instruções para Safari e oculta a instalação quando já está no ecrã inicial', async () => {
    const ui = mobile(true); expect(ui.button.hidden).toBe(false);
    await ui.listeners.get('button:click')!(); expect(ui.instructions).toHaveBeenCalledTimes(1);
    ui.media.matches = true; ui.listeners.get('media:change')!(); expect(ui.button.hidden).toBe(true);
  });
  it('explica a necessidade de rede sem prometer gravações offline nem perder os dados do ecrã', () => {
    const ui = mobile(); ui.nav.onLine = false; ui.listeners.get('offline')!();
    expect(ui.status.hidden).toBe(false); expect(ui.status.textContent).toContain('guardar alterações');
    ui.nav.onLine = true; ui.listeners.get('online')!();
    expect(ui.status.hidden).toBe(true); expect(ui.status.textContent).toBe('');
  });
  it('uma instalação recusada ou falhada permite continuar a usar o Integra', async () => {
    const ui = mobile();
    ui.listeners.get('beforeinstallprompt')!({ preventDefault() {}, prompt: vi.fn().mockRejectedValue(new Error('Indisponível')) });
    await ui.listeners.get('button:click')!();
    expect(ui.button.disabled).toBe(false); expect(ui.status.textContent).toContain('menu do navegador');
  });
  it('envolve tabelas de relatórios e torna todos os mapas acessíveis pelo teclado sem duplicar contentores', () => {
    const createWrapper = () => ({ className: '', tabIndex: -1, attrs: {} as Record<string,string>, setAttribute(k:string,v:string){this.attrs[k]=v;}, append(table:any){table.wrapper=this;} });
    const existing = createWrapper();
    const bare = { wrapper: null as any, closest(){return this.wrapper;}, before:vi.fn() };
    const wrapped = { wrapper:existing, closest(){return this.wrapper;},before:vi.fn() };
    const createElement = vi.fn(createWrapper);
    vi.stubGlobal('document', { createElement });
    const root = { querySelectorAll: () => [bare, wrapped] } as unknown as HTMLElement;
    prepareFinancialTables(root); prepareFinancialTables(root);
    expect(createElement).toHaveBeenCalledTimes(1); expect(bare.before).toHaveBeenCalledTimes(1);
    expect(wrapped.before).not.toHaveBeenCalled(); expect(bare.wrapper.className).toBe('tblwrap');
    for (const wrapper of [existing, bare.wrapper]) {
      expect(wrapper.tabIndex).toBe(0); expect(wrapper.attrs.role).toBe('region'); expect(wrapper.attrs['aria-label']).toContain('todas as colunas');
    }
  });
});
