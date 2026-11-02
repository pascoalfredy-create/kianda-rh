import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { type CompanyModulesOverview } from '@kianda/core';
import { ModuleCards } from './module-cards';
import { ModelingSectors } from './modeling-sectors';

const modules: CompanyModulesOverview = {
  hr: { subscribed: false, status: 'cancelled', canRead: false, canWrite: false, canAccess: false, trialEndsAt: null, paidUntil: null },
  modeling: { subscribed: true, status: 'active', canRead: true, canWrite: true, canAccess: true, trialEndsAt: null, paidUntil: '2027-12-31', projectLimit: 2, extraUsers: 0, userLimit: 5, planKey: 'pme', cycle: 'monthly', primarySector: 'mineracao', sectors: ['mineracao', 'servicos'] },
  valuation: { subscribed: true, status: 'trial', canRead: true, canWrite: true, canAccess: true, trialEndsAt: '2026-11-08', paidUntil: null, analysisLimit: 10, extraUsers: 0, userLimit: 5, planKey: 'essencial', cycle: 'monthly' },
};
describe('catálogo comum e escolha dos sectores', () => {
  it('mostra os dois módulos mas só permite entrar no que está autorizado', () => {
    const html = renderToStaticMarkup(<ModuleCards modules={modules} manage />);
    expect(html).toContain('Recursos Humanos'); expect(html).toContain('Modelagem Financeira'); expect(html).toContain('Não subscrito'); expect(html).toContain('Sem acesso');
    expect(html).toContain('href="/modelagem"'); expect(html).not.toContain('href="/"'); expect(html).toContain('href="/licenca#hr"');
    expect(html).toContain('2 sectores'); expect(html).toContain('5 utilizadores');
  });
  it('mostra o Valora com o limite de análises e a entrada própria', () => {
    const html = renderToStaticMarkup(<ModuleCards modules={modules} manage />);
    expect(html).toContain('Kianda Valora'); expect(html).toContain('Essencial · até 10 análise(s) activa(s)'); expect(html).toContain('href="/valora"');
    expect(html).toContain('Experimental até 08/11/2026'); expect(html).toContain('href="/licenca#valuation"');
    const off = renderToStaticMarkup(<ModuleCards modules={{ ...modules, valuation: { ...modules.valuation, subscribed: false, canAccess: false, canRead: false } }} />);
    expect(off).not.toContain('href="/valora"');
  });
  it('uma licença paga não ultrapassa a atribuição de acesso individual', () => {
    const html = renderToStaticMarkup(<ModuleCards modules={{ ...modules, modeling: { ...modules.modeling, canAccess: false } }} />);
    expect(html).toContain('Acesso por atribuir'); expect(html).not.toContain('href="/modelagem"');
  });
  it('mantém o principal seleccionado e só disponibiliza uma escolha adicional no PME', () => {
    const html = renderToStaticMarkup(<ModelingSectors planKey="pme" primary="mineracao" selected={['mineracao', 'servicos']} onChange={() => {}} />);
    expect(html).toContain('2 de 2'); expect(html).toContain('Mineração'); expect(html).toContain('projectos é um limite separado');
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(8);
    expect((html.match(/checked=""/g) ?? [])).toHaveLength(2);
    expect((html.match(/disabled=""/g) ?? [])).toHaveLength(7);
  });
});
