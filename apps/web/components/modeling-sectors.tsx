'use client';

import { FINANCIAL_SECTORS, MODELING_PLANS, MODELING_SECTOR_LABELS, type FinancialSector } from '@kianda/core';

export function ModelingSectors({ planKey, primary, selected, onChange }: { planKey: string; primary: FinancialSector; selected: FinancialSector[]; onChange: (value: FinancialSector[]) => void }) {
  const limit = MODELING_PLANS.find(p => p.key === planKey)!.sectorLimit;
  return <fieldset className="wide" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
    <legend>Sectores da Modelagem · {selected.length} de {limit}</legend>
    <p className="muted">Sector principal do registo: <b>{MODELING_SECTOR_LABELS[primary]}</b>. {limit === 8 ? 'Este plano inclui os 8 sectores.' : `Escolha mais ${limit - 1} sector(es). O número de projectos é um limite separado.`}</p>
    {FINANCIAL_SECTORS.map(sector => <label key={sector} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <input type="checkbox" name="modelingSector" value={sector} checked={selected.includes(sector)} disabled={sector === primary || limit === 8 || selected.length >= limit && !selected.includes(sector)} onChange={e => onChange(e.target.checked ? [...selected, sector] : selected.filter(s => s !== sector))} style={{ width: 'auto', height: 'auto', margin: 0 }} />
      {MODELING_SECTOR_LABELS[sector]}{sector === primary ? ' (principal)' : ''}
    </label>)}
  </fieldset>;
}
