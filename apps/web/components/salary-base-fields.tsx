'use client';

import { useState } from 'react';
import { convertUsdMinor, formatKz, parseFxRate, parseAmount } from '@kianda/core';

const num = (s: string) => (parseAmount(s) ?? 0) / 100;

/**
 * Salário base em Kz ou indexado ao dólar. Em USD, o campo «base» enviado é a referência em Kz ao câmbio indicado
 * (orçamento, relatórios, salário mínimo); o processamento converte ao câmbio do dia.
 */
export function SalaryBaseFields({ currency = 'AOA', baseKz = '', baseUsd = '', onBaseKz }: { currency?: string; baseKz?: string; baseUsd?: string; onBaseKz?: (kz: string) => void }) {
  const [cur, setCur] = useState(currency === 'USD' ? 'USD' : 'AOA');
  const [kz, setKz] = useState(baseKz);
  const [usd, setUsd] = useState(baseUsd);
  const [rate, setRate] = useState(baseUsd && baseKz && num(baseUsd) ? String(Math.round((num(baseKz) / num(baseUsd)) * 100) / 100).replace('.', ',') : '');
  const fx = parseFxRate(rate);
  const reference = cur === 'USD' && fx && num(usd) > 0 ? convertUsdMinor(Math.round(num(usd) * 100), fx) : null;
  const setReference = (v: string) => { setKz(v); onBaseKz?.(v); };
  return <>
    <label>Moeda do salário base
      <select name="currency" value={cur} onChange={e => { setCur(e.target.value); if (e.target.value === 'AOA') onBaseKz?.(kz); }}>
        <option value="AOA">Kwanza (Kz)</option>
        <option value="USD">Dólar (USD) · indexado</option>
      </select>
    </label>
    {cur === 'AOA' ? <label>Salário base (Kz)<input name="base" inputMode="decimal" required value={kz} onChange={e => setReference(e.target.value)} /></label> : <>
      <label>Salário base (USD)<input name="baseUsd" inputMode="decimal" required value={usd} onChange={e => { setUsd(e.target.value); const f = parseFxRate(rate); if (f) onBaseKz?.(String(convertUsdMinor(Math.round(num(e.target.value) * 100), f) / 100)); }} /></label>
      <label>Câmbio de referência (Kz por USD)<input inputMode="decimal" required value={rate} placeholder="ex.: 912,50" onChange={e => { setRate(e.target.value); const f = parseFxRate(e.target.value); if (f) onBaseKz?.(String(convertUsdMinor(Math.round(num(usd) * 100), f) / 100)); }} /></label>
      <input type="hidden" name="base" value={reference === null ? '' : String(reference / 100)} />
      <p className="muted wide">Salário indexado: o recibo paga em kwanzas ao câmbio do dia do processamento (indicado em cada mês). {reference !== null ? <>Referência em Kz para o orçamento, os relatórios e o salário mínimo: <b>{formatKz(reference)}</b>.</> : 'Indique o câmbio de referência para estimar o valor em Kz.'}</p>
    </>}
  </>;
}
