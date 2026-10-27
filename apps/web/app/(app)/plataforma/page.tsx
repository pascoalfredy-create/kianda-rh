import { DEFAULT_TIERS, formatKz } from '@kianda/core';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { ConfirmPayment, EditSubscription, SettingsForm } from './forms';

export const dynamic = 'force-dynamic';

interface Co { id: string; name: string; nif: string; sectorLabel: string | null; code: string | null; createdAt: string | null; owner: { email: string; name: string } | null; activeEmployees: number; status: string; statusLabel: string; tierKey: string | null; tierLabel: string; cycle: string | null; limit: number | null; trialEndsAt: string | null; paidUntil: string | null; extraSeats: number; notes: string | null; monthlyMinor: number | null; pendingPayments: number }
interface Pay { id: string; number: string; company: string; nif: string; kind: string; tierKey: string | null; cycle: string | null; seats: number | null; periodStart: string | null; periodEnd: string | null; amountMinor: number; payerReference: string | null; payerNote: string | null; createdAt: string }
const pt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const ST: Record<string, string> = { trial: 'st pending', active: 'st approved', past_due: 'st pending', suspended: 'st rejected', cancelled: 'tag' };

export default async function Plataforma() {
  const me = (await currentUser())!;
  if (!me.platformAdmin) redirect('/');
  const [{ companies, summary }, pays, settings] = await Promise.all([
    api<{ companies: Co[]; summary: { total: number; trial: number; active: number; pastDue: number; suspended: number; mrrMinor: number } }>('/v1/platform/companies'),
    api<Pay[]>('/v1/platform/payment-requests'),
    api<{ extraSeatMinor: number | null; bank: { holder: string; bankName: string; iban: string } | null; supportContact: string | null; admins: string[] }>('/v1/platform/settings'),
  ]);
  return (
    <>
      <h1>Plataforma Kianda</h1>
      <p className="sub">Empresas clientes, licenças e pagamentos · administradores: {settings.admins.join(', ')}</p>
      <div className="grid">
        <div className="card kpi"><div className="l">Empresas</div><div className="v">{summary.total}</div><div className="muted">{summary.trial} em experimental</div></div>
        <div className="card kpi"><div className="l">Activas (pagas)</div><div className="v">{summary.active}</div><div className="muted">{summary.pastDue} em atraso · {summary.suspended} suspensas</div></div>
        <div className="card kpi"><div className="l">Receita mensal recorrente</div><div className="v">{formatKz(summary.mrrMinor)}</div><div className="muted">valor mensal das licenças pagas</div></div>
        <div className="card kpi" style={pays.length ? { borderColor: '#f3d9a6' } : undefined}><div className="l">Pagamentos por confirmar</div><div className="v" style={{ color: pays.length ? 'var(--amber)' : undefined }}>{pays.length}</div></div>
      </div>
      {pays.length > 0 && (
        <div className="card section">
          <h2>Pagamentos por confirmar</h2>
          <table className="dense">
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.number}</b><div className="muted">{p.company} · NIF {p.nif}</div></td>
                  <td>{p.kind === 'subscription' ? `${DEFAULT_TIERS.find((t) => t.key === p.tierKey)?.label} · ${p.cycle} · ${pt(p.periodStart)}–${pt(p.periodEnd)}` : `${p.seats} extra`}<div><b>{formatKz(p.amountMinor)}</b></div></td>
                  <td>{p.payerReference ? <>Ref.: <b>{p.payerReference}</b>{p.payerNote ? <div className="muted">{p.payerNote}</div> : null}</> : <span className="muted">sem referência indicada</span>}</td>
                  <td className="num"><ConfirmPayment id={p.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead><tr><th>Empresa</th><th>Responsável</th><th>Licença</th><th className="num">Colaboradores</th><th>Validade</th><th /></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} style={{ verticalAlign: 'top' }}>
                <td><b>{c.name}</b><div className="muted">NIF {c.nif} · código {c.code ?? '—'}{c.sectorLabel ? ` · ${c.sectorLabel}` : ''}</div>{c.notes && <div className="muted">{c.notes}</div>}</td>
                <td>{c.owner?.name ?? '—'}<div className="muted">{c.owner?.email}</div></td>
                <td><span className={ST[c.status]}>{c.statusLabel}</span><div className="muted">{c.tierLabel}{c.cycle ? ` · ${c.cycle}` : ''}</div></td>
                <td className="num">{c.activeEmployees}{c.limit ? ` / ${c.limit}` : ''}</td>
                <td>{c.status === 'trial' ? `experimental até ${pt(c.trialEndsAt)}` : `pago até ${pt(c.paidUntil)}`}{c.pendingPayments ? <div><span className="tag future">{c.pendingPayments} pagamento(s) pendente(s)</span></div> : null}</td>
                <td className="num"><EditSubscription c={c} tiers={DEFAULT_TIERS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card section" style={{ marginTop: 16 }}><h2>Parâmetros comerciais</h2><SettingsForm s={settings} /></div>
    </>
  );
}
