'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formObject, useMutation } from '@/lib/client';
import { monthLabel } from '@/lib/format';
import { formatKz } from '@kianda/core';
import { BatchVariables, type BatchResult } from './batch-variables';

export function PrepareButton({ period, prepared, people, variableCount, indexed = 0, fx }: { period: string; prepared: boolean; people: { id: string; name: string }[]; variableCount: number; indexed?: number; fx?: { rate: string | null; date: string | null; source: string | null } }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [pendingVariable, setPendingVariable] = useState(false);
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const [rate, setRate] = useState(fx?.rate ? String(Number(fx.rate)).replace('.', ',') : '');
  const [date, setDate] = useState(fx?.date ?? today);
  const [source, setSource] = useState(fx?.source ?? 'BNA — câmbio de referência');
  const needsFx = indexed > 0;
  const body = needsFx && rate.trim() ? { period, fx: { rate, date, source } } : { period };
  const calculateDisabled = busy || pendingVariable || (needsFx && !rate.trim() && !fx?.rate);
  async function calculate() {
    if (calculateDisabled) return;
    if (await run('/v1/payroll-runs', 'POST', body)) setOpen(false);
  }
  const fxFields = needsFx && <div className="fx-fields" role="group" aria-label="Câmbio do dia">
    <label>Câmbio USD→Kz<input aria-label="Câmbio USD→Kz" inputMode="decimal" value={rate} placeholder="ex.: 912,50" onChange={e => setRate(e.target.value)} style={{ width: 110 }} /></label>
    <label>Data<input aria-label="Data do câmbio" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    <label>Fonte<input aria-label="Fonte do câmbio" value={source} maxLength={80} onChange={e => setSource(e.target.value)} style={{ width: 200 }} /></label>
  </div>;
  return (
    <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', ...(open ? { flexBasis: '100%', minWidth: 0 } : {}) }}>
      {!open && <>
        {prepared && fxFields}
        <button type="button" className="btn" disabled={busy || (prepared && calculateDisabled)} onClick={() => prepared ? calculate() : setOpen(true)}>{busy ? 'A calcular…' : prepared ? 'Recalcular' : 'Preparar processamento'}</button>
        {prepared && <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(true)}>Rever preparação</button>}
      </>}
      {open && <section aria-label="Preparação do processamento" style={{ width: '100%', minWidth: 0 }}>
        <h2>Preparar {monthLabel(period)}</h2>
        <p className="muted">A folha calcula toda a equipa elegível do mês. A base e os subsídios vêm dos contratos; as faltas e horas extra vêm dos registos aprovados. Pode lançar as variáveis individualmente ou em lote antes de calcular.</p>
        <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', margin: '12px 0' }}>
          <Link className="btn ghost sm" href="/colaboradores">Rever salários e contratos</Link>
          <Link className="btn ghost sm" href={`/assiduidade?mes=${period}`}>Rever assiduidade</Link>
        </div>
        {fxFields}
        <p className="muted">{variableCount} {variableCount === 1 ? 'variável guardada' : 'variáveis guardadas'} para este mês. O preenchimento abaixo é opcional; guarde cada variável que quiser incluir na folha.</p>
        {people.length ? <VariableEntry period={period} people={people} initialOpen preparing disabled={busy} onPendingChange={setPendingVariable} /> : <p className="muted">Sem colaboradores activos para lançar variáveis. Reveja as fichas e os contratos da equipa.</p>}
        <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" className="btn" disabled={calculateDisabled} onClick={calculate}>{busy ? 'A calcular…' : 'Calcular folha'}</button>
          <button type="button" className="btn ghost" disabled={busy || pendingVariable} onClick={() => setOpen(false)}>Cancelar preparação</button>
          {pendingVariable && <span className="muted" role="status">Guarde ou cancele a variável antes de calcular ou sair da preparação.</span>}
        </div>
      </section>}
      {needsFx && <span className="muted" style={{ fontSize: 12.5, flexBasis: '100%' }}>{indexed} colaborador(es) com salário indexado ao dólar: a base é convertida a este câmbio no recibo.</span>}
      {error && <span role="alert" style={{ color: 'var(--red)' }}>{error}</span>}
    </div>
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

export function VariableEntry({ period, people, initialOpen = false, preparing = false, disabled = false, onPendingChange }: { period: string; people: { id: string; name: string }[]; initialOpen?: boolean; preparing?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const [batch, setBatch] = useState(false), [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<BatchResult | null>(null);
  const notify = (value: boolean) => { setPending(value); onPendingChange?.(value); };
  return <section aria-label="Lançamento de variáveis" style={{ minWidth: 0, width: '100%' }}>
    <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 10 }}><button type="button" className="btn ghost" disabled={disabled || pending} onClick={() => { setBatch(!batch); setSaved(null); }}>{batch ? 'Lançamento individual' : 'Lançar em lote'}</button></div>
    {batch ? <BatchVariables period={period} people={people} disabled={disabled} onPendingChange={notify} onCancel={() => { notify(false); setBatch(false); }} onSaved={(result) => { setSaved(result); notify(false); setBatch(false); }} />
      : <AddVariable period={period} people={people} initialOpen={initialOpen} preparing={preparing} disabled={disabled} onPendingChange={notify} />}
    {saved && <p role="status" className="ok">Lote {saved.replayed ? 'já confirmado' : 'guardado'}: {saved.count} variável(eis), total {formatKz(saved.totalMinor)}. {preparing ? 'Clique em Calcular folha.' : 'Clique em Recalcular para actualizar a folha.'}</p>}
  </section>;
}

export function AddVariable({ period, people, initialOpen = false, preparing = false, disabled = false, onPendingChange }: { period: string; people: { id: string; name: string }[]; initialOpen?: boolean; preparing?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const { busy, error, run } = useMutation();
  const [kind, setKind] = useState('bonus');
  const [open, setOpen] = useState(initialOpen);
  const locked = busy || disabled;
  const earning = kind === 'bonus' || kind === 'other_earning';
  if (!open) return <button className="btn" disabled={locked} onClick={() => setOpen(true)}>Lançar variável</button>;
  return (
    <form
      className="form card cols4"
      aria-label="Variável do processamento"
      onChange={() => onPendingChange?.(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        onPendingChange?.(true);
        const f = formObject(e.currentTarget, ['amount']);
        const ok = await run('/v1/payroll-variables', 'POST', { ...f, period, inInss: f.inInss === 'on', inIrt: f.inIrt === 'on' });
        if (ok) { setOpen(false); onPendingChange?.(false); }
      }}
    >
      <h3>Nova variável de {period}</h3>
      <label className="span2">Colaborador
        <select name="employeeId" required disabled={locked}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <label>Tipo
        <select name="kind" disabled={locked} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="bonus">Prémio / gratificação</option>
          <option value="other_earning">Outro abono</option>
          <option value="advance">Adiantamento (desconto)</option>
          <option value="other_deduction">Outro desconto</option>
          <option value="salary_cut">Desconto na remuneração (reduz INSS/IRT — cálculo manual)</option>
        </select>
      </label>
      <label>Valor (Kz)<input name="amount" inputMode="decimal" required disabled={locked} /></label>
      <label className="span2">Descrição<input name="label" required disabled={locked} placeholder={earning ? 'Ex.: Prémio de desempenho do trimestre' : 'Ex.: Prestação do empréstimo 3/10'} /></label>
      {earning && (
        <div className="span2" style={{ display: 'flex', gap: 18, alignItems: 'end', paddingBottom: 8 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inInss" defaultChecked disabled={locked} style={{ height: 16 }} /> Incide INSS</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inIrt" defaultChecked disabled={locked} style={{ height: 16 }} /> Incide IRT</label>
        </div>
      )}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button type="button" className="btn ghost" disabled={locked} onClick={() => { setOpen(false); onPendingChange?.(false); }}>Cancelar</button>
        <button className="btn" disabled={locked}>Lançar</button>
      </div>
      <p className="muted wide">Depois de lançar, carregue em “{preparing ? 'Calcular folha' : 'Recalcular'}” para actualizar o processamento.</p>
    </form>
  );
}

export function DeleteVariable({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return error ? <span style={{ color: 'var(--red)' }}>{error}</span> : <button className="btn danger" disabled={busy} onClick={() => run(`/v1/payroll-variables/${id}`, 'DELETE')}>Remover</button>;
}
