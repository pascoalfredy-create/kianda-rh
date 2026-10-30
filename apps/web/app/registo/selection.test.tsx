import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Registo from './page';
import { registrationHref, registrationSelection } from '../../lib/registration-selection';

describe('passagem dos planos públicos para o registo', () => {
  it('abre Integra Corporate anual com a escolha visível, mantendo o RH opcional', async () => {
    const href = registrationHref('modeling', 'corporate', 'annual');
    const query = Object.fromEntries(new URL(href, 'https://kianda.test').searchParams);
    const html = renderToStaticMarkup(await Registo({ searchParams: Promise.resolve(query) }));
    expect(html).toContain('<option value="corporate" selected="">');
    expect(html).toContain('<option value="annual" selected="">');
    expect(html).toContain('Plano de Modelagem'); expect(html).not.toContain('Pagamento RH');
    expect(html).toContain('1\u00a0224\u00a0000,00 Kz');
  });
  it('abre a faixa RH escolhida com o mesmo ciclo e sem activar Integra', async () => {
    const href = registrationHref('hr', 't3', 'semiannual');
    const query = Object.fromEntries(new URL(href, 'https://kianda.test').searchParams);
    const html = renderToStaticMarkup(await Registo({ searchParams: Promise.resolve(query) }));
    expect(html).toContain('<option value="t3" selected="">');
    expect(html).toContain('<option value="semiannual" selected="">');
    expect(html).toContain('377\u00a0460,00 Kz');
    expect(html).not.toContain('Plano de Modelagem'); expect(html).toContain('Pagamento RH');
  });
  it('usa os valores normais quando o endereço não tem uma escolha válida', () => {
    expect(registrationSelection({})).toEqual({ module: 'hr', planKey: '', cycle: 'monthly' });
    expect(registrationSelection({ modulo: ['modeling', 'hr'], plano: 'inexistente', ciclo: '__proto__' })).toEqual({ module: 'hr', planKey: '', cycle: 'monthly' });
    expect(registrationSelection({ modulo: 'modeling', plano: 'unlimited', ciclo: 'monthly' })).toEqual({ module: 'modeling', planKey: 'unlimited', cycle: 'monthly' });
  });
});
