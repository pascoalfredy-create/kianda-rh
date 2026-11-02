import Link from 'next/link';
import { MODELING_PLANS, SUBSCRIPTION_STATUS, VALUATION_PLANS, type CompanyModulesOverview } from '@kianda/core';

const TITLES = { hr: 'Recursos Humanos · Kianda RH', modeling: 'Modelagem Financeira · Kianda Integra', valuation: 'Análise e Avaliação · Kianda Valora' } as const;
const ENTRY = { hr: '/', modeling: '/modelagem', valuation: '/valora' } as const;

function detail(key: keyof typeof TITLES, modules: CompanyModulesOverview): string {
  if (key === 'hr') return 'Planos por número de colaboradores activos';
  if (key === 'modeling') {
    const m = modules.modeling;
    return m.subscribed ? `${MODELING_PLANS.find(p => p.key === m.planKey)?.label ?? 'Contrato por projectos'} · ${m.projectLimit === null ? 'projectos ilimitados' : `até ${m.projectLimit} projecto(s)`} · ${m.sectors.length} sectores · ${m.userLimit} utilizadores` : 'Planos por projectos activos · 5 utilizadores incluídos · PDF';
  }
  const v = modules.valuation;
  if (!v) return 'Demonstrações, orçamento, tesouraria e avaliação de empresas';
  return v.subscribed ? `${VALUATION_PLANS.find(p => p.key === v.planKey)?.label ?? 'Contrato personalizado'} · ${v.analysisLimit === null ? 'análises ilimitadas' : `até ${v.analysisLimit} análise(s) activa(s)`} · ${v.userLimit} utilizadores · PDF, Word e Excel` : 'Planos por análises activas · 5 utilizadores incluídos · PDF, Word e Excel';
}

/** Catálogo da mesma conta; só existe uma ligação de entrada quando a licença e o utilizador a permitem. */
export function ModuleCards({ modules, manage = false }: { modules: CompanyModulesOverview; manage?: boolean }) {
  return <div className="grid">
    {(['hr', 'modeling', 'valuation'] as const).map(key => {
      const access = modules[key];
      if (!access) return null;
      const until = access.status === 'trial' ? access.trialEndsAt : access.paidUntil;
      const status = !access.subscribed ? 'Não subscrito' : !access.canAccess ? 'Acesso por atribuir' : SUBSCRIPTION_STATUS[access.status];
      const label = access.canWrite ? 'Abrir módulo' : 'Abrir em consulta';
      return <div className="card kpi" key={key} id={key}>
        <div className="l">{TITLES[key]}</div>
        <div className="v" style={{ fontSize: 18 }}>{status}</div>
        <p className="muted">{detail(key, modules)}</p>
        {access.subscribed && until && <p className="muted">{access.status === 'trial' ? 'Experimental até ' : 'Pago até '}{until.split('-').reverse().join('/')}</p>}
        {access.subscribed && !access.canAccess && <p className="muted">Solicite acesso ao proprietário da empresa.</p>}
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {access.canAccess ? key === 'hr' ? <Link className="btn sm" href={ENTRY.hr}>{label}</Link> : <a className="btn sm" href={ENTRY[key]}>{label}</a> : <button className="btn sm" disabled>Sem acesso</button>}
          {manage && <Link className="btn ghost sm" href={`/licenca#${key}`}>{key === 'valuation' ? 'Ver licença' : 'Ver planos'}</Link>}
        </div>
      </div>;
    })}
  </div>;
}
