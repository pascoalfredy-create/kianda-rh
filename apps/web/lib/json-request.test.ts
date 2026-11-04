import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonRequest } from './json-request';
import { returnPath } from './return-path';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('formulários disponíveis depois de uma falha de rede', () => {
  it('transforma uma rede indisponível numa resposta que o formulário consegue apresentar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { res, body } = await jsonRequest('/api/v1/auth/register', { method: 'POST' });
    expect(res.ok).toBe(false); expect(res.status).toBe(503); expect(body.message).toContain('Verifique a ligação');
  });
  it('um pedido sem resposta termina e liberta o formulário', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_path, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))));
    const pending = jsonRequest('/api/v1/auth/login', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).res.status).toBe(503);
  });
  it('uma página HTML de erro não é confundida com um login bem sucedido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>erro</html>', { status: 200 })));
    expect((await jsonRequest('/api/v1/auth/login')).res.ok).toBe(false);
  });
  it('preserva os erros de validação e as respostas correctas da API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'Campo obrigatório' }, { status: 400 })));
    expect((await jsonRequest('/api/v1/auth/register')).body.message).toBe('Campo obrigatório');
  });
});

describe('destino de regresso depois do login', () => {
  it('mantém a página e os filtros dentro da plataforma', () => {
    expect(returnPath('/colaboradores?estado=todos#lista')).toBe('/colaboradores?estado=todos#lista');
  });
  it('recusa destinos externos, barras invertidas e caracteres de controlo', () => {
    for (const input of ['https://outro.test', '//outro.test', '/\\outro.test', '/\t/outro.test', 'javascript:alert(1)', null]) expect(returnPath(input)).toBe('/');
  });
});
