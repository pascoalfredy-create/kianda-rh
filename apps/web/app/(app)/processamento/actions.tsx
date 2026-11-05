'use client';

import { useCallback, useEffect, useState } from 'react';
import { ContextLink as Link } from '@/components/context-link';
import { useClearWorkspace, useWorkspaceState } from '@/components/workspace-state';
import { formObject, useMutation } from '@/lib/client';
import { monthLabel } from '@/lib/format';
import { formatKz } from '@kianda/core';
import { BatchVariables, type BatchResult } from './batch-variables';
import { PayrollSelection } from './payroll-selection';
import type { PayrollBatchPerson } from '@/lib/types';

export function PrepareButton({ period, prepared, people, payrollPeople, processedIds, variableCount, indexed = 0, fx }: { period: string; prepared: boolean; people: { id: string; name: string }[]; payrollPeople: PayrollBatchPerson[]; processedIds: string[]; variableCount: number; indexed?: number; fx?: { rate: string | null; date: string | null; source: string | null } }) {
  const { busy, error, run } = useMutation();
  const draftKey = `payroll:${period}:preparation:`;
  const clearPreparation = useClearWorkspace(draftKey);
  const clearVariables = useClearWorkspace(`${draftKey}variables:`);
  const [open, setOpen] = useWorkspaceState(`${draftKey}open`, false);
  const [pendingVariable, setPendingVariable] = useState(false);
  const [savingVariable, setSavingVariable] = useState(false);
  const [variableVersion, setVariableVersion] = useState(0);
  const [batchMode, setBatchMode] = useWorkspaceState(`${draftKey}batch`, false);
  const [chosen, setSelected] = useWorkspaceState<string[]>(`${draftKey}selected`, []);
  const eligibleIds = new Set(payrollPeople.map(person => person.id));
  const selected = chosen.filter(id => typeof id === 'string' && eligibleIds.has(id));
  const [result, setResult] = useState('');
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const [rate, setRate] = useWorkspaceState(`${draftKey}rate`, fx?.rate ? String(Number(fx.rate)).replace('.', ',') : '');
  const [date, setDate] = useWorkspaceState(`${draftKey}date`, fx?.date ?? today);
  const [source, setSource] = useWorkspaceState(`${draftKey}source`, fx?.source ?? 'BNA — câmbio de referência');
  const indexedInScope = open && batchMode ? payrollPeople.filter(p => selected.includes(p.id) && p.salaryCurrency === 'USD' && !!p.baseForeignMinor).length : indexed;
  const needsFx = indexedInScope > 0;
  const body = { period, ...(needsFx && rate.trim() ? { fx: { rate, date, source } } : {}), ...(open && batchMode ? { employeeIds: selected } : {}) };
  const calculateDisabled = busy || savingVariable || pendingVariable || (needsFx && !rate.trim() && !fx?.rate) || (open && batchMode && (selected.length === 0 || selected.length > 1000));
  function prepare(batch: boolean) {
    clearVariables(); setResult(''); setBatchMode(batch); setPendingVariable(false); setVariableVersion(v => v + 1);
    const pending = payrollPeople.filter(p => !processedIds.includes(p.id));
    setSelected((pending.length ? pending : payrollPeople).slice(0, 1000).map(p => p.id)); setOpen(true);
  }
  async function calculate() {
    if (calculateDisabled) return;
    if (await run<{ lines: number; totalLines: number }>(open && batchMode ? '/v1/payroll-runs/batch' : '/v1/payroll-runs', 'POST', body, r => { if (r) setResult(`${open && batchMode ? 'Lote concluído' : 'Folha calculada'}: ${r.lines} colaborador(es) processado(s), ${r.totalLines} no total da folha mensal.`); })) { clearPreparation(); setOpen(false); setBatchMode(false); }
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
        <button type="button" className="btn" disabled={busy || (prepared && calculateDisabled)} onClick={() => prepared ? calculate() : prepare(false)}>{busy ? 'A calcular…' : prepared ? 'Recalcular' : 'Preparar processamento'}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => prepare(true)}>Processar em lote</button>
        {prepared && <button type="button" className="btn ghost" disabled={busy} onClick={() => prepare(false)}>Rever preparação</button>}
      </>}
      {open && <section aria-label="Preparação do processamento" style={{ width: '100%', minWidth: 0 }}>
        <h2>{batchMode ? 'Processar em lote — ' : 'Preparar '}{monthLabel(period)}</h2>
        <p className="muted">{batchMode ? 'Seleccione os colaboradores deste lote. Os lotes juntam-se na mesma folha mensal e o fecho faz-se após processar toda a equipa elegível.' : 'A folha calcula toda a equipa elegível do mês.'} O salário base e os subsídios fixos são reutilizados da remuneração em vigor. As faltas e horas extra vêm dos registos aprovados.</p>
        <PayrollSelection draftKey={`${draftKey}roster:`} people={payrollPeople} selected={selected} onChange={setSelected} processedIds={processedIds} disabled={busy} mode={batchMode ? 'selected' : 'all'} />
        <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', margin: '12px 0' }}>
          <Link className="btn ghost sm" href="/colaboradores">Rever salários e contratos</Link>
          <Link className="btn ghost sm" href={`/assiduidade?mes=${period}`}>Rever assiduidade</Link>
        </div>
        {fxFields}
        <h3>Alterações deste mês (opcional)</h3>
        <p className="muted">Pode calcular directamente com os valores habituais. Registe aqui apenas prémios, abonos ou descontos pontuais. {variableCount} {variableCount === 1 ? 'variável guardada' : 'variáveis guardadas'} para este mês.</p>
        {variableCount > 0 && <p><Link href={`/processamento?mes=${period}&s=variaveis`}>Rever e editar alterações guardadas ({variableCount})</Link></p>}
        {people.length > 0 && <VariableEntry key={variableVersion} draftKey={`${draftKey}variables:`} period={period} people={people} preparing disabled={busy} onPendingChange={setPendingVariable} onSavingChange={setSavingVariable} />}
        <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" className="btn" disabled={calculateDisabled} onClick={calculate}>{busy ? 'A calcular…' : batchMode ? 'Processar seleccionados' : 'Calcular folha'}</button>
          <button type="button" className="btn ghost" disabled={busy || savingVariable} onClick={() => { clearPreparation(); setOpen(false); setBatchMode(false); setPendingVariable(false); }}>Cancelar preparação</button>
          {pendingVariable && <><span className="muted" role="status">Existe uma alteração por guardar. Guarde-a ou descarte-a para calcular com os dados já registados.</span><button type="button" className="btn ghost sm" disabled={busy || savingVariable} onClick={() => { clearVariables(); setPendingVariable(false); setVariableVersion(v => v + 1); }}>Descartar alteração por guardar</button></>}
        </div>
      </section>}
      {needsFx && <span className="muted" style={{ fontSize: 12.5, flexBasis: '100%' }}>{indexedInScope} colaborador(es) com salário indexado ao dólar: a base é convertida a este câmbio no recibo.</span>}
      {error && <span role="alert" style={{ color: 'var(--red)' }}>{error}</span>}
      {result && !open && <p className="ok" role="status" style={{ flexBasis: '100%' }}>{result}</p>}
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

export function VariableEntry({ period, people, draftKey = `payroll:${period}:variables:`, initialOpen = false, preparing = false, disabled = false, onPendingChange, onSavingChange }: { period: string; people: { id: string; name: string }[]; draftKey?: string; initialOpen?: boolean; preparing?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void; onSavingChange?: (saving: boolean) => void }) {
  const [batch, setBatch] = useWorkspaceState(`${draftKey}batch`, false), [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<BatchResult | null>(null);
  const notify = useCallback((value: boolean) => { setPending(value); onPendingChange?.(value); }, [onPendingChange]);
  return <section aria-label="Lançamento de variáveis" style={{ minWidth: 0, width: '100%' }}>
    <div className="actions" style={{ justifyContent: 'flex-start', marginBottom: 10 }}><button type="button" className="btn ghost" disabled={disabled || pending} onClick={() => { setBatch(!batch); setSaved(null); }}>{batch ? 'Lançamento individual' : 'Lançar em lote'}</button></div>
    {batch ? <BatchVariables draftKey={`${draftKey}lot:`} period={period} people={people} disabled={disabled} onPendingChange={notify} onSavingChange={onSavingChange} onCancel={() => { notify(false); setBatch(false); }} onSaved={(result) => { setSaved(result); notify(false); setBatch(false); }} />
      : <AddVariable draftKey={`${draftKey}single:`} period={period} people={people} initialOpen={initialOpen} preparing={preparing} disabled={disabled} onPendingChange={notify} onSavingChange={onSavingChange} />}
    {saved && <p role="status" className="ok">Lote {saved.replayed ? 'já confirmado' : 'guardado'}: {saved.count} variável(eis), total {formatKz(saved.totalMinor)}. {preparing ? 'Clique em Calcular folha.' : 'Clique em Recalcular para actualizar a folha.'}</p>}
  </section>;
}

export function AddVariable({ period, people, draftKey = `payroll:${period}:single:`, initialOpen = false, preparing = false, disabled = false, onPendingChange, onSavingChange }: { period: string; people: { id: string; name: string }[]; draftKey?: string; initialOpen?: boolean; preparing?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void; onSavingChange?: (saving: boolean) => void }) {
  const { busy, error, run } = useMutation();
  const clearDraft = useClearWorkspace(draftKey);
  const [kind, setKind] = useWorkspaceState(`${draftKey}kind`, 'bonus');
  const [open, setOpen] = useWorkspaceState(`${draftKey}open`, initialOpen);
  const [fields, setFields] = useWorkspaceState(`${draftKey}fields`, { employeeId: people[0]?.id ?? '', amount: '', label: '', inInss: true, inIrt: true });
  const dirty = open && (!!fields.amount.trim() || !!fields.label.trim());
  useEffect(() => { onPendingChange?.(dirty); }, [dirty, onPendingChange]);
  const locked = busy || disabled;
  const earning = kind === 'bonus' || kind === 'other_earning';
  if (!open) return <button className="btn" disabled={locked} onClick={() => setOpen(true)}>Lançar variável</button>;
  return (
    <form
      className="form card cols4"
      aria-label="Variável do processamento"
      onSubmit={async (e) => {
        e.preventDefault();
        onPendingChange?.(true);
        const f = formObject(e.currentTarget, ['amount']);
        onSavingChange?.(true);
        try {
          const ok = await run('/v1/payroll-variables', 'POST', { ...f, period, inInss: f.inInss === 'on', inIrt: f.inIrt === 'on' });
          if (ok) { clearDraft(); setOpen(false); onPendingChange?.(false); }
        } finally { onSavingChange?.(false); }
      }}
    >
      <h3>Nova variável de {period}</h3>
      <label className="span2">Colaborador
        <select name="employeeId" required disabled={locked} value={fields.employeeId} onChange={e => setFields({ ...fields, employeeId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
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
      <label>Valor (Kz)<input name="amount" inputMode="decimal" required disabled={locked} value={fields.amount} onChange={e => setFields({ ...fields, amount: e.target.value })} /></label>
      <label className="span2">Descrição<input name="label" required disabled={locked} value={fields.label} onChange={e => setFields({ ...fields, label: e.target.value })} placeholder={earning ? 'Ex.: Prémio de desempenho do trimestre' : 'Ex.: Prestação do empréstimo 3/10'} /></label>
      {earning && (
        <div className="span2" style={{ display: 'flex', gap: 18, alignItems: 'end', paddingBottom: 8 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inInss" checked={fields.inInss} onChange={e => setFields({ ...fields, inInss: e.target.checked })} disabled={locked} style={{ height: 16 }} /> Incide INSS</label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="inIrt" checked={fields.inIrt} onChange={e => setFields({ ...fields, inIrt: e.target.checked })} disabled={locked} style={{ height: 16 }} /> Incide IRT</label>
        </div>
      )}
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        <button type="button" className="btn ghost" disabled={locked} onClick={() => { clearDraft(); setOpen(false); onPendingChange?.(false); }}>Cancelar</button>
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
