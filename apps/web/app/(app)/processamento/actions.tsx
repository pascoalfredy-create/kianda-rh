'use client';

import { useState } from 'react';
import { formObject, useMutation } from '@/lib/client';

export function PrepareButton({ period, label }: { period: string; label: string }) {
  const { busy, error, run } = useMutation();
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className="btn" disabled={busy} onClick={() => run('/v1/payroll-runs', 'POST', { period })}>{busy ? 'A calcular…' : label}</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

export function CloseButton({ runId, period, selfPrepared }: { runId: string; period: string; selfPrepared: boolean }) {
  const { busy, error, run } = useMutation();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button className="btn" onClick={() => setConfirm(true)}>Fechar processamento</button>;
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      <span className="muted">Fechar {period}? Gera o lançamento PGC e os recibos; deixa de ser possível alterar.{selfPrepared ? ' (Preparado por si: só o proprietário pode fechar o que preparou.)' : ''}</span>
      <button className="btn" disabled={busy} onClick={() => run(`/v1/payroll-runs/${runId}/close`, 'POST')}>Confirmar fecho</button>
      <button className="btn ghost sm" onClick={() => setConfirm(false)}>Cancelar</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

/** Forçar / excluir / automático para um subsídio de um colaborador (rascunho). */
export function SubsidyToggle({ runId, employeeId, kind, paid, override }: { runId: string; employeeId: string; kind: 'holiday' | 'christmas'; paid: boolean; override?: boolean }) {
  const { busy, run } = useMutation();
  const label = kind === 'holiday' ? 'SF' : 'SN';
  const title = kind === 'holiday' ? 'Subsídio de férias' : 'Subsídio de Natal';
  const next = override === undefined ? !paid : null;
  const state = override === undefined ? 'auto' : override ? 'forçado' : 'excluído';
  return (
    <button
      className={`sub-toggle ${paid ? 'on' : ''} ${override !== undefined ? 'manual' : ''}`}
      disabled={busy}
      title={`${title}: ${paid ? 'incluído' : 'não incluído'} (${state}). Clique para ${next === null ? 'voltar à regra automática' : next ? 'incluir' : 'excluir'}.`}
      onClick={() => run(`/v1/payroll-runs/${runId}/subsidies`, 'POST', { employeeId, [kind]: next })}
    >
      {label}
    </button>
  );
}

export function AddVariable({ period, people }: { period: string; people: { id: string; name: string }[] }) {
  const { busy, error, run } = useMutation();
  const [kind, setKind] = useState('bonus');
  const [open, setOpen] = useState(false);
  const earning = kind === 'bonus' || kind === 'other_earning';
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Lançar variável</button>;
  return (
    <form
      className="form card cols4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = formObject(e.currentTarget, ['amount']);
        const ok = await run('/v1/payroll-variables', 'POST', { ...f, period, inInss: f.inInss === 'on', inIrt: f.inIrt === 'on' });
        if (ok) setOpen(false);
      }}
    >
      <h3>Nova variável de {period}</h3>
      <label className="span2">Colaborador
        <select name="employeeId" required>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <label>Tipo
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="bonus">Prémio / gratificação</option>
          <option value="other_earning">Outro abono</option>
          <option value="advance">Adiantamento (desconto)</option>
          <option value="other_deduction">Outro desconto</option>
          <option value="salary_cut">Desconto na remuneração (reduz INSS/IRT — cálculo manual)</option>
        </select>
      </label>
      <label>Valor (Kz)<input name="amount" inputMode="decimal" required /></label>
      <label className="span2">Descrição<input name="label" required placeholder={earning ? 'Ex.: Prémio de desempenho do trimestre' : 'Ex.: Prestação do empréstimo 3/10'} /></label>
      {earning && (
        <div className="span2" style={{ display: 'flex', gap: 18, alignItems: 'end', paddingBottom: 8 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inInss" defaultChecked style={{ height: 16 }} /> Incide INSS</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inIrt" defaultChecked style={{ height: 16 }} /> Incide IRT</label>
        </div>
      )}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        <button className="btn" disabled={busy}>Lançar</button>
      </div>
      <p className="muted wide">Depois de lançar, carregue em “Recalcular” para actualizar o processamento.</p>
    </form>
  );
}

export function DeleteVariable({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return error ? <span style={{ color: 'var(--red)' }}>{error}</span> : <button className="btn danger" disabled={busy} onClick={() => run(`/v1/payroll-variables/${id}`, 'DELETE')}>Remover</button>;
}
