'use client';

import { estimateMaternityBenefit, formatKz, parseAmount } from '@kianda/core';
import { useState, type FormEvent } from 'react';

export function MaternityEstimate() {
  const [result, setResult] = useState<ReturnType<typeof estimateMaternityBenefit>>();
  const [error, setError] = useState('');

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const contributionMonths = Number(data.get('contributions'));
    const target = String(data.get('target') ?? '').trim();
    try {
      setResult(estimateMaternityBenefit({
        contributionMonths,
        declaredRegularRemunerations: data.getAll('remuneration').map(value => parseAmount(String(value)) ?? NaN),
        employerTargetMinor: target ? parseAmount(target) ?? NaN : 0,
      }));
      setError('');
    } catch (cause) {
      setResult(undefined);
      setError(cause instanceof Error ? cause.message : 'Confira os valores introduzidos.');
    }
  }

  return (
    <details className="card" style={{ marginBottom: 14 }}>
      <summary>Apurar subsídio de maternidade</summary>
      <p className="muted">Estimativa para o regime geral de três meses, ao abrigo do Decreto Presidencial n.º 95/26, em vigor desde 22 de Maio de 2026. Use as remunerações declaradas antes da licença, excluindo férias, Natal e outras prestações não regulares. Pré-licença, parto múltiplo e outras situações especiais requerem apuramento próprio.</p>
      <form onSubmit={calculate} onChange={() => { setResult(undefined); setError(''); }}>
        <label>Meses com contribuições nos últimos 36 meses<input name="contributions" type="number" min="0" max="36" step="1" required /></label>
        <fieldset>
          <legend>Últimas 12 remunerações regulares declaradas (Kz)</legend>
          {Array.from({ length: 12 }, (_, index) => (
            <label key={index}>Remuneração {index + 1}<input name="remuneration" inputMode="decimal" /></label>
          ))}
        </fieldset>
        <label>Valor total que a empresa pretende assegurar no período (Kz, opcional)
          <input name="target" inputMode="decimal" />
        </label>
        <p className="muted">Para assegurar apenas o salário-base durante os três meses, indique o total de três salários-base. O subsídio legal mantém o seu valor e o complemento da empresa cobre apenas a diferença positiva.</p>
        <button type="submit" className="btn">Calcular estimativa</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && <div role="status">
        <p>Subsídio legal estimado: <b>{formatKz(result.statutoryMinor)}</b></p>
        {!result.meetsContributionRequirement && <p>Com os dados indicados, o prazo contributivo de garantia não está preenchido.</p>}
        <p>Complemento a cargo da empresa: <b>{formatKz(result.employerSupplementMinor)}</b></p>
        <p className="muted">Confirme os dados declarados antes de processar. O pedido de reembolso à Segurança Social diz respeito ao subsídio legal efectivamente pago. A estimativa serve de apoio ao lançamento manual e ao pedido de reembolso.</p>
      </div>}
    </details>
  );
}
