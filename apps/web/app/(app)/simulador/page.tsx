'use client';

import { baseForNet, calculatePayroll, convertUsdMinor, formatFxRate, indexedBaseLabel, formatKz, formatUsd, kz, parseFxRate, type PayrollInput, type PayrollResult } from '@kianda/core';
import { useMemo, useState } from 'react';

type Mode = 'net' | 'gross';
const num = (s: string) => { const n = Number(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const thisMonth = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);

/**
 * Simulador salarial: do líquido pretendido ao salário base (cálculo inverso ao cêntimo) ou do salário base ao líquido,
 * com o mesmo motor do processamento, a correr no navegador. Salário em USD convertido ao câmbio indicado.
 */
export default function Simulador() {
  const [mode, setMode] = useState<Mode>('net');
  const [period, setPeriod] = useState(thisMonth());
  const [target, setTarget] = useState('500000');
  const [base, setBase] = useState('420000');
  const [usd, setUsd] = useState(false);
  const [baseUsd, setBaseUsd] = useState('1500');
  const [rate, setRate] = useState('');
  const [meal, setMeal] = useState('30000');
  const [transport, setTransport] = useState('25000');
  const [other, setOther] = useState('0');
  const [deductions, setDeductions] = useState('0');
  const [overtime, setOvertime] = useState('0');
  const [allowancesInInss, setAllowancesInInss] = useState(false);
  const [otherInInss, setOtherInInss] = useState(true);
  const [otherInIrt, setOtherInIrt] = useState(true);
  const fx = usd ? parseFxRate(rate) : null;

  const out = useMemo<{ r?: PayrollResult; baseMinor?: number; error?: string }>(() => {
    try {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { error: 'Indique o mês (AAAA-MM).' };
      const common: Omit<PayrollInput, 'baseMinor'> = {
        period, mealMinor: kz(num(meal)), transportMinor: kz(num(transport)), otherDeductionsMinor: kz(num(deductions)), allowancesInInss,
        otherEarnings: num(other) ? [{ code: 'OUTABN', name: 'Outros abonos', amountMinor: kz(num(other)), inInss: otherInInss, inIrt: otherInIrt }] : [],
        overtimeHours: mode === 'gross' ? num(overtime) : 0,
      };
      if (mode === 'net') {
        const found = baseForNet(common, kz(num(target)));
        return found ? { r: found.result, baseMinor: found.baseMinor } : { error: 'Não foi possível chegar a esse líquido.' };
      }
      if (usd && !fx) return { error: 'Indique o câmbio USD→Kz do dia.' };
      const usdMinor = Math.round(num(baseUsd) * 100);
      const baseMinor = usd ? convertUsdMinor(usdMinor, fx!) : kz(num(base));
      return { r: calculatePayroll({ ...common, baseMinor, baseLabel: usd ? indexedBaseLabel(usdMinor, fx!) : undefined }), baseMinor };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [mode, period, target, base, usd, baseUsd, fx, meal, transport, other, deductions, overtime, allowancesInInss, otherInInss, otherInIrt]);

  const r = out.r;
  const allowances = r ? r.lines.filter(l => l.kind === 'earning' && l.code !== 'BASE').reduce((s, l) => s + l.amountMinor, 0) : 0;
  const other$ = r ? r.lines.filter(l => l.kind === 'deduction' && l.code !== 'INSS' && l.code !== 'IRT').reduce((s, l) => s + l.amountMinor, 0) : 0;
  const usdOfBase = fx && out.baseMinor ? Math.round((out.baseMinor / fx)) : null;
  const field = (label: string, value: string, set: (v: string) => void, extra?: React.ReactNode) =>
    <label>{label}<input inputMode="decimal" value={value} onChange={e => set(e.target.value)} />{extra}</label>;
  const check = (label: string, value: boolean, set: (v: boolean) => void) =>
    <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 500 }}><input type="checkbox" checked={value} onChange={e => set(e.target.checked)} style={{ height: 'auto' }} />{label}</label>;

  return (
    <>
      <h1>Simulador salarial</h1>
      <p className="sub">Quanto é preciso pagar para dar um certo líquido, ou quanto fica de um salário. As contas são as do processamento.</p>
      <nav className="tabs" role="tablist">
        {([['net', 'Líquido pretendido → salário base'], ['gross', 'Salário base → líquido']] as const).map(([m, label]) =>
          <a key={m} href="#" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={e => { e.preventDefault(); setMode(m); }}>{label}</a>)}
      </nav>
      <div className="card section">
        <div className="form">
          <label>Mês<input type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label>
          {mode === 'net' ? field('Líquido pretendido (Kz)', target, setTarget)
            : usd ? field('Salário base (USD)', baseUsd, setBaseUsd) : field('Salário base (Kz)', base, setBase)}
          {field('Subsídio de alimentação (Kz)', meal, setMeal)}
          {field('Subsídio de transporte (Kz)', transport, setTransport)}
          {field('Outros abonos (Kz)', other, setOther)}
          {field('Outros descontos após IRT (Kz)', deductions, setDeductions)}
          {mode === 'gross' && field('Horas extra', overtime, setOvertime)}
          <h3>Salário indexado ao dólar</h3>
          {check('Contrato em USD, pago em Kz ao câmbio do dia', usd, setUsd)}
          {usd && field('Câmbio USD→Kz do dia', rate, setRate)}
          <h3>Incidências</h3>
          {check('Alimentação e transporte incidem INSS', allowancesInInss, setAllowancesInInss)}
          {check('Outros abonos incidem INSS', otherInInss, setOtherInInss)}
          {check('Outros abonos incidem IRT', otherInIrt, setOtherInIrt)}
          <p className="muted wide">IRT Grupo A, mês normal. Alimentação e transporte isentos de IRT até 30 000 Kz cada; no processamento ficam fora do INSS. Confirme as incidências do contrato antes da folha.</p>
        </div>
      </div>

      {out.error && <div className="alert">{out.error}</div>}
      {r && out.baseMinor !== undefined && (
        <>
          <div className="grid">
            <div className="card kpi"><div className="l">{mode === 'net' ? 'Salário base necessário' : 'Salário base'}</div><div className="v">{formatKz(out.baseMinor)}</div>
              {usd && (mode === 'gross' ? <div className="muted">{formatUsd(Math.round(num(baseUsd) * 100))} × {fx ? formatFxRate(fx) : '—'} Kz</div> : usdOfBase !== null ? <div className="muted">≈ {formatUsd(usdOfBase)} ao câmbio de {formatFxRate(fx!)} Kz</div> : null)}</div>
            <div className="card kpi"><div className="l">Salário líquido</div><div className="v" style={{ color: 'var(--brand)' }}>{formatKz(r.netMinor)}</div></div>
            <div className="card kpi"><div className="l">IRT (escalão {r.irtBracket})</div><div className="v">{formatKz(r.irtMinor)}</div></div>
            <div className="card kpi"><div className="l">Custo mensal para a empresa</div><div className="v">{formatKz(r.totalCostMinor)}</div></div>
          </div>
          <div className="two">
            <div className="card section">
              <h2>Resultado</h2>
              <table className="dense"><tbody>
                <tr><td>Salário base bruto{mode === 'net' ? ' necessário' : ''}</td><td className="num"><b>{formatKz(out.baseMinor)}</b></td></tr>
                <tr><td>Abonos totais</td><td className="num">{formatKz(allowances)}</td></tr>
                <tr><td>Bruto total pago</td><td className="num"><b>{formatKz(r.grossMinor)}</b></td></tr>
                <tr><td>Base de incidência do INSS</td><td className="num">{formatKz(r.inssBaseMinor)}</td></tr>
                <tr><td>INSS do trabalhador (3%)</td><td className="num">−{formatKz(r.inssEmployeeMinor)}</td></tr>
                <tr><td>Base tributável de IRT</td><td className="num">{formatKz(r.irtTaxableMinor)}</td></tr>
                <tr><td>IRT (escalão {r.irtBracket})</td><td className="num">−{formatKz(r.irtMinor)}</td></tr>
                <tr><td>Outros descontos</td><td className="num">{other$ ? `−${formatKz(other$)}` : formatKz(0)}</td></tr>
                <tr><td><b>Salário líquido calculado</b></td><td className="num"><b style={{ color: 'var(--brand)' }}>{formatKz(r.netMinor)}</b></td></tr>
                {mode === 'net' && <tr><td>Diferença para o objectivo</td><td className="num">{formatKz(r.netMinor - kz(num(target)))}</td></tr>}
                <tr><td>INSS da empresa (8%)</td><td className="num">{formatKz(r.inssEmployerMinor)}</td></tr>
                <tr><td><b>Custo mensal para a empresa</b></td><td className="num"><b>{formatKz(r.totalCostMinor)}</b></td></tr>
              </tbody></table>
            </div>
            <div className="card section">
              <h2>Recibo simulado</h2>
              <table className="dense">
                <thead><tr><th>Rubrica</th><th>Tipo</th><th className="num">Valor</th></tr></thead>
                <tbody>{r.lines.map((l) => <tr key={l.code}><td>{l.name}</td><td className="muted">{{ earning: 'Abono', deduction: 'Desconto', employer: 'Encargo da empresa' }[l.kind]}</td><td className="num">{formatKz(l.amountMinor)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          {mode === 'net' && <p className="muted">Cálculo inverso: o menor salário base, ao cêntimo, cujo líquido atinge o pretendido.</p>}
        </>
      )}
    </>
  );
}
