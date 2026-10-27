'use client';

import { formatKz } from '@kianda/core';
import { useEffect, useState } from 'react';
import { send, useMutation } from '@/lib/client';
import { monthLabel } from './format';

const nextPeriod = () => {
  const d = new Date(Date.now() + 3_600_000);
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

interface Sim { maxAmountMinor: number; maxInstallmentMinor: number; minInstallments: number; problems: string[]; plan: { period: string; amountMinor: number }[]; netMinor: number; outstandingMinor: number }

/** Pedido de adiantamento (o próprio ou o RH em nome do colaborador), com simulação dos limites legais. */
export function RequestForm({ employees }: { employees?: { id: string; name: string }[] }) {
  const { busy, error, run, setError } = useMutation();
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState(3);
  const [firstPeriod, setFirstPeriod] = useState(nextPeriod());
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sim, setSim] = useState<Sim | null>(null);
  const [ok, setOk] = useState('');
  const value = Number(amount.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  useEffect(() => {
    if (!(value > 0)) { setSim(null); return; }
    const t = setTimeout(async () => {
      const q = new URLSearchParams({ amount: String(value), installments: String(installments), firstPeriod, ...(employees ? { employeeId } : {}) });
      const r = await send<Sim>(`/v1/advances/simulate?${q}`, 'GET');
      if (r.ok) setSim(r.data!);
    }, 350);
    return () => clearTimeout(t);
  }, [value, installments, firstPeriod, employeeId, employees]);
  return (
    <div className="form">
      {employees && (
        <label className="wide">Colaborador
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
      )}
      <label>Valor (Kz)<input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setOk(''); }} placeholder="Ex.: 150 000" /></label>
      <label>Prestações mensais<input type="number" min={1} max={24} value={installments} onChange={(e) => setInstallments(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} /></label>
      <label>Primeiro desconto<input type="month" value={firstPeriod} onChange={(e) => setFirstPeriod(e.target.value)} /></label>
      <label className="wide">Motivo (opcional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      {sim && (
        <div className="wide" style={{ display: 'grid', gap: 6 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Líquido mensal estimado {formatKz(sim.netMinor)} · máximo por prestação <b>{formatKz(sim.maxInstallmentMinor)}</b> (25% do líquido) · máximo em dívida <b>{formatKz(sim.maxAmountMinor + sim.outstandingMinor)}</b> (3 salários base){sim.outstandingMinor ? ` · já em dívida ${formatKz(sim.outstandingMinor)}` : ''}
          </div>
          {sim.problems.length > 0
            ? <div className="warn" style={{ margin: 0 }}>{sim.problems.join(' · ')}{sim.minInstallments > installments && sim.minInstallments <= 24 && <> <button className="link" style={{ color: 'var(--brand)' }} onClick={() => setInstallments(sim.minInstallments)}>Usar {sim.minInstallments} prestações</button></>}</div>
            : <div className="muted" style={{ fontSize: 13 }}>Plano: {sim.plan.map((p) => `${monthLabel(p.period)} ${formatKz(p.amountMinor)}`).join(' · ')}</div>}
        </div>
      )}
      <label className="wide" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ height: 'auto', marginTop: 3 }} />
        <span>{employees ? 'Tenho em arquivo o pedido escrito e assinado do colaborador, com a autorização de desconto no salário (LGT, art. 248.º, n.º 6).' : 'Peço por escrito este adiantamento e autorizo o desconto das prestações no meu salário (LGT, art. 248.º, n.º 6).'}</span>
      </label>
      <div className="form-actions">
        {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
        <button className="btn" disabled={busy || !(value > 0) || !confirm || !!sim?.problems.length} onClick={() => run('/v1/advances', 'POST', {
          ...(employees ? { employeeId } : {}), amount: value, installments, firstPeriod, reason: reason || null, confirm: true,
        }, () => { setOk('Pedido enviado.'); setAmount(''); setReason(''); setConfirm(false); setError(''); })}>Enviar pedido</button>
      </div>
    </div>
  );
}

export function DecideAdvance({ id, installments, firstPeriod }: { id: string; installments: number; firstPeriod: string }) {
  const { busy, error, run } = useMutation();
  const [n, setN] = useState(installments);
  const [p, setP] = useState(firstPeriod);
  const [note, setNote] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      <input type="number" min={1} max={24} value={n} onChange={(e) => setN(Number(e.target.value) || 1)} style={{ width: 64, height: 30 }} title="Prestações" />
      <input type="month" value={p} onChange={(e) => setP(e.target.value)} style={{ height: 30 }} title="Primeiro desconto" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota / motivo da recusa" style={{ width: 180, height: 30 }} />
      <button className="btn sm" disabled={busy} onClick={() => run(`/v1/advances/${id}/decide`, 'POST', { approve: true, installments: n, firstPeriod: p, note: note || null })}>Aprovar</button>
      <button className="btn danger" disabled={busy} onClick={() => run(`/v1/advances/${id}/decide`, 'POST', { approve: false, note })}>Recusar</button>
      {error && <span className="err" style={{ flexBasis: '100%', textAlign: 'right' }}>{error}</span>}
    </div>
  );
}

export function PayAdvance({ id, accounts }: { id: string; accounts: { id: string; name: string }[] }) {
  const { busy, error, run } = useMutation();
  const [date, setDate] = useState(new Date(Date.now() + 3_600_000).toISOString().slice(0, 10));
  const [acc, setAcc] = useState(accounts[0]?.id ?? '');
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ height: 30 }} />
      {accounts.length > 0 && <select value={acc} onChange={(e) => setAcc(e.target.value)} style={{ height: 30 }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
      <button className="btn sm" disabled={busy} onClick={() => run(`/v1/advances/${id}/pay`, 'POST', { paidOn: date, bankAccountId: acc || null })}>Registar pagamento</button>
      {error && <span className="err" style={{ flexBasis: '100%', textAlign: 'right' }}>{error}</span>}
    </div>
  );
}

export function CancelAdvance({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return <span><button className="link" style={{ color: 'var(--red)' }} disabled={busy} onClick={() => { if (window.confirm('Cancelar este pedido de adiantamento?')) void run(`/v1/advances/${id}/cancel`, 'POST', {}); }}>Cancelar</button>{error && <span className="err"> {error}</span>}</span>;
}
