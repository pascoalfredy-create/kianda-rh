'use client';
import { ContextLink as Link } from '@/components/context-link';
import { useWorkspaceState } from '@/components/workspace-state';
import { formatKz } from '@kianda/core';
import type { PayrollBatchPerson } from '@/lib/types';

export function PayrollSelection({ people, selected, onChange, processedIds, disabled, mode = 'selected', draftKey = 'payroll:roster:' }: { people: PayrollBatchPerson[]; selected: string[]; onChange: (ids: string[]) => void; processedIds: string[]; disabled: boolean; mode?: 'all' | 'selected'; draftKey?: string }) {
  const selectable = mode === 'selected';
  const [search, setSearch] = useWorkspaceState(`${draftKey}search`, ''), [department, setDepartment] = useWorkspaceState(`${draftKey}department`, ''), [pendingOnly, setPendingOnly] = useWorkspaceState(`${draftKey}pending`, false), [page, setPage] = useWorkspaceState(`${draftKey}page`, 0);
  const chosen = new Set(selected), processed = new Set(processedIds);
  const departments = [...new Set(people.map(p => p.department ?? 'Sem departamento'))].sort();
  const query = search.toLocaleLowerCase('pt');
  const filtered = people.filter(p => (!department || (p.department ?? 'Sem departamento') === department) && (!pendingOnly || !processed.has(p.id)) && `${p.name} ${p.number} ${p.jobTitle}`.toLocaleLowerCase('pt').includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), current = Math.min(page, pages - 1), visible = filtered.slice(current * 50, current * 50 + 50);
  function select(ids: string[], checked: boolean) { const next = new Set(selected); for (const id of ids) checked ? next.add(id) : next.delete(id); onChange([...next]); }
  return <section aria-label={selectable ? 'Colaboradores do processamento em lote' : 'Remunerações habituais do mês'} style={{ margin: '12px 0', minWidth: 0 }}>
    <h3>{selectable ? 'Seleccionar colaboradores do mês' : 'Remunerações habituais do mês'}</h3><p className="muted">Valores da ficha salarial em vigor. Para uma alteração permanente, use a ficha salarial do colaborador.</p>
    {selectable && <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', margin: '10px 0' }}>
      <label>Pesquisar colaborador<input aria-label="Pesquisar colaborador do lote" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
      <label>Departamento<select aria-label="Departamento do lote" value={department} onChange={e => { setDepartment(e.target.value); setPage(0); }}><option value="">Todos</option>{departments.map(d => <option key={d}>{d}</option>)}</select></label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={pendingOnly} onChange={e => { setPendingOnly(e.target.checked); setPage(0); }} /> Só por processar</label>
      <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => select(filtered.map(p => p.id), true)}>Seleccionar resultados ({filtered.length})</button>
      <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => onChange([])}>Limpar selecção</button>
    </div>}
    <div style={{ overflowX: 'auto' }}><table className="dense" aria-label={selectable ? 'Selecção de salários do lote' : 'Remunerações do mês'}><thead><tr>{selectable && <th>Seleccionar</th>}<th>Colaborador</th><th>Departamento</th><th className="num">Base mensal</th><th className="num">Alimentação / transporte</th><th>Na folha</th><th>Remuneração</th></tr></thead><tbody>{visible.map(p => <tr key={p.id}>
      {selectable && <td><input type="checkbox" aria-label={`Processar ${p.name}`} checked={chosen.has(p.id)} disabled={disabled} onChange={e => select([p.id], e.target.checked)} /></td>}
      <td><b>{p.name}</b><div className="muted">N.º {p.number} · {p.jobTitle}</div></td><td>{p.department ?? '—'}</td>
      <td className="num">{p.salaryCurrency === 'USD' && p.baseForeignMinor != null ? `USD ${(p.baseForeignMinor / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}` : formatKz(p.baseMinor)}</td>
      <td className="num">{formatKz(p.mealMinor)} / {formatKz(p.transportMinor)}</td><td>{processed.has(p.id) ? 'Já processado' : 'Por processar'}</td><td><Link href={`/colaboradores/${p.id}?s=contrato`}>Ficha salarial</Link></td>
    </tr>)}</tbody></table></div>
    {!filtered.length && <p className="muted">Nenhum colaborador elegível para este filtro e mês.</p>}
    <div className="actions" style={{ justifyContent: 'space-between', marginTop: 10 }}><b>{selectable ? `${selected.length} colaborador(es) seleccionado(s)` : `${people.length} colaborador(es) elegível(eis)`}</b><span><button type="button" className="btn ghost sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</button> {current + 1} / {pages} <button type="button" className="btn ghost sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Seguinte</button></span></div>
    {selectable && selected.length > 1000 && <p className="err" role="alert">Cada lote pode conter até 1.000 colaboradores. Divida a selecção em lotes.</p>}
  </section>;
}
