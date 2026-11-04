import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Registo from './page';
import { registrationHref, registrationSelection } from '../../lib/registration-selection';

describe('cadastro da experiência antes da escolha comercial', () => {
  it('apresenta trinta dias e confirmação do email sem planos, ciclos ou preços', () => {
    const html = renderToStaticMarkup(Registo());
    expect(html).toContain('Um mês grátis (30 dias)');
    expect(html).toContain('confirmação do email');
    expect(html).toContain('Módulos e licenças');
    for (const oldControl of ['Plano RH', 'Plano do Valora', 'Plano de Modelagem', 'Pagamento RH', 'Pagamento da Modelagem', 'Pagamento do Valora', '29.900', '29\u00a0900']) expect(html).not.toContain(oldControl);
  });
  it('exige NIF de dez dígitos e permite mostrar a palavra-passe', () => {
    const html = renderToStaticMarkup(Registo());
    expect(html).toContain('NIF da empresa *');
    expect(html).toContain('pattern="[0-9]{10}"');
    expect(html.match(/<input\b(?=[^>]*name="nif")[^>]*>/)?.[0]).toContain('required=""');
    expect(html).toContain('Mostrar palavra-passe');
  });
  it('as ligações públicas e valores comerciais continuam a ser rotas locais válidas', () => {
    expect(registrationHref('valuation', 'corporate', 'annual')).toBe('/registo?modulo=valuation&plano=corporate&ciclo=annual');
    expect(registrationSelection({ modulo: ['modeling', 'hr'], plano: 'inexistente', ciclo: '__proto__' })).toEqual({ module: 'hr', planKey: '', cycle: 'monthly' });
  });
});
