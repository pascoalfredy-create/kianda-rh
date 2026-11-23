import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import { attention, loadCompanies, loadIntegrations, loadPayments, requirePlatformAdmin } from './data';
import type { VisitsSummary } from './visits';

export const dynamic = 'force-dynamic';

/** Visão geral: os números do negócio e o que pede acção hoje. Cada bloco tem o seu ecrã. */
export default async function Plataforma() {
  const [, { summary }, pays, integ, visits] = await Promise.all([
    requirePlatformAdmin(),
    loadCompanies({ summary: true }),
    loadPayments(),
    loadIntegrations(),
    api<VisitsSummary>('/v1/platform/visits?days=30'),
  ]);
  const todo = attention(summary, pays, integ);
  const m = summary.modules;
  return (
    <>
      <h1>Plataforma Kianda</h1>
      <p className="sub">Visão geral do negócio: clientes, receita e o que pede a sua atenção.</p>
      <div className="grid">
        <Link href="/plataforma/empresas" className="card kpi">
          <div className="l">Empresas clientes</div>
          <div className="v">{summary.total}</div>
          <div className="muted">{summary.trial} em período experimental</div>
        </Link>
        <div className="card kpi">
          <div className="l">Receita mensal recorrente</div>
          <div className="v">{formatKz(summary.mrrMinor)}</div>
          <div className="muted">ao preço do ciclo contratado</div>
        </div>
        <div className="card kpi">
          <div className="l">Licenças pagas</div>
          <div className="v">{summary.active + m.modeling.active + m.valuation.active}</div>
          <div className="muted">
            RH {summary.active} · Integra {m.modeling.active} · Valora {m.valuation.active}
          </div>
        </div>
        <div className="card kpi">
          <div className="l">Em atraso</div>
          <div
            className="v"
            style={{ color: summary.pastDue + m.modeling.pastDue + m.valuation.pastDue ? 'var(--amber)' : undefined }}
          >
            {summary.pastDue + m.modeling.pastDue + m.valuation.pastDue}
          </div>
          <div className="muted">{summary.suspended} empresa(s) suspensa(s) no RH</div>
        </div>
      </div>

      <div className="card section">
        <h2>Precisa da sua atenção</h2>
        {todo.length ? (
          <div className="attention">
            {todo.map(a => (
              <Link key={a.label} href={a.href}>
                <b>{a.n}</b>
                <span>{a.label}</span>
                <span>Resolver →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">Nada pendente. Está tudo em dia.</div>
        )}
      </div>

      <div className="grid">
        <div className="card section">
          <h2>Receita por módulo</h2>
          <table className="dense">
            <tbody>
              {(
                [
                  ['Kianda RH', summary.mrrByModule.hr, `${summary.active} pagas · ${summary.trial} experimentais`],
                  [
                    'Kianda Integra',
                    summary.mrrByModule.modeling,
                    `${m.modeling.active} pagas · ${m.modeling.trial} experimentais`,
                  ],
                  [
                    'Kianda Valora',
                    summary.mrrByModule.valuation,
                    `${m.valuation.active} pagas · ${m.valuation.trial} experimentais`,
                  ],
                ] as const
              ).map(([label, mrr, detail]) => (
                <tr key={label}>
                  <td>
                    <b>{label}</b>
                    <div className="muted">{detail}</div>
                  </td>
                  <td className="num">
                    <b>{formatKz(mrr)}</b>
                    <div className="muted">por mês</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/plataforma/visitas" className="card section">
          <h2>Site nos últimos 30 dias</h2>
          <div className="grid" style={{ padding: '12px 16px 16px', marginBottom: 0 }}>
            <div className="kpi">
              <div className="l">Visitantes</div>
              <div className="v">{visits.totals.visitors}</div>
            </div>
            <div className="kpi">
              <div className="l">Contas criadas</div>
              <div className="v">{visits.totals.signups}</div>
            </div>
            <div className="kpi">
              <div className="l">Hoje</div>
              <div className="v">{visits.totals.today}</div>
            </div>
          </div>
        </Link>
      </div>
    </>
  );
}
