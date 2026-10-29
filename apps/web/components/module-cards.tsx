import Link from 'next/link';
import { MODELING_PLANS, SUBSCRIPTION_STATUS, type CompanyModulesOverview } from '@kianda/core';

/** Catálogo da mesma conta; só existe uma ligação de entrada quando a licença e o utilizador a permitem. */
export function ModuleCards({ modules, manage = false }: { modules: CompanyModulesOverview; manage?: boolean }) {
  return <div className="grid">
    {(['hr', 'modeling'] as const).map(key => {
      const access = modules[key];
      const modeling = key === 'modeling';
      const title = modeling ? 'Modelagem Financeira · Kianda Integra' : 'Recursos Humanos · Kianda RH';
      const until = access.status === 'trial' ? access.trialEndsAt : access.paidUntil;
      const status = !access.subscribed ? 'Não subscrito' : !access.canAccess ? 'Acesso por atribuir' : SUBSCRIPTION_STATUS[access.status];
      return <div className="card kpi" key={key} id={key}>
        <div className="l">{title}</div>
        <div className="v" style={{ fontSize: 18 }}>{status}</div>
        <p className="muted">{modeling ? access.subscribed ? `${MODELING_PLANS.find(p => p.key === modules.modeling.planKey)?.label ?? 'Contrato por projectos'} · ${modules.modeling.projectLimit === null ? 'projectos ilimitados' : `até ${modules.modeling.projectLimit} projecto(s)`} · ${modules.modeling.sectors.length} sectores · ${modules.modeling.userLimit} utilizadores` : 'Planos por projectos activos · 5 utilizadores incluídos · PDF' : 'Planos por número de colaboradores activos'}</p>
        {access.subscribed && until && <p className="muted">{access.status === 'trial' ? 'Experimental até ' : 'Pago até '}{until.split('-').reverse().join('/')}</p>}
        {access.subscribed && !access.canAccess && <p className="muted">Solicite acesso ao proprietário da empresa.</p>}
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {access.canAccess ? <Link className="btn sm" href={modeling ? '/modelagem' : '/'}>{access.canWrite ? 'Abrir módulo' : 'Abrir em consulta'}</Link> : <button className="btn sm" disabled>Sem acesso</button>}
          {manage && <Link className="btn ghost sm" href={`/licenca#${key}`}>Ver planos</Link>}
        </div>
      </div>;
    })}
  </div>;
}
