'use client';
import { ExportLink } from '@/components/document-export';


import { formatKz } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send, useMutation } from '@/lib/client';
import { monthLabel } from '@/lib/format';

export interface Dept { id: string; name: string; costCenter: string }
interface Hire { departmentId: string | null; from: string; count: number; baseMinor: number; mealMinor: number; transportMinor: number }
export interface Assumptions { year: number; increaseBps: number; increaseFrom: string; holidayMonth: number; christmasMonth: number; hires: Hire[] }
interface Sim { months: { period: string; costMinor: number; headcount: number }[]; totalMinor: number; packVersion: string; staff: number }

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const kzIn = (s: string) => { const t = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'); const n = Number(t); return t && Number.isFinite(n) ? Math.round(n * 100) : 0; };
const kzOut = (m: number) => (m ? String(m / 100).replace('.', ',') : '');

/** Hipóteses → simulação → criar (ou recalcular) o orçamento. */
export function BudgetPlanner({ init, departments, budgetId }: { init: Assumptions; departments: Dept[]; budgetId?: string }) {
  const router = useRouter();
  const [a, setA] = useState<Assumptions>(init);
  const [sim, setSim] = useState<Sim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const periods = MONTHS.map((_, i) => `${a.year}-${String(i + 1).padStart(2, '0')}`);
  const set = (p: Partial<Assumptions>) => { setA({ ...a, ...p }); setSim(null); };
  const setHire = (i: number, p: Partial<Hire>) => set({ hires: a.hires.map((h, j) => (j === i ? { ...h, ...p } : h)) });

  async function call(path: string) {
    setBusy(true); setError('');
    const r = await send<Sim>(path, 'POST', a);
    setBusy(false);
    if (!r.ok) { setError(r.message ?? 'Erro'); return null; }
    return r;
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 14, marginTop: 0 }}>{budgetId ? 'Recalcular com novas hipóteses' : `Hipóteses para ${a.year}`}</h2>
      <p className="muted" style={{ marginTop: 0 }}>Parte do quadro activo hoje (salário em vigor, alimentação, transporte e subsídios atribuídos; contratos a termo terminam na data prevista).</p>
      <div className="form cols4">
        <label>Aumento salarial (%)<input inputMode="decimal" defaultValue={String(a.increaseBps / 100).replace('.', ',')} onChange={(e) => set({ increaseBps: Math.round(Number(e.target.value.replace(',', '.') || 0) * 100) })} /></label>
        <label>A partir de<select value={a.increaseFrom} onChange={(e) => set({ increaseFrom: e.target.value })}>{periods.map((p, i) => <option key={p} value={p}>{MONTHS[i]}</option>)}</select></label>
        <label>Subsídio de férias em<select value={a.holidayMonth} onChange={(e) => set({ holidayMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label>Subsídio de Natal em<select value={a.christmasMonth} onChange={(e) => set({ christmasMonth: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      </div>
      <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Admissões previstas</h3>
      {a.hires.length > 0 && (
        <table className="dense">
          <thead><tr><th>Departamento</th><th>Entrada</th><th className="num">N.º</th><th className="num">Salário base (Kz)</th><th className="num">Alimentação</th><th className="num">Transporte</th><th /></tr></thead>
          <tbody>
            {a.hires.map((h, i) => (
              <tr key={i}>
                <td><select value={h.departmentId ?? ''} onChange={(e) => setHire(i, { departmentId: e.target.value || null })}><option value="">Sem departamento</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
                <td><select value={h.from} onChange={(e) => setHire(i, { from: e.target.value })}>{periods.map((p, k) => <option key={p} value={p}>{MONTHS[k]}</option>)}</select></td>
                <td className="num"><input type="number" min={1} max={500} value={h.count} onChange={(e) => setHire(i, { count: Math.max(1, Number(e.target.value)) })} style={{ width: 64 }} /></td>
                <td className="num"><input inputMode="decimal" defaultValue={kzOut(h.baseMinor)} onChange={(e) => setHire(i, { baseMinor: kzIn(e.target.value) })} style={{ width: 120 }} /></td>
                <td className="num"><input inputMode="decimal" defaultValue={kzOut(h.mealMinor)} onChange={(e) => setHire(i, { mealMinor: kzIn(e.target.value) })} style={{ width: 100 }} /></td>
                <td className="num"><input inputMode="decimal" defaultValue={kzOut(h.transportMinor)} onChange={(e) => setHire(i, { transportMinor: kzIn(e.target.value) })} style={{ width: 100 }} /></td>
                <td className="num"><button type="button" className="btn ghost sm" onClick={() => set({ hires: a.hires.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => set({ hires: [...a.hires, { departmentId: departments[0]?.id ?? null, from: periods[0]!, count: 1, baseMinor: 0, mealMinor: 0, transportMinor: 0 }] })}>+ Admissão</button>

      <div className="form-actions" style={{ marginTop: 14, gap: 8 }}>
        {error && <span className="err">{error}</span>}
        <button type="button" className="btn ghost" disabled={busy} onClick={async () => { const r = await call('/v1/budgets/simulate'); if (r) setSim(r.data!); }}>Simular</button>
        <button type="button" className="btn" disabled={busy} onClick={async () => {
          if (budgetId && !window.confirm('Recalcular substitui os ajustes manuais feitos na grelha. Continuar?')) return;
          const r = await call(budgetId ? `/v1/budgets/${budgetId}/regenerate` : '/v1/budgets');
          if (r) router.refresh();
        }}>{budgetId ? 'Recalcular orçamento' : 'Criar orçamento'}</button>
      </div>

      {sim && (
        <div style={{ marginTop: 12 }}>
          <div className="warn" style={{ marginBottom: 8 }}>
            Custo com pessoal previsto para {a.year}: <b>{formatKz(sim.totalMinor)}</b> · {sim.staff} trabalhador(es) no quadro actual · taxas do pacote {sim.packVersion}
          </div>
          <table className="dense">
            <thead><tr><th>Mês</th>{sim.months.map((m) => <th key={m.period} className="num">{MONTHS[Number(m.period.slice(5)) - 1]!.slice(0, 3)}</th>)}</tr></thead>
            <tbody>
              <tr><td>Custo</td>{sim.months.map((m) => <td key={m.period} className="num">{Math.round(m.costMinor / 100_000).toLocaleString('pt-PT')} mil</td>)}</tr>
              <tr><td>Efectivo</td>{sim.months.map((m) => <td key={m.period} className="num">{String(m.headcount).replace('.', ',')}</td>)}</tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Grelha do orçamento (departamento × mês), editável em rascunho. */
export function BudgetGrid({ budgetId, year, departments, lines, editable }: { budgetId: string; year: number; departments: Dept[]; lines: { period: string; departmentId: string | null; costMinor: number; headcount: number }[]; editable: boolean }) {
  const router = useRouter();
  const periods = MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = [...new Set(lines.map((l) => l.departmentId))].sort((x, y) => (name(x) > name(y) ? 1 : -1));
  function name(id: string | null) { return departments.find((d) => d.id === id)?.name ?? 'Sem departamento'; }
  const value = (id: string | null, p: string) => lines.find((l) => l.departmentId === id && l.period === p)?.costMinor ?? 0;
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState('');
  const { busy, error, run } = useMutation();
  const extra = adding ? [adding === '__none' ? null : adding] : [];
  const all = [...rows, ...extra.filter((x) => !rows.includes(x))];
  const cell = (id: string | null, p: string) => edits[`${id ?? ''}|${p}`] ?? value(id, p);
  return (
    <div className="card section" style={{ overflowX: 'auto' }}>
      <h2 style={{ fontSize: 14, padding: '12px 16px 0' }}>Orçamento por departamento (custo com pessoal, Kz)</h2>
      <table className="dense" style={{ minWidth: 1100 }}>
        <thead><tr><th>Departamento</th>{periods.map((p, i) => <th key={p} className="num">{MONTHS[i]!.slice(0, 3)}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>
          {all.map((id) => (
            <tr key={id ?? 'none'}>
              <td><b>{name(id)}</b></td>
              {periods.map((p) => (
                <td key={p} className="num">
                  {editable
                    ? <input inputMode="decimal" aria-label={`${name(id)} ${monthLabel(p)}`} defaultValue={kzOut(value(id, p))} style={{ width: 92, textAlign: 'right' }}
                      onChange={(e) => setEdits({ ...edits, [`${id ?? ''}|${p}`]: kzIn(e.target.value) })} />
                    : Math.round(value(id, p) / 100).toLocaleString('pt-PT')}
                </td>
              ))}
              <td className="num"><b>{Math.round(periods.reduce((s, p) => s + cell(id, p), 0) / 100).toLocaleString('pt-PT')}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="form-actions" style={{ padding: '10px 16px', gap: 8 }}>
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Acrescentar departamento">
            <option value="">+ Departamento sem linha</option>
            {departments.filter((d) => !rows.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            {!rows.includes(null) && <option value="__none">Sem departamento</option>}
          </select>
          {error && <span className="err">{error}</span>}
          <button className="btn" disabled={busy || !Object.keys(edits).length} onClick={() => run(`/v1/budgets/${budgetId}/lines`, 'PUT', {
            lines: Object.entries(edits).map(([k, costMinor]) => { const [d, period] = k.split('|'); return { departmentId: d || null, period, costMinor }; }),
          }, () => { setEdits({}); setAdding(''); router.refresh(); })}>Guardar ajustes</button>
        </div>
      )}
    </div>
  );
}

export function BudgetActions({ id, status, isOwner, canEdit }: { id: string; status: string; isOwner: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { busy, error, run } = useMutation();
  return (
    <span className="actions">
      {error && <span className="err">{error}</span>}
      {isOwner && status === 'draft' && <button className="btn sm" disabled={busy} onClick={() => run(`/v1/budgets/${id}/approve`, 'POST', undefined, () => router.refresh())}>Aprovar</button>}
      {isOwner && status === 'approved' && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/budgets/${id}/reopen`, 'POST', undefined, () => router.refresh())}>Reabrir</button>}
      {canEdit && status === 'draft' && <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm('Apagar este orçamento?')) void run(`/v1/budgets/${id}`, 'DELETE', undefined, () => router.refresh()); }}>Apagar</button>}
      <ExportLink className="btn ghost sm" href={`/api/v1/budgets/${id}/export`}>Exportar Excel</ExportLink>
    </span>
  );
}
