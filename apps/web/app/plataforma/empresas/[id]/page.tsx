import { CYCLES, DEFAULT_TIERS, LEGACY_CUSTOM_TIER, MODELING_PLANS, VALUATION_PLANS } from '@kianda/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PurgeCompany } from '@/components/privacy-actions';
import { hrModule, loadCompanies, moduleState, pt, requirePlatformAdmin } from '../../data';
import { EditSubscription, EditValuation, RegistrationReview } from '../../forms';
import { statusLabel } from '@/lib/registration';

export const dynamic = 'force-dynamic';

/** Ficha de uma empresa cliente: dados, revisão do cadastro, licença de cada módulo e eliminação. */
export default async function Empresa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [, { companies }] = await Promise.all([requirePlatformAdmin(), loadCompanies({ id })]);
  const c = companies[0];
  if (!c) notFound();
  const hr = moduleState(hrModule(c)),
    mo = moduleState(c.modules.modeling),
    va = moduleState(c.modules.valuation);
  const review = c.registrationReviewReasons.length + c.registrationDataIssues.length > 0;
  return (
    <>
      <div className="crumb">
        <Link href="/plataforma/empresas">Empresas</Link> / {c.name}
      </div>
      <h1>{c.name}</h1>
      <p className="sub">
        NIF {c.nif}
        {c.sectorLabel ? ` · ${c.sectorLabel}` : ''} · cliente desde {pt(c.createdAt?.slice(0, 10) ?? null)}
      </p>

      {review && (
        <div className="card section" style={{ borderColor: '#f3d9a6' }}>
          <h2>Cadastro por rever</h2>
          <div className="reg-list" style={{ padding: '0 16px 16px' }}>
            {c.registrationChecklist.map(item => (
              <div className="reg-row" key={item.key} data-check={item.key}>
                <div className="reg-head">
                  <div>
                    <b>{item.label}</b>
                    {item.value && <span className="muted"> · {item.value}</span>}
                    {item.message && <p className="muted reg-msg">{item.message}</p>}
                  </div>
                  <span className="reg-pills">
                    <span className={`st ${item.status === 'ok' ? 'approved' : 'pending'}`}>{statusLabel(item)}</span>
                    {item.status !== 'ok' && (
                      <span className={`st ${item.blocking ? 'rejected' : 'cancelled'}`}>
                        {item.blocking ? 'Bloqueia o acesso' : 'Aviso, não bloqueia'}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}
            {c.registrationReviewReasons.length > 0 ? (
              <div className="reg-row">
                <RegistrationReview companyId={c.id} />
              </div>
            ) : (
              <p className="muted reg-msg">
                O acesso não está bloqueado. Os pontos acima são avisos que o cliente corrige na conta.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card section">
        <h2>Dados da empresa</h2>
        <dl className="facts">
          <dt>Código</dt>
          <dd>{c.code ?? '—'}</dd>
          <dt>Responsável</dt>
          <dd>
            {c.owner?.name ?? '—'} {c.owner?.email ? <span className="muted">· {c.owner.email}</span> : null}
          </dd>
          <dt>Colaboradores activos</dt>
          <dd>
            {c.activeEmployees}
            {c.limit ? ` de ${c.limit} na faixa contratada` : ''}
          </dd>
          <dt>Pagamentos pendentes</dt>
          <dd>
            {c.pendingPayments ? (
              <Link href="/plataforma/pagamentos">{c.pendingPayments} por confirmar</Link>
            ) : (
              'Nenhum'
            )}
          </dd>
          {c.notes && (
            <>
              <dt>Notas</dt>
              <dd>{c.notes}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="licence-grid">
        <div className="card">
          <h2>Kianda RH</h2>
          <p>
            <span className={hr.cls}>{hr.label}</span> <span className="muted">{hr.until}</span>
          </p>
          <p className="muted">
            {c.tierLabel}
            {c.cycle ? ` · ${CYCLES[c.cycle as keyof typeof CYCLES]?.label ?? c.cycle}` : ''}
          </p>
          <EditSubscription c={c} tiers={[...DEFAULT_TIERS, LEGACY_CUSTOM_TIER]} />
        </div>
        <div className="card">
          <h2>Kianda Integra</h2>
          <p>
            <span className={mo.cls}>{mo.label}</span> <span className="muted">{mo.until}</span>
          </p>
          <p className="muted">
            {MODELING_PLANS.find(p => p.key === c.modules.modeling.planKey)?.label ?? 'Contrato personalizado'} ·{' '}
            {c.modules.modeling.projectLimit === null
              ? 'projectos ilimitados'
              : `${c.modules.modeling.projectLimit} projecto(s)`}{' '}
            · {c.modules.modeling.userLimit} utilizadores
          </p>
        </div>
        <div className="card">
          <h2>Kianda Valora</h2>
          <p>
            <span className={va.cls}>{va.label}</span> <span className="muted">{va.until}</span>
          </p>
          <p className="muted">
            {c.modules.valuation.planKey
              ? `${VALUATION_PLANS.find(x => x.key === c.modules.valuation.planKey)?.label} · `
              : ''}
            {c.modules.valuation.analysisLimit === null
              ? 'análises ilimitadas'
              : `${c.modules.valuation.analysisLimit} análise(s)`}{' '}
            · {c.modules.valuation.userLimit} utilizadores
          </p>
          <EditValuation companyId={c.id} v={c.modules.valuation} />
        </div>
      </div>

      <div className="card section">
        <h2>Eliminar a empresa</h2>
        <p className="muted" style={{ padding: '4px 16px 0' }}>
          Só disponível depois de todas as licenças estarem canceladas. Apaga os dados da empresa de forma definitiva.
        </p>
        <div style={{ padding: '8px 16px 16px' }}>
          <PurgeCompany
            id={c.id}
            nif={c.nif}
            cancelled={
              c.status === 'cancelled' &&
              (!c.modules.modeling.subscribed || c.modules.modeling.status === 'cancelled') &&
              (!c.modules.valuation.subscribed || c.modules.valuation.status === 'cancelled')
            }
          />
        </div>
      </div>
    </>
  );
}
