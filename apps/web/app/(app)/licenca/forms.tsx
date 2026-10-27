'use client';

import { formatKz } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

interface PriceRow { key: string; label: string; maxEmployees: number | null; prices: Record<string, { totalMinor: number; discountMinor: number } | null> }

export function RenewForm({ prices, currentTier, currentCycle, activeEmployees, cycles }: { prices: PriceRow[]; currentTier: string; currentCycle: string; activeEmployees: number; cycles: Record<string, { label: string }> }) {
  const { busy, error, run } = useMutation();
  const [tier, setTier] = useState(currentTier);
  const [cycle, setCycle] = useState(currentCycle);
  const p = prices.find((x) => x.key === tier)?.prices[cycle];
  return (
    <div className="form" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
      <label>Escalão
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          {prices.map((x) => <option key={x.key} value={x.key} disabled={x.maxEmployees !== null && x.maxEmployees < activeEmployees}>{x.label}</option>)}
        </select>
      </label>
      <label>Pagamento
        <select value={cycle} onChange={(e) => setCycle(e.target.value)}>{Object.entries(cycles).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select>
      </label>
      <button className="btn" disabled={busy || !p} onClick={() => run('/v1/billing/requests', 'POST', { kind: 'subscription', tierKey: tier, cycle })}>Gerar pedido de pagamento</button>
      <div className="wide" style={{ fontSize: 15 }}>{p ? <>Total: <b>{formatKz(p.totalMinor)}</b>{p.discountMinor ? <span className="muted"> (desconto de {formatKz(p.discountMinor)})</span> : null}</> : <span className="muted">Escalão sob consulta: contacte o suporte Kianda.</span>}</div>
      {error && <span className="err wide">{error}</span>}
    </div>
  );
}

export function ExtraSeatsForm({ priceMinor }: { priceMinor: number | null }) {
  const { busy, error, run } = useMutation();
  const [seats, setSeats] = useState(5);
  if (!priceMinor) return <p className="muted">O valor por colaborador extra é definido pela Kianda. Contacte o suporte se precisar de ultrapassar o limite do escalão.</p>;
  return (
    <div className="form" style={{ gridTemplateColumns: '160px 1fr auto', alignItems: 'end' }}>
      <label>Colaboradores extra<input type="number" min={1} value={seats} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} /></label>
      <div>Pagamento único: <b>{formatKz(priceMinor * seats)}</b> <span className="muted">({formatKz(priceMinor)} por colaborador)</span></div>
      <button className="btn ghost" disabled={busy} onClick={() => run('/v1/billing/requests', 'POST', { kind: 'extra_seats', seats })}>Gerar pedido</button>
      {error && <span className="err wide">{error}</span>}
    </div>
  );
}

export function ReferenceForm({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return (
    <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await run(`/v1/billing/requests/${id}/reference`, 'POST', { payerReference: f.get('ref'), payerNote: f.get('note') || null }); }}>
      <input name="ref" placeholder="Referência da transferência" required style={{ width: 230 }} />
      <input name="note" placeholder="Nota (opcional)" style={{ width: 200 }} />
      <button className="btn sm" disabled={busy}>Já paguei</button>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/billing/requests/${id}/cancel`, 'POST', {})}>Cancelar pedido</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </form>
  );
}

export function NewReference({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return (
    <>
      <button className="btn sm" disabled={busy} onClick={() => run(`/v1/billing/requests/${id}/multicaixa`, 'POST', {})}>Gerar referência Multicaixa</button>
      {error && <span className="err">{error}</span>}
    </>
  );
}
