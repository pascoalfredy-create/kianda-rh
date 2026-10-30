import type { Me } from './api';

export type NavIcon = 'home' | 'users' | 'clock' | 'cal' | 'money' | 'receipt' | 'doc' | 'brief' | 'star' | 'chart' | 'gear' | 'check' | 'modules' | 'lock' | 'bell' | 'search';
export interface NavItem { href: string; label: string; icon: NavIcon; badge?: number; locked?: boolean }
export interface NavGroup { label: string; items: NavItem[] }
const staff = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'];
export function navigation(me: Me, counts: { absences: number; expenses: number }) {
  const groups: NavGroup[] = [];
  const role = me.user.role;
  const has = (...roles: string[]) => role === 'owner' || roles.includes(role);
  const item = (href: string, label: string, icon: NavIcon, badge?: number): NavItem => ({ href, label, icon, badge });
  const add = (label: string, items: (NavItem | false | null)[]) => {
    const shown = items.filter((i): i is NavItem => !!i);
    if (shown.length) groups.push({ label, items: shown });
  };
  if (me.modules.hr.canAccess && staff.includes(role)) {
    add('Geral', [item('/', 'Início', 'home'), item('/colaboradores', 'Colaboradores', 'users'), item('/organograma', 'Organograma', 'brief'), has('hr_admin') && item('/pedidos', 'Pedidos do portal', 'doc')]);
    add('Tempo', [item('/assiduidade', 'Assiduidade & Ponto', 'clock'), item('/ausencias', 'Férias & Ausências', 'cal', counts.absences)]);
    add('Remunerações', [
      has('payroll', 'finance', 'hr_admin') && item('/processamento', 'Processamento salarial', 'money'),
      has('payroll', 'finance', 'hr_admin') && item('/obrigacoes', 'AGT & INSS', 'receipt'),
      item('/despesas', 'Despesas & Ajudas de custo', 'receipt', counts.expenses),
      has('payroll', 'finance', 'hr_admin') && item('/adiantamentos', 'Adiantamentos', 'money'),
      has('payroll', 'finance', 'hr_admin') && item('/cessacoes', 'Cessações', 'doc'),
      item('/simulador', 'Simulador salarial', 'money'),
      !!me.user.employeeId && item('/recibos', 'Os meus recibos', 'receipt'),
    ]);
    add('Finanças', [
      has('payroll', 'finance') && item('/financas?s=diario', 'Lançamentos contabilísticos', 'doc'),
      has('payroll', 'finance') && item('/tesouraria', 'Tesouraria', 'money'),
      has('payroll', 'finance') && item('/conciliacao', 'Conciliação bancária', 'check'),
      has('payroll', 'finance', 'hr_admin') && item('/orcamento', 'Orçamento de pessoal', 'chart'),
      has('payroll', 'finance', 'hr_admin') && item('/analitica', 'Centros de custo', 'brief'),
      has('payroll', 'finance') && item('/financas?s=plano', 'Plano de contas', 'gear'),
    ]);
    add('Talento', [has('hr_admin', 'manager') && item('/recrutamento', 'Recrutamento', 'brief'), item('/desempenho', 'Desempenho', 'star'), item('/documentos', 'Documentos', 'doc')]);
    add('Análise', [
      has('payroll', 'finance', 'hr_admin') && item('/relatorios', 'Relatórios', 'chart'),
      has('payroll', 'finance', 'hr_admin') && item('/bi', 'BI', 'chart'),
    ]);
  } else if (me.modules.hr.canAccess) {
    add('O meu espaço', [
      item('/', 'Painel pessoal', 'home'), item('/recibos', 'Os meus recibos', 'money'), item('/ausencias', 'As minhas férias', 'cal'),
      item('/despesas', 'As minhas despesas', 'receipt'), item('/documentos', 'Documentos', 'doc'), item('/assiduidade', 'Assiduidade & Ponto', 'clock'),
      !!me.user.employeeId && item('/adiantamentos', 'Adiantamentos', 'money'),
      !!me.user.employeeId && item(`/colaboradores/${me.user.employeeId}`, 'A minha ficha', 'users'),
      !!me.user.employeeId && item('/portal/dados', 'Os meus dados', 'doc'), item('/desempenho', 'Desempenho', 'star'), item('/simulador', 'Simulador salarial', 'money'),
    ]);
  }
  add('Configuração', [
    has('hr_admin') && item('/definicoes', 'Definições gerais', 'gear'),
    me.modules.hr.canAccess && has('payroll', 'finance', 'hr_admin') && item('/sector', 'Sector e regimes', 'brief'),
    me.modules.hr.canAccess && has('payroll', 'finance', 'hr_admin') && item('/conformidade', 'Conformidade', 'check'),
    has('hr_admin') && item('/acessos', 'Utilizadores e acessos', 'users'),
  ]);
  add('Plataforma', [
    item('/modulos', 'Módulos', 'modules'),
    !me.modules.hr.canAccess && { ...item('/modulos#hr', 'Recursos Humanos', 'users'), locked: true },
    { ...item(me.modules.modeling.canAccess ? '/modelagem' : '/modulos#modeling', 'Modelagem Financeira', 'chart'), locked: !me.modules.modeling.canAccess },
    has('finance') && item('/licenca', 'Módulos e licenças', 'lock'),
    !!me.platformAdmin && item('/plataforma', 'Plataforma Kianda', 'gear'),
  ]);
  return groups;
}

export function navActive(href: string, pathname: string, search: URLSearchParams) {
  if (href.includes('#')) return false;
  const [path, query] = href.split('?');
  if (path === '/financas') return pathname === path && (query === 's=plano' ? search.get('s') === 'plano' : search.get('s') !== 'plano');
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}
