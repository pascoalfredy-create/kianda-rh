'use client';
import { DocumentPrintButton } from '@/components/document-export';


import { EXPENSE_CATEGORIES, formatKz, PER_DIEM_ZONE } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { send, useMutation } from '@/lib/client';

interface LineState { kind: 'expense' | 'per_diem'; date: string; description: string; category: string; amount: string; documentRef: string; supplierNif: string; zone: string; days: string; rate: string }
export interface ClaimInit { id?: string; employeeId?: string; title: string; tripFrom: string | null; tripTo: string | null; lines: Partial<LineState>[] }

const num = (v: string) => { const t = v.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return t === '' ? null : Number(t); };
const blank = (kind: LineState['kind'], today: string, rates: { national: number | null; international: number | null }): LineState => ({
  kind, date: today, description: '', category: 'transport', amount: '', documentRef: '', supplierNif: '', zone: 'national', days: '1',
  rate: rates.national ? String(rates.national / 100).replace('.', ',') : '',
});

export function ClaimForm({ init, today, rates, employees }: { init: ClaimInit; today: string; rates: { national: number | null; international: number | null }; employees?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(init.title);
  const [tripFrom, setTripFrom] = useState(init.tripFrom ?? '');
  const [tripTo, setTripTo] = useState(init.tripTo ?? '');
  const [employeeId, setEmployeeId] = useState(init.employeeId ?? '');
  const [lines, setLines] = useState<LineState[]>(init.lines.length ? init.lines.map((l) => ({ ...blank(l.kind ?? 'expense', today, rates), ...l })) : [blank('expense', today, rates)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i: number, k: keyof LineState, v: string) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const n = { ...l, [k]: v };
    if (k === 'zone') { const r = rates[v as 'national' | 'international']; if (r) n.rate = String(r / 100).replace('.', ','); }
    return n;
  }));
  const amountOf = (l: LineState) => l.kind === 'expense' ? Math.round((num(l.amount) ?? 0) * 100) : Math.round((num(l.days) ?? 0) * (num(l.rate) ?? 0) * 100);
  const total = lines.reduce((s, l) => s + amountOf(l), 0);

  async function save(submit: boolean) {
    setBusy(true); setError('');
    const payload = {
      employeeId: employeeId || undefined, title, tripFrom: tripFrom || null, tripTo: tripTo || null,
      lines: lines.map((l) => l.kind === 'expense'
        ? { kind: l.kind, date: l.date, description: l.description, category: l.category, amount: num(l.amount), documentRef: l.documentRef, supplierNif: l.supplierNif || null }
        : { kind: l.kind, date: l.date, description: l.description, zone: l.zone, days: num(l.days), rate: num(l.rate) }),
    };
    const r = init.id ? await send<{ id: string }>(`/v1/expenses/${init.id}`, 'PUT', payload) : await send<{ id: string }>('/v1/expenses', 'POST', payload);
    if (!r.ok) { setBusy(false); return setError(r.message ?? 'Erro'); }
    const id = init.id ?? r.data!.id;
    if (submit) {
      const s = await send(`/v1/expenses/${id}/submit`, 'POST', {});
      if (!s.ok) { setBusy(false); setError(s.message ?? 'Erro'); if (!init.id) router.replace(`/despesas/${id}`); return; }
    }
    setBusy(false);
    router.push(`/despesas/${id}`);
    router.refresh();
  }

  return (
    <div className="card section">
      <div className="form">
        {employees && (
          <label className="span2">Colaborador
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— eu próprio —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
        <label className="span2">Motivo<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Deslocação ao Lobito — auditoria ao armazém" /></label>
        <label>Partida<input type="date" value={tripFrom} onChange={(e) => setTripFrom(e.target.value)} /></label>
        <label>Regresso<input type="date" value={tripTo} onChange={(e) => setTripTo(e.target.value)} /></label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead><tr><th>Tipo</th><th>Data</th><th>Descrição</th><th>Detalhe</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ verticalAlign: 'top' }}>
                <td style={{ width: 150 }}>
                  <select value={l.kind} onChange={(e) => set(i, 'kind', e.target.value)}><option value="expense">Despesa</option><option value="per_diem">Ajuda de custo</option></select>
                </td>
                <td style={{ width: 150 }}><input type="date" value={l.date} max={today} onChange={(e) => set(i, 'date', e.target.value)} /></td>
                <td><input value={l.description} onChange={(e) => set(i, 'description', e.target.value)} placeholder={l.kind === 'expense' ? 'Ex.: Hotel, 2 noites' : 'Ex.: Deslocação ao Lobito'} style={{ width: '100%', minWidth: 160 }} /></td>
                <td style={{ minWidth: 340 }}>
                  {l.kind === 'expense' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <select value={l.category} onChange={(e) => set(i, 'category', e.target.value)}>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <input value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} inputMode="decimal" placeholder="Valor (Kz)" />
                      <input value={l.documentRef} onChange={(e) => set(i, 'documentRef', e.target.value)} placeholder="N.º recibo / factura" />
                      <input value={l.supplierNif} onChange={(e) => set(i, 'supplierNif', e.target.value)} placeholder="NIF do fornecedor (opcional)" />
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr .6fr 1fr', gap: 6 }}>
                      <select value={l.zone} onChange={(e) => set(i, 'zone', e.target.value)}>{Object.entries(PER_DIEM_ZONE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <input value={l.days} onChange={(e) => set(i, 'days', e.target.value)} inputMode="decimal" placeholder="Dias" title="Dias (meios dias: 0,5)" />
                      <input value={l.rate} onChange={(e) => set(i, 'rate', e.target.value)} inputMode="decimal" placeholder="Diária (Kz)" title={rates[l.zone as 'national'] ? `Máximo da empresa: ${formatKz(rates[l.zone as 'national']!)}` : 'Sem diária fixada pela empresa'} />
                    </div>
                  )}
                </td>
                <td className="num" style={{ width: 140 }}><b>{formatKz(amountOf(l))}</b></td>
                <td style={{ width: 40 }}><button type="button" className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} title="Remover linha">×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4}><b>Total a reembolsar</b></td><td className="num"><b>{formatKz(total)}</b></td><td /></tr></tfoot>
        </table>
      </div>
      <div className="actions" style={{ justifyContent: 'space-between', padding: 16 }}>
        <span className="actions">
          <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, blank('expense', today, rates)])}>+ Despesa</button>
          <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, blank('per_diem', today, rates)])}>+ Ajuda de custo</button>
        </span>
        <span className="actions">
          {error && <span style={{ color: 'var(--red)', maxWidth: 520 }}>{error}</span>}
          <button className="btn ghost" disabled={busy} onClick={() => save(false)}>Guardar rascunho</button>
          <button className="btn" disabled={busy} onClick={() => save(true)}>Submeter para aprovação</button>
        </span>
      </div>
    </div>
  );
}

export function ClaimActions({ id, can, accounts }: { id: string; can: { submit: boolean; decide: boolean; pay: boolean; reversePayment: boolean; cancel: boolean }; accounts: { id: string; name: string }[] }) {
  const { busy, error, run } = useMutation();
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'' | 'reject' | 'pay' | 'reverse'>('');
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return (
    <div className="card no-print" style={{ padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        {can.submit && <button className="btn" disabled={busy} onClick={() => run(`/v1/expenses/${id}/submit`, 'POST', {})}>Submeter para aprovação</button>}
        {can.decide && <button className="btn" disabled={busy} onClick={() => run(`/v1/expenses/${id}/decision`, 'POST', { approve: true, note: note || null })}>Aprovar</button>}
        {can.decide && <button className="btn ghost" onClick={() => setMode('reject')}>Recusar…</button>}
        {can.pay && <button className="btn" onClick={() => setMode('pay')}>Registar reembolso…</button>}
        {can.reversePayment && <button className="btn ghost" onClick={() => setMode('reverse')}>Estornar reembolso…</button>}
        {can.cancel && <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm('Anular esta nota de despesas?')) void run(`/v1/expenses/${id}/cancel`, 'POST', {}); }}>Anular nota</button>}
        <DocumentPrintButton className="btn ghost">Imprimir</DocumentPrintButton>
      </div>
      {mode === 'reject' && (
        <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); if (await run(`/v1/expenses/${id}/decision`, 'POST', { approve: false, note })) setMode(''); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo da recusa" style={{ width: 360 }} required />
          <button className="btn danger" disabled={busy}>Confirmar recusa</button>
        </form>
      )}
      {mode === 'pay' && (
        <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          if (await run(`/v1/expenses/${id}/pay`, 'POST', { paidOn: f.get('paidOn'), reference: f.get('reference') || null, bankAccountId: f.get('bankAccountId') || null })) setMode('');
        }}>
          <input type="date" name="paidOn" defaultValue={today} max={today} />
          <input name="reference" placeholder="Referência da transferência" style={{ width: 220 }} />
          {accounts.length > 0 && <select name="bankAccountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
          <button className="btn" disabled={busy}>Confirmar reembolso</button>
        </form>
      )}
      {mode === 'reverse' && (
        <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); if (await run(`/v1/expenses/${id}/reverse-payment`, 'POST', { note })) setMode(''); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo do estorno" style={{ width: 360 }} required />
          <button className="btn danger" disabled={busy}>Confirmar estorno</button>
        </form>
      )}
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}
