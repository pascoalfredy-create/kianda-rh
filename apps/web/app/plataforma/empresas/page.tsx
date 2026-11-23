import Link from 'next/link';
import { hrModule, loadCompanies, moduleState, pt, requirePlatformAdmin, type Co } from '../data';

export const dynamic = 'force-dynamic';

const PAGE = 50;

const FILTERS: [string, string, (c: Co) => boolean][] = [
  ['todas', 'Todas', () => true],
  ['revisao', 'Por rever', c => c.registrationReviewReasons.length + c.registrationDataIssues.length > 0],
  [
    'experimental',
    'Experimentais',
    c => [c.status, c.modules.modeling.status, c.modules.valuation.status].includes('trial'),
  ],
  ['pagas', 'Pagas', c => [c.status, c.modules.modeling.status, c.modules.valuation.status].includes('active')],
  ['atraso', 'Em atraso', c => [c.status, c.modules.modeling.status, c.modules.valuation.status].includes('past_due')],
];

/** Empresas clientes: uma linha por empresa; os ajustes de licença ficam na ficha de cada uma. */
export default async function Empresas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ver?: string; p?: string }>;
}) {
  const [, sp, { companies }] = await Promise.all([requirePlatformAdmin(), searchParams, loadCompanies()]);
  const q = (sp.q ?? '').trim().toLowerCase();
  const filter = FILTERS.find(f => f[0] === sp.ver) ?? FILTERS[0]!;
  const rows = companies.filter(
    c => filter[2](c) && (!q || `${c.name} ${c.nif} ${c.code ?? ''} ${c.owner?.email ?? ''}`.toLowerCase().includes(q)),
  );
  const href = (ver: string, page = 1) =>
    `?ver=${ver}${q ? `&q=${encodeURIComponent(q)}` : ''}${page > 1 ? `&p=${page}` : ''}`;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.p) || 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  return (
    <>
      <h1>Empresas</h1>
      <p className="sub">
        {companies.length} empresas clientes. Abra uma empresa para ver os dados e ajustar as licenças.
      </p>
      <div className="filter-bar">
        {FILTERS.map(([key, label, fn]) => (
          <Link key={key} href={href(key)} className={`btn sm ${filter[0] === key ? '' : 'ghost'}`}>
            {label} ({companies.filter(fn).length})
          </Link>
        ))}
        <form style={{ marginLeft: 'auto' }}>
          <input type="hidden" name="ver" value={filter[0]} />
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Procurar por nome, NIF ou email"
            aria-label="Procurar empresa"
          />
        </form>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div className="empty">Nenhuma empresa corresponde à pesquisa.</div>
        ) : (
          <table className="dense">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Responsável</th>
                <th>Módulos</th>
                <th className="num">Colaboradores</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id} style={{ verticalAlign: 'top' }}>
                  <td>
                    <Link href={`/plataforma/empresas/${c.id}`}>
                      <b>{c.name}</b>
                    </Link>
                    <div className="muted">
                      NIF {c.nif}
                      {c.sectorLabel ? ` · ${c.sectorLabel}` : ''} · desde {pt(c.createdAt?.slice(0, 10) ?? null)}
                    </div>
                    {c.registrationReviewReasons.length + c.registrationDataIssues.length > 0 && (
                      <span className="st pending">Por rever</span>
                    )}
                    {c.pendingPayments ? (
                      <span className="tag future">{c.pendingPayments} pagamento(s) pendente(s)</span>
                    ) : null}
                  </td>
                  <td>
                    {c.owner?.name ?? '—'}
                    <div className="muted">{c.owner?.email}</div>
                  </td>
                  <td>
                    <div className="module-lines">
                      {(
                        [
                          ['RH', hrModule(c)],
                          ['Integra', c.modules.modeling],
                          ['Valora', c.modules.valuation],
                        ] as const
                      ).map(([label, mod]) => {
                        const s = moduleState(mod);
                        return (
                          <div key={label}>
                            <b>{label}</b>
                            <span className={s.cls}>{s.label}</span>
                            <span className="muted">{s.until}</span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="num">
                    {c.activeEmployees}
                    {c.limit ? ` / ${c.limit}` : ''}
                  </td>
                  <td className="num">
                    <Link className="btn ghost sm" href={`/plataforma/empresas/${c.id}`}>
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="filter-bar" style={{ marginTop: 14, justifyContent: 'center' }}>
          {page > 1 && (
            <Link className="btn ghost sm" href={href(filter[0], page - 1)}>
              ← Anterior
            </Link>
          )}
          <span className="muted">
            Página {page} de {pages} · {rows.length} empresas
          </span>
          {page < pages && (
            <Link className="btn ghost sm" href={href(filter[0], page + 1)}>
              Seguinte →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
