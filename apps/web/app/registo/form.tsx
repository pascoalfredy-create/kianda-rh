'use client';

import { CYCLES, DEFAULT_TIERS, MODELING_PLANS, SECTORS, TRIAL_DAYS, VALUATION_PLANS } from '@kianda/core';
import type { RegistrationSelection } from '../../lib/registration-selection';
import Link from 'next/link';
import { useState } from 'react';
import { KiandaMark } from '../../components/kianda-mark';
import { AuthNavigation } from '../../components/auth-navigation';
import { PasswordInput } from '../../components/password-input';
import { jsonRequest } from '../../lib/json-request';

/** O cadastro cria a experiência gratuita; planos e pagamento ficam dentro da conta. */
export function RegistoForm({ selection = null }: { selection?: RegistrationSelection | null } = {}) {
  const chosen = selection?.planKey ? (selection.module === 'hr' ? DEFAULT_TIERS.find(t => t.key === selection.planKey)?.label : selection.module === 'modeling' ? MODELING_PLANS.find(p => p.key === selection.planKey)?.label : VALUATION_PLANS.find(p => p.key === selection.planKey)?.label) : null;
  const product = selection?.module === 'modeling' ? 'Integra' : selection?.module === 'valuation' ? 'Valora' : 'RH';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="auth-wrap" style={{ padding: '30px 16px' }}>
    <form className="card auth" style={{ maxWidth: 560 }} onSubmit={async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      if (f.get('password') !== f.get('password2')) return setError('As palavras-passe não coincidem.');
      setBusy(true); setError('');
      const estimate = Number(String(f.get('employees') ?? '').replace(/\D/g, '')) || undefined;
      // Plano escolhido numa ligação pública: fica registado para a subscrição (a avaliação gratuita é a mesma).
      const hrFits = (DEFAULT_TIERS.find(t => t.key === selection?.planKey)?.maxEmployees ?? Infinity) >= (estimate ?? 1);
      const plan = selection?.planKey && chosen ? (selection.module === 'hr' ? (hrFits ? { hrPlan: { tierKey: selection.planKey, cycle: selection.cycle } } : {})
        : selection.module === 'valuation' ? { valuationPlan: { key: selection.planKey, cycle: selection.cycle } }
        // Integra: o plano exige escolher os sectores, o que se faz em Módulos e licenças (a avaliação inclui todos).
        : {}) : {};
      const { res, body: j } = await jsonRequest('/api/v1/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...plan, company: { name: f.get('companyName'), nif: String(f.get('nif')).trim(), sector: f.get('sector'), address: f.get('address') || null, ...(estimate ? { employeesEstimate: estimate } : {}) }, name: f.get('name'), email: f.get('email'), password: f.get('password'), acceptTerms: f.get('terms') === 'on', modules: ['hr', 'modeling', 'valuation'] }),
      });
      setBusy(false);
      if (res.ok) return window.location.assign('/confirmar-email');
      setError(j.issues?.map((i: { message: string }) => i.message).join(' · ') || (j.error === 'duplicado' ? 'Já existe uma conta com este NIF ou email.' : j.message) || 'Não foi possível criar a conta.');
    }}>
      <AuthNavigation login />
      <div className="logo" style={{ padding: 0, marginBottom: 18 }}><KiandaMark size={34} /><div><b style={{ color: 'var(--ink)' }}>Kianda</b><small style={{ color: 'var(--ink3)' }}>RH · Integra · Valora</small></div></div>
      <h1 style={{ fontSize: 19, marginBottom: 4 }}>Criar a conta da empresa</h1>
      <p className="muted">Um mês grátis ({TRIAL_DAYS} dias), a partir da confirmação do email. Experimente os três módulos, introduza dados e pré-visualize os resultados. Os downloads e a impressão exigem uma subscrição paga.</p>
      {chosen && selection && <p className="ok" role="status">{selection.module === 'modeling' ? 'Plano de interesse' : 'Escolha guardada'}: {product} · {chosen} · pagamento {CYCLES[selection.cycle].label.toLowerCase()}. A avaliação é gratuita; {selection.module === 'modeling' ? 'escolha os sectores e confirme o plano em Módulos e licenças.' : 'a subscrição só começa quando a confirmar em Módulos e licenças.'}</p>}
      <p className="muted">Sem cartão nem cobrança automática. Depois de entrar na conta, pode consultar os limites do teste e escolher os planos e o pagamento em Módulos e licenças.</p>
      <h3 className="auth-section-title">Empresa</h3>
      <label>Denominação social<input name="companyName" required minLength={2} placeholder="Ex.: Kwanza Logística, Lda." /></label>
      <label>NIF da empresa *<input name="nif" required inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} title="Indique os 10 dígitos do NIF da empresa." placeholder="Obrigatório · 10 dígitos" /></label>
      <label>Sector de actividade<select name="sector" required defaultValue=""><option value="" disabled>— escolha —</option>{Object.entries(SECTORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Morada<input name="address" placeholder="Rua, n.º, bairro, município, Luanda" /></label>
      <label>Número aproximado de colaboradores<input name="employees" inputMode="numeric" pattern="[0-9 .]*" placeholder="Ex.: 45" /><small className="muted">Ajusta a faixa do teste do RH à sua equipa (pode importar todos os colaboradores durante a avaliação).</small></label>
      <h3 className="auth-section-title">Responsável pela conta</h3>
      <label>Nome<input name="name" required minLength={2} /></label>
      <label>Email<input name="email" type="email" required autoComplete="username" /></label>
      <label>Palavra-passe<PasswordInput aria-label="Palavra-passe" name="password" required autoComplete="new-password" minLength={10} /></label>
      <label>Confirmar palavra-passe<PasswordInput aria-label="Confirmar palavra-passe" name="password2" required autoComplete="new-password" /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" name="terms" required style={{ width: 'auto', marginTop: 3 }} /><span>Li e aceito os <Link href="/termos" target="_blank">termos de utilização e a política de privacidade</Link>.</span></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A criar…' : 'Criar conta e experimentar'}</button>
      <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>Já tem conta? <Link href="/login">Iniciar sessão</Link></p>
    </form>
  </div>;
}
