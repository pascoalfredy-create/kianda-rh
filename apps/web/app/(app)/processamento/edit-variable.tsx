'use client';
import { useState } from 'react';
import { formatAmount } from '@kianda/core';
import { RhDialog } from '@/components/rh-dialog';
import { formObject, useMutation } from '@/lib/client';
import type { PayrollVariableRow } from '@/lib/types';

export function EditVariable({ variable: v }: { variable: PayrollVariableRow }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(v.code === 'CORTE' ? 'salary_cut' : v.kind);
  const { busy, error, run } = useMutation();
  if (v.terminationId || v.advanceId) return null;
  const earning = kind === 'bonus' || kind === 'other_earning';
  const expected = { kind: v.kind, label: v.label, amountMinor: v.amountMinor, code: v.code ?? null, inInss: v.inInss, inIrt: v.inIrt, note: v.note ?? null };
  return <><button type="button" className="btn ghost sm" onClick={() => { setKind(v.code === 'CORTE' ? 'salary_cut' : v.kind); setOpen(true); }}>Editar</button>
    {open && <RhDialog title="Editar alteração do mês" onClose={() => { if (!busy) setOpen(false); }}><form className="form" aria-label="Editar alteração do mês" onSubmit={async e => {
      e.preventDefault(); const data = formObject(e.currentTarget, ['amount']);
      await run('/v1/payroll-variables/' + v.id, 'PATCH', { ...data, inInss: data.inInss === 'on', inIrt: data.inIrt === 'on', expected }, () => setOpen(false));
    }}>
      <p className="wide"><b>{v.employee.name}</b> · {v.label}. Depois de guardar, recalcule a folha em rascunho para aplicar a alteração.</p>
      <label>Tipo<select name="kind" value={kind} disabled={busy} onChange={e => setKind(e.target.value as typeof kind)}><option value="bonus">Prémio / gratificação</option><option value="other_earning">Outro abono</option><option value="advance">Adiantamento (desconto)</option><option value="other_deduction">Outro desconto</option><option value="salary_cut">Desconto na remuneração</option></select></label>
      <label>Valor (Kz)<input name="amount" inputMode="decimal" defaultValue={formatAmount(Math.abs(v.amountMinor))} required disabled={busy} /></label>
      <label className="wide">Descrição<input name="label" defaultValue={v.label} required minLength={2} disabled={busy} /></label>
      {earning && <div className="wide actions"><label><input type="checkbox" name="inInss" defaultChecked={v.inInss} disabled={busy} /> Incide INSS</label><label><input type="checkbox" name="inIrt" defaultChecked={v.inIrt} disabled={busy} /> Incide IRT</label></div>}
      <label className="wide">Nota<textarea name="note" defaultValue={v.note ?? ''} maxLength={300} disabled={busy} /></label>
      <div className="form-actions">{error && <span className="err" role="alert">{error}</span>}<button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button><button className="btn" disabled={busy}>{busy ? 'A guardar…' : 'Guardar alteração'}</button></div>
    </form></RhDialog>}
  </>;
}
