'use client';

import { calculatePayroll, formatKz, kz, type PayrollResult } from '@kianda/core';
import { useMemo, useState } from 'react';

/** O simulador corre o mesmo motor da API directamente no navegador — os números são idênticos. */
export default function Simulador() {
  const [base, setBase] = useState(420000);
  const [meal, setMeal] = useState(30000);
  const [transport, setTransport] = useState(25000);
  const [overtime, setOvertime] = useState(0);
  const [period, setPeriod] = useState('2026-10');

  const result = useMemo<{ r?: PayrollResult; error?: string }>(() => {
    try {
      return { r: calculatePayroll({ period, baseMinor: kz(base), mealMinor: kz(meal), transportMinor: kz(transport), overtimeHours: overtime }) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [base, meal, transport, overtime, period]);

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value) || 0);

  return (
    <>
      <h1>Simulador salarial</h1>
      <p className="sub">IRT Grupo A, INSS 3% e 8%, subsídios isentos até ao limite legal — regras do pacote do ano escolhido</p>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form">
          <label>Período<input value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <label>Salário base (Kz)<input type="number" value={base} onChange={num(setBase)} /></label>
          <label>Subsídio de alimentação (Kz)<input type="number" value={meal} onChange={num(setMeal)} /></label>
          <label>Subsídio de transporte (Kz)<input type="number" value={transport} onChange={num(setTransport)} /></label>
          <label>Horas extra<input type="number" value={overtime} onChange={num(setOvertime)} /></label>
        </div>
      </div>
      {result.error && <div className="alert">{result.error}</div>}
      {result.r && (
        <>
          <div className="grid">
            <div className="card kpi"><div className="l">Ilíquido</div><div className="v">{formatKz(result.r.grossMinor)}</div></div>
            <div className="card kpi"><div className="l">IRT (escalão {result.r.irtBracket})</div><div className="v">{formatKz(result.r.irtMinor)}</div></div>
            <div className="card kpi"><div className="l">Líquido</div><div className="v" style={{ color: 'var(--brand)' }}>{formatKz(result.r.netMinor)}</div></div>
            <div className="card kpi"><div className="l">Custo para a empresa</div><div className="v">{formatKz(result.r.totalCostMinor)}</div></div>
          </div>
          <div className="card">
            <table>
              <thead><tr><th>Rubrica</th><th>Tipo</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {result.r.lines.map((l) => (
                  <tr key={l.code}><td>{l.name}</td><td className="muted">{{ earning: 'Abono', deduction: 'Desconto', employer: 'Encargo da empresa' }[l.kind]}</td><td className="num">{formatKz(l.amountMinor)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>Regras: {result.r.packVersion} · matéria colectável {formatKz(result.r.irtTaxableMinor)}</p>
        </>
      )}
    </>
  );
}
