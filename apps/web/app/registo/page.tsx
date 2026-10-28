'use client';

import { CYCLES, DEFAULT_TIERS, FINANCIAL_SECTORS, MODELING_PLANS, MODELING_SECTOR_LABELS, defaultModelingSector, cyclePrice, modelingPlanPrice, formatKz, SECTORS, tierFor, TRIAL_DAYS, type BillingCycle, type FinancialSector, type ModelingPlanKey } from '@kianda/core';
import Link from 'next/link';
import { useState } from 'react';
import { ModelingSectors } from '@/components/modeling-sectors';

/** Uma conta de empresa, com escolha explícita dos módulos e respectivos planos. */
export default function Registo() {
  const [estimate, setEstimate] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hr, setHr] = useState(true);
  const [modeling, setModeling] = useState(false);
  const [hrTier, setHrTier] = useState('');
  const [hrCycle, setHrCycle] = useState<BillingCycle>('monthly');
  const [modelingKey, setModelingKey] = useState<ModelingPlanKey>('pme');
  const [modelingCycle, setModelingCycle] = useState<BillingCycle>('monthly');
  const [primarySector, setPrimarySector] = useState<FinancialSector>('servicos');
  const [modelingSectors, setModelingSectors] = useState<FinancialSector[]>(['servicos']);
  const selectedModelingPlan = MODELING_PLANS.find(p => p.key === modelingKey)!;
  const tier = DEFAULT_TIERS.find(t => t.key === hrTier) ?? tierFor(estimate);
  const price = cyclePrice(tier, hrCycle);
  const modelingPrice = modelingPlanPrice(modelingKey, modelingCycle);
  return (
    <div className="auth-wrap" style={{ padding: '30px 16px' }}>
      <form className="card auth" style={{ maxWidth: 560 }} onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!hr && !modeling) return setError('Escolha pelo menos um módulo.');
        if (f.get('password') !== f.get('password2')) return setError('As palavras-passe não coincidem');
        setBusy(true); setError('');
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company: { name: f.get('companyName'), nif: String(f.get('nif')).replace(/\D/g, ''), sector: f.get('sector'), address: f.get('address') || null, ...(hr ? { employeesEstimate: estimate } : {}) },
            name: f.get('name'), email: f.get('email'), password: f.get('password'), acceptTerms: f.get('terms') === 'on',
            modules: [hr ? 'hr' : '', modeling ? 'modeling' : ''].filter(Boolean),
            ...(hr ? { hrPlan: { tierKey: tier.key, cycle: hrCycle } } : {}),
            ...(modeling ? { modelingPlan: { key: modelingKey, cycle: modelingCycle, primarySector, sectors: modelingSectors } } : {}),
          }),
        });
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        if (res.ok) return window.location.assign('/licenca');
        setError(j.issues?.map((i: { message: string }) => i.message).join(' · ') || (j.error === 'duplicado' ? 'Já existe uma conta com este NIF ou email.' : j.message) || 'Não foi possível criar a conta');
      }}>
        <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
          <div className="mark">K</div>
          <div><b style={{ color: 'var(--ink)' }}>Kianda RH</b><small style={{ color: 'var(--ink3)' }}>Gestão de Pessoas · Angola</small></div>
        </div>
        <h1 style={{ fontSize: 19, marginBottom: 4 }}>Criar a conta da empresa</h1>
        <p className="muted" style={{ marginTop: 0 }}>{TRIAL_DAYS} dias grátis nos módulos escolhidos. Uma conta para RH e Modelagem Financeira. Sem cartão nem compromisso.</p>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 8px' }}>Empresa</h3>
        <label>Denominação social<input name="companyName" required placeholder="Ex.: Kwanza Logística, Lda." /></label>
        <label>NIF da empresa<input name="nif" required inputMode="numeric" placeholder="10 dígitos" /></label>
        <label>Sector de actividade
          <select name="sector" required defaultValue="" onChange={e => { const primary = defaultModelingSector(e.target.value); setPrimarySector(primary); setModelingSectors(selectedModelingPlan.sectorLimit === 8 ? [...FINANCIAL_SECTORS] : [primary]); }} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 9 }}>
            <option value="" disabled>— escolha —</option>
            {Object.entries(SECTORS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Morada<input name="address" placeholder="Rua, n.º, bairro, município, Luanda" /></label>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 8px' }}>Módulos e planos</h3>
        <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={hr} onChange={e => setHr(e.target.checked)} style={{ width: 'auto' }} />Recursos Humanos · Kianda RH</label>
        {hr && <>
          <label>N.º de colaboradores activos<input type="number" min={1} max={100000} value={estimate} onChange={(e) => { setEstimate(Math.max(1, Number(e.target.value) || 1)); setHrTier(''); }} /></label>
          <label>Plano RH<select value={tier.key} onChange={e => setHrTier(e.target.value)}>{DEFAULT_TIERS.map(t => <option key={t.key} value={t.key} disabled={t.maxEmployees !== null && t.maxEmployees < estimate}>{t.label}</option>)}</select></label>
          <label>Pagamento RH<select value={hrCycle} onChange={e => setHrCycle(e.target.value as BillingCycle)}>{Object.entries(CYCLES).map(([key, cycle]) => <option key={key} value={key}>{cycle.label}</option>)}</select></label>
          <div className="warn" style={{ margin: '4px 0 12px' }}>RH: <b>{price && formatKz(price.totalMinor)}</b> por ciclo {hrCycle === 'monthly' ? 'mensal' : hrCycle === 'semiannual' ? 'semestral, à vista' : 'anual, à vista'}. Só paga depois do período experimental.</div>
        </>}
        <label style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={modeling} onChange={e => setModeling(e.target.checked)} style={{ width: 'auto' }} />Modelagem Financeira · Kianda Integra</label>
        {modeling && <>
          <label>Plano de Modelagem<select value={modelingKey} onChange={e => { const key = e.target.value as ModelingPlanKey; setModelingKey(key); setModelingSectors(MODELING_PLANS.find(p => p.key === key)!.sectorLimit === 8 ? [...FINANCIAL_SECTORS] : [primarySector]); if (key === 'unlimited' && modelingCycle === 'monthly') setModelingCycle('semiannual'); }}>{MODELING_PLANS.map(p => <option key={p.key} value={p.key}>{p.label} · {p.projectLimit === null ? 'projectos ilimitados' : `até ${p.projectLimit} projectos`} · {p.sectorLimit} sectores</option>)}</select></label>
          <label>Pagamento da Modelagem<select value={modelingCycle} onChange={e => setModelingCycle(e.target.value as BillingCycle)}>{Object.entries(CYCLES).map(([key, cycle]) => <option key={key} value={key} disabled={key === 'monthly' && modelingKey === 'unlimited'}>{cycle.label}</option>)}</select></label>
          <label>Sector principal da Modelagem (registo)<select value={primarySector} onChange={e => { const primary = e.target.value as FinancialSector; setPrimarySector(primary); setModelingSectors(selectedModelingPlan.sectorLimit === 8 ? [...FINANCIAL_SECTORS] : [primary]); }}>{FINANCIAL_SECTORS.map(s => <option key={s} value={s}>{MODELING_SECTOR_LABELS[s]}</option>)}</select></label>
          <ModelingSectors planKey={modelingKey} primary={primarySector} selected={modelingSectors} onChange={setModelingSectors} />
          <div className="warn" style={{ margin: '4px 0 12px' }}>Modelagem: <b>{modelingPrice && formatKz(modelingPrice.totalMinor)}</b> por ciclo {modelingCycle === 'monthly' ? 'mensal' : modelingCycle === 'semiannual' ? 'semestral, à vista' : 'anual, à vista'}. Inclui 5 utilizadores e exportação em PDF. Utilizadores adicionais: 35.000 Kz/mês por acesso, contratados na licença.</div>
        </>}
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 8px' }}>Responsável pela conta</h3>
        <label>Nome<input name="name" required /></label>
        <label>Email<input name="email" type="email" required autoComplete="username" /></label>
        <label>Palavra-passe<input name="password" type="password" required autoComplete="new-password" minLength={10} /></label>
        <label>Confirmar palavra-passe<input name="password2" type="password" required autoComplete="new-password" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" name="terms" required style={{ width: 'auto', marginTop: 3 }} /> <span>Li e aceito os <Link href="/termos" target="_blank">termos de utilização e a política de privacidade</Link>.</span></label>
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="btn" disabled={busy || !hr && !modeling || modeling && modelingSectors.length !== selectedModelingPlan.sectorLimit} style={{ width: '100%' }}>{busy ? 'A criar…' : 'Criar conta e começar'}</button>
        <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>Já tem conta? <Link href="/login">Iniciar sessão</Link></p>
      </form>
    </div>
  );
}
