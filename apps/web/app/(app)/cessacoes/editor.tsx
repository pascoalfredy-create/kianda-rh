'use client';

import { formatKz, SETTLEMENT_LABEL, TERMINATION_REASONS, type SettlementItem, type TerminationReason } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { send, useMutation } from '@/lib/client';

interface Preview {
  employee: { name: string; number: string; jobTitle: string }; hireDate: string;
  pay: { baseMinor: number; mealMinor: number; transportMinor: number };
  vacation: { entitlement: number; taken: number; unused: number };
  proposal: { seniority: { label: string }; notice: { requiredDays: number; givenDays: number; missingDays: number; by: string | null }; legalCompensationMinor: number; notes: string[]; items: SettlementItem[] };
  items: SettlementItem[];
  payslip: { lines: { code: string; name: string; kind: string; amountMinor: number }[]; grossMinor: number; inssEmployeeMinor: number; irtMinor: number; netMinor: number } | null;
  warnings: string[];
}
export interface EditorInit { id?: string; employeeId: string; reason: TerminationReason; effectiveDate: string; noticeDate: string | null; agreedCompensationMinor: number | null; items: SettlementItem[] | null; note: string | null }

const pt = (d: string) => d.split('-').reverse().join('/');
const toKz = (s: string) => { const t = s.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return t === '' ? null : Math.round(Number(t) * 100); };
const dec = (m: number) => (m / 100).toFixed(2).replace('.', ',');

export function TerminationEditor({ init, employees }: { init: EditorInit; employees?: { id: string; name: string; number: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ ...init, agreed: init.agreedCompensationMinor ? dec(init.agreedCompensationMinor) : '' });
  const [items, setItems] = useState<SettlementItem[] | null>(init.items);
  const [edited, setEdited] = useState(Boolean(init.items));
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payload = (withItems: boolean) => ({
    employeeId: f.employeeId, reason: f.reason, effectiveDate: f.effectiveDate, noticeDate: f.noticeDate || null,
    agreedCompensationMinor: toKz(f.agreed), items: withItems && items ? items : undefined, note: f.note || null,
  });

  async function preview(keepItems: boolean) {
    if (!f.employeeId || !f.effectiveDate) return;
    setError('');
    const r = await send<Preview>('/v1/terminations/preview', 'POST', payload(keepItems));
    if (!r.ok) return setError(r.message ?? 'Erro');
    setPv(r.data!);
    if (!keepItems) { setItems(r.data!.proposal.items); setEdited(false); } else setItems(r.data!.items);
  }
  // Recalcular a proposta quando mudam os dados do caso (descarta ajustes manuais).
  useEffect(() => { void preview(edited); }, [f.employeeId, f.reason, f.effectiveDate, f.noticeDate, f.agreed]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItem = (i: number, patch: Partial<SettlementItem>) => { setEdited(true); setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  async function save() {
    setBusy(true); setError('');
    const r = init.id ? await send(`/v1/terminations/${init.id}`, 'PUT', payload(true)) : await send<{ id: string }>('/v1/terminations', 'POST', payload(true));
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'Erro');
    if (!init.id) router.push(`/cessacoes/${(r.data as { id: string }).id}`);
    router.refresh();
  }
  useEffect(() => { if (items && pv) void refreshPayslip(); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refreshPayslip() {
    const r = await send<Preview>('/v1/terminations/preview', 'POST', payload(true));
    if (r.ok) setPv(r.data!);
  }

  const reason = TERMINATION_REASONS[f.reason];
  const earnings = (items ?? []).filter((x) => x.kind === 'earning').reduce((s, x) => s + x.amountMinor, 0);
  const deductions = (items ?? []).filter((x) => x.kind === 'deduction').reduce((s, x) => s + x.amountMinor, 0);
  return (
    <>
      <div className="card form" style={{ marginBottom: 14 }}>
        {employees ? (
          <label className="span2">Colaborador
            <select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
              <option value="">— escolha —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.number} · {e.name}</option>)}
            </select>
          </label>
        ) : <div className="span2"><div className="muted">Colaborador</div><b>{pv?.employee.name}</b></div>}
        <label className="span2">Motivo
          <select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as TerminationReason })}>
            {Object.entries(TERMINATION_REASONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label>Último dia de trabalho<input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></label>
        <label>Comunicação escrita (aviso)<input type="date" value={f.noticeDate ?? ''} onChange={(e) => setF({ ...f, noticeDate: e.target.value || null })} /></label>
        <label>Compensação acordada (Kz)<input value={f.agreed} onChange={(e) => setF({ ...f, agreed: e.target.value })} inputMode="decimal" placeholder={reason.compensation === 'agreed' ? 'Valor global' : 'Só se acima do legal'} /></label>
        <label className="wide">Notas internas<input value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ex.: extinção do posto por reestruturação" /></label>
        <p className="muted wide">{reason.legal}</p>
      </div>

      {error && <div className="alert">{error}</div>}
      {pv && pv.warnings.length > 0 && <div className="warn"><ul>{pv.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      {pv && (
        <div className="grid">
          <div className="card kpi"><div className="l">Antiguidade</div><div className="v" style={{ fontSize: 17 }}>{pv.proposal.seniority.label}</div><div className="muted">desde {pt(pv.hireDate)}</div></div>
          <div className="card kpi"><div className="l">Aviso prévio</div><div className="v" style={{ fontSize: 17, color: pv.proposal.notice.missingDays ? 'var(--amber)' : undefined }}>{pv.proposal.notice.requiredDays ? `${pv.proposal.notice.givenDays} de ${pv.proposal.notice.requiredDays} dias` : 'Não aplicável'}</div><div className="muted">{pv.proposal.notice.by === 'employee' ? 'devido pelo trabalhador' : pv.proposal.notice.by === 'employer' ? 'devido pela empresa' : ''}</div></div>
          <div className="card kpi"><div className="l">Férias do ano</div><div className="v" style={{ fontSize: 17 }}>{pv.vacation.unused} dia(s) por gozar</div><div className="muted">direito {pv.vacation.entitlement} · gozados {pv.vacation.taken}</div></div>
          <div className="card kpi"><div className="l">Compensação legal</div><div className="v" style={{ fontSize: 17 }}>{formatKz(pv.proposal.legalCompensationMinor)}</div><div className="muted">base {formatKz(pv.pay.baseMinor)}</div></div>
        </div>
      )}
      {pv && pv.proposal.notes.length > 0 && <div className="warn"><ul>{pv.proposal.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>}

      {items && (
        <div className="card section">
          <h2>Fecho de contas {edited && <span className="tag" style={{ marginLeft: 8 }}>ajustado manualmente</span>}</h2>
          <table className="dense">
            <thead><tr><th>Rubrica</th><th>Base de cálculo</th><th>INSS</th><th>IRT</th><th className="num">Abono</th><th className="num">Desconto</th><th /></tr></thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td><input value={x.label} onChange={(e) => setItem(i, { label: e.target.value })} style={{ width: '100%', minWidth: 220 }} /></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{x.basis}</td>
                  <td><input type="checkbox" checked={x.inInss} onChange={(e) => setItem(i, { inInss: e.target.checked })} disabled={x.kind === 'deduction'} /></td>
                  <td><input type="checkbox" checked={x.inIrt} onChange={(e) => setItem(i, { inIrt: e.target.checked })} disabled={x.kind === 'deduction'} /></td>
                  <td className="num">{x.kind === 'earning' && <input defaultValue={dec(x.amountMinor)} key={`${i}-${x.amountMinor}`} onBlur={(e) => setItem(i, { amountMinor: toKz(e.target.value) ?? 0 })} style={{ width: 130, textAlign: 'right' }} />}</td>
                  <td className="num">{x.kind === 'deduction' && <input defaultValue={dec(x.amountMinor)} key={`${i}-${x.amountMinor}`} onBlur={(e) => setItem(i, { amountMinor: toKz(e.target.value) ?? 0 })} style={{ width: 130, textAlign: 'right' }} />}</td>
                  <td><button className="btn ghost sm" title="Retirar" onClick={() => { setEdited(true); setItems(items.filter((_, j) => j !== i)); }}>×</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><b>Totais do fecho de contas</b> <span className="muted">(além do salário dos dias trabalhados no mês)</span></td><td className="num"><b>{formatKz(earnings)}</b></td><td className="num"><b>{formatKz(deductions)}</b></td><td /></tr></tfoot>
          </table>
          <div className="actions" style={{ justifyContent: 'flex-start', padding: '10px 16px' }}>
            <button className="btn ghost sm" onClick={() => { setEdited(true); setItems([...items, { code: 'OUTABON', label: SETTLEMENT_LABEL.OUTABON, basis: 'Manual', kind: 'earning', amountMinor: 0, inInss: true, inIrt: true }]); }}>+ Abono</button>
            <button className="btn ghost sm" onClick={() => { setEdited(true); setItems([...items, { code: 'OUTDESC', label: SETTLEMENT_LABEL.OUTDESC, basis: 'Manual', kind: 'deduction', amountMinor: 0, inInss: false, inIrt: false }]); }}>+ Desconto</button>
            {edited && <button className="btn ghost sm" onClick={() => void preview(false)}>Repor a proposta legal</button>}
          </div>
        </div>
      )}

      {pv?.payslip && (
        <div className="card section">
          <h2>Recibo final estimado ({pt(f.effectiveDate).slice(3)})</h2>
          <table className="dense">
            <tbody>
              {pv.payslip.lines.filter((l) => l.kind !== 'employer').map((l, i) => <tr key={i}><td>{l.name}</td><td className="num">{l.kind === 'earning' ? formatKz(l.amountMinor) : ''}</td><td className="num">{l.kind === 'deduction' ? formatKz(l.amountMinor) : ''}</td></tr>)}
            </tbody>
            <tfoot><tr><td><b>Líquido a receber</b></td><td colSpan={2} className="num"><b>{formatKz(pv.payslip.netMinor)}</b></td></tr></tfoot>
          </table>
          <p className="muted" style={{ padding: '0 16px 12px' }}>Estimativa sem horas extra nem faltas do mês. O valor definitivo sai do processamento de {pt(f.effectiveDate).slice(3)}.</p>
        </div>
      )}

      <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 20 }}>
        <button className="btn" disabled={busy || !items || !f.employeeId} onClick={save}>{init.id ? 'Gravar alterações' : 'Guardar rascunho'}</button>
      </div>
    </>
  );
}

export function TerminationActions({ id, status }: { id: string; status: string }) {
  const { busy, error, run } = useMutation();
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  return (
    <div className="card no-print" style={{ padding: 14, marginBottom: 14, display: 'grid', gap: 10 }}>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        {status === 'draft' && <button className="btn" disabled={busy} onClick={() => { if (window.confirm('Confirmar a cessação? O contrato termina na data de efeito, a ficha passa a cessada, o acesso do colaborador é desactivado e o fecho de contas entra no processamento do mês.')) void run(`/v1/terminations/${id}/confirm`, 'POST', {}); }}>Confirmar cessação</button>}
        {status !== 'cancelled' && <button className="btn ghost" onClick={() => setCancelling(true)}>{status === 'confirmed' ? 'Anular cessação…' : 'Descartar…'}</button>}
      </div>
      {cancelling && (
        <form className="actions" style={{ justifyContent: 'flex-start' }} onSubmit={async (e) => { e.preventDefault(); if (await run(`/v1/terminations/${id}/cancel`, 'POST', { note })) setCancelling(false); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo" style={{ width: 340 }} required />
          <button className="btn danger" disabled={busy}>Confirmar</button>
        </form>
      )}
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
  );
}
