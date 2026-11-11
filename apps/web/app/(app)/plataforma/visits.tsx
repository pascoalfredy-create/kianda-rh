/** Zona «Visitas ao site» da consola: quantas pessoas visitam o site e quantas criam conta. */
export interface VisitsSummary {
  days: number; from: string; to: string;
  totals: { today: number; last7: number; visitors: number; views: number; previous: number; signups: number; confirmed?: number };
  series: { day: string; visitors: number; views: number; signups: number }[];
  pages: { key: string; n: number }[]; referrers: { key: string; n: number }[]; countries: { key: string; n: number }[];
  devices: { key: string; n: number }[]; sources: { key: string; n: number }[];
}

const COUNTRY: Record<string, string> = { AO: 'Angola', PT: 'Portugal', BR: 'Brasil', MZ: 'Moçambique', ZA: 'África do Sul', NA: 'Namíbia', US: 'Estados Unidos', GB: 'Reino Unido', FR: 'França', CV: 'Cabo Verde', CD: 'RD Congo', CG: 'Congo', AE: 'Emirados Árabes Unidos', RU: 'Rússia', desconhecido: 'Desconhecido' };
const PAGE: Record<string, string> = { '/': 'Página inicial', '/registo': 'Criar conta' };
const DEVICE: Record<string, string> = { mobile: 'Telemóvel', desktop: 'Computador' };
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Top({ title, rows, label }: { title: string; rows: { key: string; n: number }[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {rows.length ? rows.map(r => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 13, padding: '3px 0' }}>
          <div>
            <div>{label ? label(r.key) : r.key}</div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--line-soft)', marginTop: 3 }}><div style={{ width: `${(r.n / max) * 100}%`, height: 4, borderRadius: 2, background: 'var(--brand)' }} /></div>
          </div>
          <b className="num">{r.n}</b>
        </div>
      )) : <div className="muted" style={{ fontSize: 13 }}>Sem dados ainda.</div>}
    </div>
  );
}

export function Visits({ v }: { v: VisitsSummary }) {
  const t = v.totals, max = Math.max(1, ...v.series.map(s => s.visitors));
  const trend = t.previous ? Math.round(((t.visitors - t.previous) / t.previous) * 100) : null;
  return (
    <div className="card section" id="visitas">
      <h2>Visitas ao site · últimos {v.days} dias</h2>
      <div className="grid" style={{ padding: '12px 16px 0', marginBottom: 0 }}>
        <div className="card kpi"><div className="l">Hoje</div><div className="v">{t.today}</div><div className="muted">pessoas no site</div></div>
        <div className="card kpi"><div className="l">Últimos 7 dias</div><div className="v">{t.last7}</div><div className="muted">visitas</div></div>
        <div className="card kpi"><div className="l">Últimos {v.days} dias</div><div className="v">{t.visitors}</div><div className="muted">{trend === null ? `${t.views} páginas vistas` : `${trend >= 0 ? '+' : ''}${trend}% face aos ${v.days} dias anteriores`}</div></div>
        <div className="card kpi"><div className="l">Contas criadas</div><div className="v">{t.signups}</div><div className="muted">{t.confirmed === undefined ? 'Registos no período' : `${t.confirmed} com email confirmado`}</div></div>
      </div>
      <div style={{ padding: '16px 16px 4px' }}>
        <div aria-label="Visitas por dia" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
          {v.series.map(s => (
            <div key={s.day} title={`${day(s.day)}: ${s.visitors} visita(s)${s.signups ? `, ${s.signups} conta(s) criada(s)` : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              {s.signups > 0 && <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--terra)', margin: '0 auto 3px' }} />}
              <div style={{ height: `${Math.max(s.visitors ? 3 : 1, (s.visitors / max) * 100)}%`, background: s.visitors ? 'var(--brand)' : 'var(--line)', borderRadius: '3px 3px 0 0' }} />
            </div>
          ))}
        </div>
        <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginTop: 4 }}>
          <span>{day(v.from)}</span><span><span style={{ color: 'var(--terra)' }}>●</span> dia com contas criadas</span><span>{day(v.to)}</span>
        </div>
      </div>
      <div className="grid" style={{ padding: '8px 16px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Top title="De onde vêm" rows={v.referrers} label={k => k === 'directo' ? 'Directo ou WhatsApp' : k} />
        <Top title="Campanhas (utm_source)" rows={v.sources} />
        <Top title="Países" rows={v.countries} label={k => COUNTRY[k] ?? k} />
        <Top title="Dispositivo" rows={v.devices} label={k => DEVICE[k] ?? k} />
        <Top title="Páginas" rows={v.pages} label={k => PAGE[k] ?? k} />
      </div>
      <p className="muted" style={{ padding: '0 16px 14px', fontSize: 12 }}>Cada pessoa conta uma vez por página e por dia. Sem cookies e sem guardar o IP; robôs e pré-visualizações de links não contam. As visitas de quem já tem sessão iniciada não entram.</p>
    </div>
  );
}
