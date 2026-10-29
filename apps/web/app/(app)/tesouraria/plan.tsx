'use client';

import { formatKz } from '@kianda/core';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { send } from '@/lib/client';
import { monthLabel } from '@/lib/format';
import type { PersonnelCash } from '@/lib/personnel';

export function CashPlan({ data, editable }: { data: PersonnelCash; editable: boolean }) {
  const [opening, setOpening] = useState(String(data.plan.openingMinor / 100));
  const [receipts, setReceipts] = useState(Object.fromEntries(data.months.map(m => [m.period, String((data.plan.receipts[m.period] ?? 0) / 100)])));
  const [revision, setRevision] = useState(data.plan.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const router = useRouter();
  useEffect(() => { if (!dirty) setRevision(data.plan.revision); }, [data.plan.revision]);
  const toMinor = (s: string) => Math.round(Number(s) * 100);
  let balance = Number.isFinite(Number(opening)) ? toMinor(opening) : 0;
  const months = data.months.map(m => { const initial = balance, incoming = Number.isFinite(Number(receipts[m.period])) ? toMinor(receipts[m.period] ?? '0') : 0; balance += incoming - m.salariesMinor - m.inssMinor - m.irtMinor - m.expensesMinor; return { ...m, openingMinor: initial, receiptsMinor: incoming, closingMinor: balance }; });
  const min = Math.min(...months.map(m => m.closingMinor)), max = Math.max(1, ...months.map(m => Math.abs(m.closingMinor)));
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const r = await send<{ revision: number }>('/v1/personnel-cash', 'PUT', { period: data.plan.period, openingMinor: toMinor(opening), receipts: Object.fromEntries(Object.entries(receipts).map(([p, v]) => [p, toMinor(v)])), revision });
      if (!r.ok) setError(r.message ?? 'Não foi possível guardar.');
      else { setRevision(r.data!.revision); setSaved(true); setDirty(false); router.refresh(); }
    } catch { setError('Sem ligação. Os valores introduzidos continuam neste ecrã; tente guardar novamente.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save}>
    <div className="rh-kpis"><div className="card kpi"><div className="l">Saldo inicial disponível (Kz)</div><input aria-label="Saldo inicial disponível" type="number" step="0.01" min={-1e11} max={1e11} value={opening} disabled={!editable || busy} onChange={e => { setOpening(e.target.value); setSaved(false); setDirty(true); }} /><div className="d">Saldo disponível à data da previsão</div></div><div className="card kpi"><div className="l">Saídas previstas · primeiro mês</div><div className="v">{formatKz(months[0]!.salariesMinor + months[0]!.inssMinor + months[0]!.irtMinor + months[0]!.expensesMinor)}</div><div className="d">Inclui obrigações anteriores por liquidar</div></div><div className="card kpi"><div className="l">Saldo mínimo projectado</div><div className="v" style={{ color: min < 0 ? 'var(--red)' : 'var(--brand)' }}>{formatKz(min)}</div><div className="d">{min < 0 ? 'Necessidade de cobertura de tesouraria' : 'Sem saldo negativo no horizonte'}</div></div><div className="card kpi"><div className="l">Saldo final · seis meses</div><div className="v">{formatKz(balance)}</div></div></div>
    <div className="card table-scroll"><table className="dense"><thead><tr><th>Mês</th><th className="num">Saldo inicial</th><th>Recebimentos previstos (Kz)</th><th className="num">Salários líquidos</th><th className="num">INSS</th><th className="num">IRT</th><th className="num">Despesas aprovadas</th><th className="num">Saldo final</th></tr></thead><tbody>{months.map(m => <tr key={m.period}><td><b>{monthLabel(m.period)}</b>{m.estimated && <small className="muted" style={{ display: 'block' }}>inclui estimativas</small>}{m.overdueMinor > 0 && <small className="muted" style={{ display: 'block' }}>atrasados: {formatKz(m.overdueMinor)}</small>}</td><td className="num">{formatKz(m.openingMinor)}</td><td><input style={{ width: 150 }} aria-label={`Recebimentos de ${monthLabel(m.period)}`} type="number" required step="0.01" min={0} max={1e11} value={receipts[m.period] ?? '0'} disabled={!editable || busy} onChange={e => { setReceipts({ ...receipts, [m.period]: e.target.value }); setSaved(false); setDirty(true); }} /></td><td className="num">{formatKz(m.salariesMinor)}</td><td className="num">{formatKz(m.inssMinor)}</td><td className="num">{formatKz(m.irtMinor)}</td><td className="num">{formatKz(m.expensesMinor)}</td><td className="num"><b style={{ color: m.closingMinor < 0 ? 'var(--red)' : undefined }}>{formatKz(m.closingMinor)}</b></td></tr>)}</tbody></table></div>
    <div className="actions no-print" style={{ margin: '12px 0' }}>{error && <span className="err" role="alert">{error}</span>}{saved && <span style={{ color: 'var(--brand)' }} role="status">Pressupostos guardados</span>}{editable && <button className="btn" disabled={busy}>{busy ? 'A guardar…' : 'Guardar pressupostos'}</button>}<button type="button" className="btn ghost" onClick={() => window.print()}>Imprimir / PDF</button></div>
    <div className="card"><div className="rh-card-head"><h2>Saldo final projectado</h2><span className="muted">Kz</span></div><div className="cash-columns">{months.map(m => <div className="cash-column" key={m.period}><b>{formatKz(m.closingMinor)}</b><i style={{ height: `${Math.max(2, Math.abs(m.closingMinor) / max * 140)}px`, background: m.closingMinor < 0 ? 'var(--red)' : 'var(--brand2)' }} /><small>{monthLabel(m.period)}</small></div>)}</div></div>
    <p className="muted" style={{ margin: '14px 0', fontSize: 12 }}>O saldo inicial e os recebimentos são pressupostos manuais. Os pagamentos já registados não voltam a sair da previsão; as obrigações vencidas por pagar entram no primeiro mês. Meses sem processamento fechado são estimados com os contratos, remunerações e subsídios recorrentes conhecidos, sem horas extra, faltas, prémios ou acréscimos variáveis de horário. Subsídio de férias projectado no mês {data.holidayMonth}; não substitui o processamento efectivo nem inclui admissões hipotéticas do orçamento.</p>
    {data.warnings.map(w => <div className="warn" key={w}>{w}</div>)}
  </form>;
}
