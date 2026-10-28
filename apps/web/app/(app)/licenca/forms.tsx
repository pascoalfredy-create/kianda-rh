'use client';

import { CYCLES, FINANCIAL_SECTORS, MODELING_PLANS, MODELING_EXTRA_USER_MONTHLY_MINOR, modelingPlanPrice, formatKz, type BillingCycle, type FinancialSector } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';
import { ModelingSectors } from '@/components/modeling-sectors';

interface PriceRow { key: string; label: string; maxEmployees: number | null; prices: Record<string, { totalMinor: number; discountMinor: number } | null> }

export function ModelingPlanForm({ currentPlan, currentCycle, extraUsers, activeProjects, enabledUsers, primarySector, currentSectors }: { currentPlan: string | null; currentCycle: string | null; extraUsers: number; activeProjects: number; enabledUsers: number; primarySector: FinancialSector; currentSectors: FinancialSector[] }) {
  const { busy, error, run } = useMutation();
  const suitable = (p: typeof MODELING_PLANS[number]) => p.projectLimit === null || p.projectLimit >= activeProjects;
  const initial = MODELING_PLANS.find(p => p.key === currentPlan && suitable(p)) ?? MODELING_PLANS.find(suitable)!;
  const [plan, setPlan] = useState<string>(initial.key);
  const [sectors, setSectors] = useState<FinancialSector[]>(initial.sectorLimit === 8 ? [...FINANCIAL_SECTORS] : [primarySector, ...currentSectors.filter(s => s !== primarySector)].slice(0, initial.sectorLimit));
  const [cycle, setCycle] = useState<BillingCycle>(initial.key === 'unlimited' && (!currentCycle || currentCycle === 'monthly') ? 'semiannual' : (currentCycle as BillingCycle) || 'monthly');
  const [extras, setExtras] = useState(Math.max(extraUsers, enabledUsers - 5, 0));
  const price = modelingPlanPrice(plan, cycle, extras);
  return <div className="form" style={{ alignItems: 'end' }}>
    <label>Plano de Modelagem<select value={plan} onChange={e => { setPlan(e.target.value); setSectors(MODELING_PLANS.find(p => p.key === e.target.value)!.sectorLimit === 8 ? [...FINANCIAL_SECTORS] : [primarySector]); if (e.target.value === 'unlimited' && cycle === 'monthly') setCycle('semiannual'); }}>{MODELING_PLANS.map(p => <option key={p.key} value={p.key} disabled={!suitable(p)}>{p.label} · {p.sectorLimit} sectores</option>)}</select></label>
    <label>Pagamento<select value={cycle} onChange={e => setCycle(e.target.value as BillingCycle)}>{Object.entries(CYCLES).map(([key, c]) => <option key={key} value={key} disabled={plan === 'unlimited' && key === 'monthly'}>{c.label}</option>)}</select></label>
    <label>Utilizadores extra além dos 5 incluídos<input type="number" min={Math.max(0, enabledUsers - 5)} max={100000} value={extras} onChange={e => setExtras(Math.max(0, Number(e.target.value) || 0))} /></label>
    <ModelingSectors planKey={plan} primary={primarySector} selected={sectors} onChange={setSectors} />
    <div className="wide">{price ? <>Total do ciclo: <b>{formatKz(price.totalMinor)}</b>{price.discountMinor ? <span className="muted"> · desconto do plano: {formatKz(price.discountMinor)}</span> : null}{extras > 0 && <div className="muted">Inclui {formatKz(price.extraMinor)} por {extras} utilizador(es) extra, a {formatKz(MODELING_EXTRA_USER_MONTHLY_MINOR)}/mês durante {CYCLES[cycle].months} mês(es), sem desconto nos extras.</div>}</> : 'Este plano não está disponível no ciclo escolhido.'}</div>
    <p className="muted wide">A quota só muda após confirmação do pagamento. O efectivo do RH não altera o número de acessos da Modelagem. Pode reduzir o plano depois de arquivar projectos ou retirar acessos excedentes.</p>
    <div className="form-actions wide">{error && <span className="err">{error}</span>}<button className="btn" disabled={busy || !price || extras < enabledUsers - 5 || sectors.length !== MODELING_PLANS.find(p => p.key === plan)!.sectorLimit} onClick={() => run('/v1/billing/requests', 'POST', { kind: 'modeling_subscription', planKey: plan, cycle, extraUsers: extras, sectors })}>Gerar pedido de pagamento da Modelagem</button></div>
  </div>;
}

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
