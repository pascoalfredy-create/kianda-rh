import { describe, expect, it } from 'vitest';
import { navigation, navActive } from './navigation';
import type { Me } from './api';

const me = (role: string, hr = true, modeling = false): Me => ({ user: { sub: 'u', role, employeeId: 'e', name: 'Pessoa de teste', companyId: 'co' }, company: { id: 'co', name: 'Empresa de teste', nif: '0000000000' }, modules: { hr: { subscribed: hr, canAccess: hr, canRead: hr, canWrite: hr, status: hr ? 'active' : 'cancelled', paidUntil: null, trialEndsAt: null }, modeling: { subscribed: modeling, canAccess: modeling, canRead: modeling, canWrite: modeling, status: modeling ? 'active' : 'cancelled', paidUntil: null, trialEndsAt: null, planKey: null, cycle: null, projectLimit: 2, extraUsers: 0, userLimit: 5, primarySector: null, sectors: [] } } });
const links = (user: Me) => navigation(user, { absences: 2, expenses: 3 }).flatMap(g => g.items);
describe('menu comum e permissões do protótipo RH', () => {
  it('separa análise, configuração e plataforma, conservando os pedidos operacionais em Geral', () => {
    const groups = navigation(me('owner'), { absences: 2, expenses: 3 });
    expect(groups.map(g => g.label)).toEqual(['Geral', 'Tempo', 'Remunerações', 'Finanças', 'Talento', 'Análise', 'Configuração', 'Plataforma']);
    expect(groups.find(g => g.label === 'Análise')!.items.map(i => i.label)).toEqual(['Relatórios', 'BI']);
    expect(groups.find(g => g.label === 'Configuração')!.items.map(i => i.href)).toEqual(['/definicoes', '/sector', '/conformidade', '/acessos']);
    expect(groups.find(g => g.label === 'Geral')!.items.some(i => i.href === '/pedidos')).toBe(true);
    expect(links(me('owner')).find(l => l.href === '/ausencias')?.badge).toBe(2);
    expect(links(me('owner')).find(l => l.href === '/despesas')?.badge).toBe(3);
  });
  it('o colaborador tem o seu espaço e não ganha acessos de administração ou de salários da equipa', () => {
    const hrefs = links(me('employee')).map(l => l.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/recibos', '/ausencias', '/despesas', '/documentos', '/colaboradores/e', '/modulos']));
    for (const forbidden of ['/colaboradores', '/processamento', '/tesouraria', '/analitica', '/acessos', '/licenca', '/plataforma']) expect(hrefs).not.toContain(forbidden);
  });
  it('a chefia continua sem as áreas de Finanças e a administração de RH não recebe a Tesouraria', () => {
    expect(links(me('manager')).map(l => l.href)).not.toEqual(expect.arrayContaining(['/tesouraria']));
    expect(links(me('manager')).map(l => l.href)).toContain('/recrutamento');
    expect(links(me('hr_admin')).map(l => l.href)).not.toContain('/tesouraria');
    expect(links(me('finance')).map(l => l.href)).toContain('/tesouraria');
    expect(links(me('payroll')).map(l => l.href)).toContain('/analitica');
  });
  it('uma conta só de Modelagem não recebe ligações operacionais do RH', () => {
    const groups = navigation(me('owner', false, true), { absences: 0, expenses: 0 });
    expect(groups.map(g => g.label)).toEqual(['Configuração', 'Plataforma']);
    expect(groups.find(g => g.label === 'Configuração')!.items.map(i => i.href)).toEqual(['/definicoes', '/acessos']);
    expect(groups.find(g => g.label === 'Plataforma')!.items.find(l => l.label === 'Recursos Humanos')).toMatchObject({ href: '/modulos#hr', locked: true });
    expect(groups.find(g => g.label === 'Plataforma')!.items.find(l => l.href === '/modelagem')?.locked).toBe(false);
  });
  it('uma licença de Modelagem não ultrapassa a atribuição individual', () => {
    const user = me('employee', true, true); user.modules.modeling.canAccess = false;
    expect(links(user).find(l => l.label === 'Modelagem Financeira')).toMatchObject({ href: '/modulos#modeling', locked: true });
    expect(links(user).map(l => l.href)).not.toContain('/modelagem');
  });
  it('destaca uma só entrada nas páginas de detalhe e nos separadores de Finanças', () => {
    for (const path of ['/bi', '/sector', '/definicoes', '/pedidos', '/acessos']) expect(links(me('owner')).filter(l => navActive(l.href, path, new URLSearchParams()))).toHaveLength(1);
    expect(navActive('/', '/colaboradores/e', new URLSearchParams())).toBe(false);
    expect(navActive('/colaboradores', '/colaboradores/e', new URLSearchParams())).toBe(true);
    for (const section of ['balancete', 'diario', 'razao', 'exportar', 'plano']) {
      const selected = links(me('owner')).filter(l => navActive(l.href, '/financas', new URLSearchParams({ s: section })));
      expect(selected).toHaveLength(1);
      expect(selected[0]!.label).toBe(section === 'plano' ? 'Plano de contas' : 'Lançamentos contabilísticos');
    }
  });
  it('mudar os grupos não alarga os acessos da chefia nem do colaborador', () => {
    for (const role of ['employee', 'manager']) {
      const hrefs = links(me(role)).map(i => i.href);
      for (const path of ['/bi', '/relatorios', '/definicoes', '/sector', '/conformidade', '/acessos']) expect(hrefs).not.toContain(path);
    }
    for (const role of ['finance', 'payroll']) {
      const config = navigation(me(role), { absences: 0, expenses: 0 }).find(g => g.label === 'Configuração')!;
      expect(config.items.map(i => i.href)).toEqual(['/sector', '/conformidade']);
    }
  });
});
