import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
describe('referência BNA identificada, via Frankfurter', () => {
  it('aceita apenas o par pedido e conserva a data publicada; reaproveita a referência em memória', async () => {
    const fetchRate = vi.fn().mockResolvedValue(new Response(JSON.stringify({ base: 'USD', quote: 'AOA', rate: 913, date: '2026-10-27' }))); vi.stubGlobal('fetch', fetchRate);
    const { modelingExchangeQuote } = await import('../src/services/modeling-exchange.js');
    expect(await modelingExchangeQuote('USD', 'Kz')).toMatchObject({ from: 'USD', to: 'Kz', rate: 913, rateDate: '2026-10-27', source: 'BNA via Frankfurter (referência)' });
    await modelingExchangeQuote('USD', 'Kz'); expect(fetchRate).toHaveBeenCalledTimes(1); expect(fetchRate.mock.calls[0]![0]).toContain('/providers/bna/rate/usd/aoa');
  });
  it.each([{ base: 'EUR', quote: 'AOA', rate: 913, date: '2026-10-27' }, { base: 'USD', quote: 'AOA', rate: 0, date: '2026-10-27' }, { base: 'USD', quote: 'AOA', rate: 913, date: '2026-02-30' }, { base: 'USD', quote: 'AOA', rate: 913, date: '2099-10-27' }])('não aceita uma resposta incompatível: %j', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    const { modelingExchangeQuote } = await import('../src/services/modeling-exchange.js');
    await expect(modelingExchangeQuote('USD', 'Kz')).rejects.toThrow('Não foi possível obter');
  });
  it('falha de rede não produz uma taxa fictícia ou uma conversão à taxa 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sem rede')));
    const { modelingExchangeQuote } = await import('../src/services/modeling-exchange.js');
    await expect(modelingExchangeQuote('USD', 'EUR')).rejects.toThrow('Indique a taxa');
    expect(await modelingExchangeQuote('USD', 'USD')).toMatchObject({ rate: 1 });
  });
});
