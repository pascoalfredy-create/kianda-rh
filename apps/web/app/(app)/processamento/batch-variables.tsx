'use client';

import { useEffect } from 'react';
import { useClearWorkspace, useWorkspaceState } from '@/components/workspace-state';
import { formatKz, parseAmount } from '@kianda/core';
import { useMutation } from '@/lib/client';
import { monthLabel } from '@/lib/format';

export interface BatchResult { batchId: string; count: number; totalMinor: number; replayed: boolean }
type Kind = 'bonus' | 'other_earning' | 'advance' | 'other_deduction' | 'salary_cut';

export function BatchVariables({ period, people, disabled, onPendingChange, onSavingChange, onCancel, onSaved, draftKey = `payroll:${period}:lot:` }: {
  period: string; people: { id: string; name: string }[]; disabled: boolean;
  draftKey?: string;
  onSavingChange?: (saving: boolean) => void;
  onPendingChange: (pending: boolean) => void; onCancel: () => void; onSaved: (result: BatchResult) => void;
}) {
  const { busy, error, run } = useMutation();
  const clearDraft = useClearWorkspace(draftKey);
  const [kind, setKind] = useWorkspaceState<Kind>(`${draftKey}kind`, 'bonus'), [label, setLabel] = useWorkspaceState(`${draftKey}label`, '');
  const [inInss, setInInss] = useWorkspaceState(`${draftKey}inInss`, true), [inIrt, setInIrt] = useWorkspaceState(`${draftKey}inIrt`, true);
  const [filter, setFilter] = useWorkspaceState(`${draftKey}filter`, ''), [page, setPage] = useWorkspaceState(`${draftKey}page`, 0);
  const [chosen, setChosen] = useWorkspaceState<string[]>(`${draftKey}selected`, []);
  const eligible = new Set(people.map(person => person.id));
  const selected = new Set(chosen.filter(id => typeof id === 'string' && eligible.has(id)));
  const setSelected = (value: Set<string>) => setChosen([...value]);
  const [amounts, setAmounts] = useWorkspaceState<Record<string, string>>(`${draftKey}amounts`, {}), [common, setCommon] = useWorkspaceState(`${draftKey}common`, '');
  const [request, setRequest] = useWorkspaceState(`${draftKey}request`, { payload: '', id: '' });
  const earning = kind === 'bonus' || kind === 'other_earning';
  const locked = disabled || busy;
  const filtered = people.filter((p) => p.name.toLocaleLowerCase('pt-PT').includes(filter.trim().toLocaleLowerCase('pt-PT')));
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * 50, (current + 1) * 50);
  const value = (id: string) => parseAmount(amounts[id] ?? '');
  const invalid = [...selected].filter((id) => (value(id) ?? 0) <= 0 || !Number.isSafeInteger(value(id)));
  const total = [...selected].reduce((sum, id) => sum + (value(id) ?? 0), 0);
  const canSave = !locked && selected.size > 0 && selected.size <= 1000 && !invalid.length && label.trim().length >= 2 && Number.isSafeInteger(total);
  const dirty = selected.size > 0 && (!!label.trim() || !!common.trim() || [...selected].some(id => !!amounts[id]?.trim()));
  useEffect(() => { onPendingChange(dirty); }, [dirty, onPendingChange]);
  function choose(id: string, checked: boolean) {
    const next = new Set(selected); checked ? next.add(id) : next.delete(id); setSelected(next);
  }
  return <form className="form card cols4" aria-label="Variáveis em lote" onSubmit={async (e) => {
    e.preventDefault();
    if (!canSave) return;
    const rows = [...selected].sort().map((employeeId) => ({ employeeId, amount: value(employeeId)! / 100 }));
    const body = { period, kind, label: label.trim(), inInss, inIrt, rows };
    const payload = JSON.stringify(body);
    const requestId = request.payload === payload && request.id ? request.id : crypto.randomUUID();
    setRequest({ payload, id: requestId });
    onPendingChange(true);
    onSavingChange?.(true);
    try { await run<BatchResult>('/v1/payroll-variables/batch', 'POST', { ...body, requestId }, (result) => { if (result) { clearDraft(); onSaved(result); } }); }
    finally { onSavingChange?.(false); }
  }}>
    <fieldset disabled={locked} style={{ display: 'contents' }}>
      <h3>Variáveis em lote · {monthLabel(period)}</h3>
      <p className="muted wide">Use este lote apenas para alterações pontuais do mês. Os salários e subsídios fixos já estão registados. Pode calcular a folha sem preencher este formulário. Para guardar uma alteração, indique os seus valores e descrição.</p>
      <label>Tipo do lote<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        <option value="bonus">Prémio / gratificação</option><option value="other_earning">Outro abono</option>
        <option value="advance">Adiantamento (desconto)</option><option value="other_deduction">Outro desconto</option>
        <option value="salary_cut">Desconto na remuneração (reduz INSS/IRT — cálculo manual)</option>
      </select></label>
      <label className="span2">Descrição do lote<input value={label} onChange={(e) => setLabel(e.target.value)} required minLength={2} maxLength={160} placeholder={earning ? 'Ex.: Prémio de desempenho do mês' : 'Ex.: Desconto acordado do mês'} /></label>
      {earning && <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={inInss} onChange={(e) => setInInss(e.target.checked)} style={{ width: 16, height: 16 }} /> Incide INSS</label>
        <label style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={inIrt} onChange={(e) => setInIrt(e.target.checked)} style={{ width: 16, height: 16 }} /> Incide IRT</label>
      </div>}
      <label className="span2">Pesquisar colaboradores<input value={filter} onChange={(e) => { e.stopPropagation(); setFilter(e.target.value); setPage(0); }} placeholder="Nome do colaborador" /></label>
      <label>Valor comum (Kz)<input inputMode="decimal" value={common} onChange={(e) => setCommon(e.target.value)} placeholder="Opcional" /></label>
      <div style={{ alignSelf: 'end' }}><button type="button" className="btn ghost sm" disabled={!selected.size || (parseAmount(common) ?? 0) <= 0} onClick={() => {
        setAmounts((before) => { const next = { ...before }; for (const id of selected) next[id] = common; return next; });
      }}>Aplicar valor aos seleccionados</button></div>
      <div className="wide actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn ghost sm" disabled={!filtered.length || new Set([...selected, ...filtered.map(p => p.id)]).size > 1000} onClick={() => { setSelected(new Set([...selected, ...filtered.map(p => p.id)])); }}>Seleccionar resultados ({filtered.length})</button>
        <button type="button" className="btn ghost sm" disabled={!selected.size} onClick={() => { setSelected(new Set()); }}>Limpar selecção</button>
        <span className="muted">{selected.size} seleccionado(s) · valor do lote {Number.isSafeInteger(total) ? formatKz(total) : 'Total acima do limite'}</span>
      </div>
      <div className="wide table-scroll">
        <table aria-label="Colaboradores do lote"><thead><tr><th>Seleccionar</th><th>Colaborador</th><th>Valor (Kz)</th></tr></thead><tbody>
          {visible.map((p) => <tr key={p.id}>
            <td><input type="checkbox" aria-label={`Seleccionar ${p.name}`} checked={selected.has(p.id)} disabled={!selected.has(p.id) && selected.size >= 1000} onChange={(e) => choose(p.id, e.target.checked)} style={{ width: 16, height: 16 }} /></td>
            <td>{p.name}</td>
            <td><input inputMode="decimal" aria-label={`Valor de ${p.name}`} value={amounts[p.id] ?? ''} disabled={!selected.has(p.id)} required={selected.has(p.id)} onChange={(e) => setAmounts((before) => ({ ...before, [p.id]: e.target.value }))} style={{ width: 140, maxWidth: '100%' }} /></td>
          </tr>)}
        </tbody></table>
        {!filtered.length && <p className="empty">Sem colaboradores com esse nome.</p>}
      </div>
      <div className="wide actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn ghost sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</button>
        <span className="muted">Página {current + 1} de {pages} · {filtered.length} resultado(s)</span>
        <button type="button" className="btn ghost sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Seguinte</button>
      </div>
      <p className="muted wide">Até 1.000 colaboradores por lote. A selecção mantém-se ao mudar a pesquisa ou a página. Pode ajustar cada valor depois de aplicar o valor comum.</p>
      {!!invalid.length && <p className="muted wide">{invalid.length} valor(es) por preencher ou corrigir entre os seleccionados.</p>}
      <div className="form-actions">
        {error && <span className="err" role="alert">{error}</span>}
        <button type="button" className="btn ghost" onClick={() => { clearDraft(); onCancel(); }}>Cancelar lote</button>
        <button className="btn" disabled={!canSave}>{busy ? 'A guardar o lote…' : 'Guardar lote'}</button>
      </div>
    </fieldset>
  </form>;
}
