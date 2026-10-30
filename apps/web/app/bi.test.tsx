import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ me: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/api', () => ({ currentUser: state.me, api: state.api }));
vi.mock('next/navigation', () => ({ redirect: (path:string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('@/components/people-snapshot', () => import('../components/people-snapshot'));
vi.mock('@/components/rh-bars', () => import('../components/rh-bars'));
vi.mock('@/lib/format', () => import('../lib/format'));
import Bi from './(app)/bi/page';

beforeEach(() => { state.me.mockReset(); state.api.mockReset(); });
describe('Painel BI de RH', () => {
  it('exige a licença RH e os mesmos perfis autorizados nos relatórios', async () => {
    state.me.mockResolvedValue({ modules: { hr: { canAccess: false } }, user: { role: 'owner' } });
    await expect(Bi()).rejects.toThrow('redirect:/modulos');
    for (const role of ['employee', 'manager']) {
      state.me.mockResolvedValue({ modules: { hr: { canAccess: true } }, user: { role } });
      await expect(Bi()).rejects.toThrow('redirect:/');
    }
    expect(state.api).not.toHaveBeenCalled();
  });
  it('usa o resumo autorizado da API sem fabricar valores financeiros indisponíveis', async () => {
    state.me.mockResolvedValue({ modules: { hr: { canAccess: true } }, user: { role: 'finance' }, company: { name: 'Empresa sintética' } });
    state.api.mockResolvedValue({ active: 0, fixedTerm: 0, interns: 0, financial: null, demographics: null, departments: [], locations: [] });
    const html = renderToStaticMarkup(await Bi());
    expect(state.api).toHaveBeenCalledWith('/v1/reports/overview'); expect(html).toContain('Painel BI');
    expect(html).toContain('Sem dados salariais disponíveis'); expect(html).not.toContain('NaN'); expect(html).not.toContain('undefined');
  });
});
