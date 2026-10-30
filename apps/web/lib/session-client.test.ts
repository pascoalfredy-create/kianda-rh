import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineData, endSession, reloadPrivatePageOnRestore } from './session-client';

afterEach(() => vi.unstubAllGlobals());
function browser() {
  const order: string[] = [], listeners = new Map<string, Function>();
  const replace = vi.fn(() => { order.push('redirect'); }), reload = vi.fn();
  const removeItem = vi.fn(), dropCache = vi.fn().mockImplementation(async () => { order.push('clear-cache'); });
  const postMessage = vi.fn(), after = vi.fn(() => { order.push('clear-screen'); });
  const fetch = vi.fn(async () => { order.push('server'); return new Response(JSON.stringify({ ok: true })); });
  vi.stubGlobal('window', { location: { replace, reload }, caches: {}, addEventListener: (name:string,fn:Function) => listeners.set(name,fn), removeEventListener: (name:string) => listeners.delete(name) });
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('caches', { delete: dropCache });
  vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } });
  vi.stubGlobal('localStorage', { removeItem });
  return { order, replace, reload, after, fetch, removeItem, dropCache, postMessage, listeners };
}
describe('logout partilhado pelo RH e Integra', () => {
  it('pede o fim da sessão antes de limpar o ecrã/cache e regressar à apresentação pública', async () => {
    const ui = browser(); await endSession(ui.after);
    expect(ui.fetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' }));
    expect(ui.order).toEqual(['server', 'clear-screen', 'clear-cache', 'redirect']);
    expect(ui.dropCache).toHaveBeenCalledWith('kianda-pages-v1');
    expect(ui.postMessage).toHaveBeenCalledWith('clear-pages'); expect(ui.removeItem).toHaveBeenCalledWith('kianda_me_cache');
    expect(ui.replace).toHaveBeenCalledWith('/');
  });
  it('uma falha do servidor conserva a conta e os dados para permitir nova tentativa', async () => {
    const ui = browser(); ui.fetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Serviço indisponível' }), { status: 503 }));
    await expect(endSession(ui.after)).rejects.toThrow('Serviço indisponível');
    expect(ui.after).not.toHaveBeenCalled(); expect(ui.dropCache).not.toHaveBeenCalled(); expect(ui.replace).not.toHaveBeenCalled();
  });
  it('uma falha de rede não se apresenta como logout concluído', async () => {
    const ui = browser(); ui.fetch.mockRejectedValue(new Error('Sem rede'));
    await expect(endSession(ui.after)).rejects.toThrow('Verifique a ligação'); expect(ui.replace).not.toHaveBeenCalled();
  });
  it('uma resposta 200 sem confirmação da API não limpa a sessão local', async () => {
    const ui = browser(); ui.fetch.mockResolvedValue(new Response('<html>Erro do proxy</html>'));
    await expect(endSession(ui.after)).rejects.toThrow('não confirmou'); expect(ui.after).not.toHaveBeenCalled();
  });
  it('uma sessão já expirada pode sair e limpar os dados locais', async () => {
    const ui = browser(); ui.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await endSession(ui.after); expect(ui.replace).toHaveBeenCalledWith('/'); expect(ui.dropCache).toHaveBeenCalledTimes(1);
  });
  it('erros de armazenamento ou limpeza do ecrã não bloqueiam uma sessão terminada no servidor', async () => {
    const ui = browser(); ui.dropCache.mockRejectedValue(new Error('Sem armazenamento')); ui.after.mockImplementation(() => { throw Error('Ecrã em transição'); });
    await endSession(ui.after); expect(ui.replace).toHaveBeenCalledWith('/');
    await expect(clearOfflineData()).resolves.toBeUndefined();
  });
  it('o botão Voltar força a autorização no servidor quando restaura um ecrã privado', () => {
    const ui = browser(), stop = reloadPrivatePageOnRestore();
    ui.listeners.get('pageshow')!({ persisted: false }); expect(ui.reload).not.toHaveBeenCalled();
    ui.listeners.get('pageshow')!({ persisted: true }); expect(ui.reload).toHaveBeenCalledTimes(1);
    stop(); expect(ui.listeners.has('pageshow')).toBe(false);
    const stopPublic = reloadPrivatePageOnRestore(() => false);
    ui.listeners.get('pageshow')!({ persisted: true }); expect(ui.reload).toHaveBeenCalledTimes(1); stopPublic();
  });
});
