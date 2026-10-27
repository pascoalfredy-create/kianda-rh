'use client';

import { cyclePrice, formatKz, SECTORS, tierFor, TRIAL_DAYS } from '@kianda/core';
import Link from 'next/link';
import { useState } from 'react';

/** Registo self-service de uma empresa: período experimental com todos os módulos. */
export default function Registo() {
  const [estimate, setEstimate] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tier = tierFor(estimate);
  const price = cyclePrice(tier, 'monthly');
  return (
    <div className="auth-wrap" style={{ padding: '30px 16px' }}>
      <form className="card auth" style={{ maxWidth: 560 }} onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get('password') !== f.get('password2')) return setError('As palavras-passe não coincidem');
        setBusy(true); setError('');
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            company: { name: f.get('companyName'), nif: String(f.get('nif')).replace(/\D/g, ''), sector: f.get('sector'), address: f.get('address') || null, employeesEstimate: estimate },
            name: f.get('name'), email: f.get('email'), password: f.get('password'), acceptTerms: f.get('terms') === 'on',
          }),
        });
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        if (res.ok) return window.location.assign('/');
        setError(j.issues?.map((i: { message: string }) => i.message).join(' · ') || (j.error === 'duplicado' ? 'Já existe uma conta com este NIF ou email.' : j.message) || 'Não foi possível criar a conta');
      }}>
        <div className="logo" style={{ padding: 0, marginBottom: 18 }}>
          <div className="mark">K</div>
          <div><b style={{ color: 'var(--ink)' }}>Kianda RH</b><small style={{ color: 'var(--ink3)' }}>Gestão de Pessoas · Angola</small></div>
        </div>
        <h1 style={{ fontSize: 19, marginBottom: 4 }}>Criar a conta da empresa</h1>
        <p className="muted" style={{ marginTop: 0 }}>{TRIAL_DAYS} dias grátis com todos os módulos. Sem cartão nem compromisso.</p>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 8px' }}>Empresa</h3>
        <label>Denominação social<input name="companyName" required placeholder="Ex.: Kwanza Logística, Lda." /></label>
        <label>NIF da empresa<input name="nif" required inputMode="numeric" placeholder="10 dígitos" /></label>
        <label>Sector de actividade
          <select name="sector" required defaultValue="" style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 9 }}>
            <option value="" disabled>— escolha —</option>
            {Object.entries(SECTORS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Morada<input name="address" placeholder="Rua, n.º, bairro, município, Luanda" /></label>
        <label>N.º de colaboradores<input type="number" min={1} value={estimate} onChange={(e) => setEstimate(Math.max(1, Number(e.target.value) || 1))} /></label>
        <div className="warn" style={{ margin: '4px 0 12px' }}>
          Licença indicada: <b>{tier.label}</b> — {price ? <><b>{formatKz(price.totalMinor)}</b>/mês (semestral −10%, anual −20%)</> : 'proposta à medida'}. Só paga depois do período experimental.
        </div>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 8px' }}>Responsável pela conta</h3>
        <label>Nome<input name="name" required /></label>
        <label>Email<input name="email" type="email" required autoComplete="username" /></label>
        <label>Palavra-passe<input name="password" type="password" required autoComplete="new-password" minLength={10} /></label>
        <label>Confirmar palavra-passe<input name="password2" type="password" required autoComplete="new-password" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}><input type="checkbox" name="terms" required style={{ width: 'auto', marginTop: 3 }} /> <span>Li e aceito os <Link href="/termos" target="_blank">termos de utilização e a política de privacidade</Link>.</span></label>
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'A criar…' : 'Criar conta e começar'}</button>
        <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>Já tem conta? <Link href="/login">Iniciar sessão</Link></p>
      </form>
    </div>
  );
}
