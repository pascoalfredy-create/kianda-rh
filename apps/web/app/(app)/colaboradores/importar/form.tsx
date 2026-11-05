'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { EMPLOYEE_IMPORT_FIELDS, EMPLOYEE_IMPORT_LIMIT, employeeImportMappingProblem, employeeImportSourceRows, formatKz, guessEmployeeImportMapping, parseAmount, type EmployeeImportMapping, type EmployeeImportOptions, type EmployeeImportPreview, type EmployeeImportResult } from '@kianda/core';
import { send } from '@/lib/client';
import { EMPLOYEE_IMPORT_ACCEPT, guessEmployeeHeader, readEmployeeImportDocument, type EmployeeImportDocument } from '@/lib/employee-import';

const PAGE = 50;
export function EmployeeImportForm({ today }: { today: string }) {
  const [file, setFile] = useState<File | null>(null), [document, setDocument] = useState<EmployeeImportDocument | null>(null);
  const [sheet, setSheet] = useState(0), [header, setHeader] = useState(0), [mapping, setMapping] = useState<EmployeeImportMapping>({});
  const [options, setOptions] = useState<EmployeeImportOptions>({ salaryEffectiveDate: today, defaultContractType: 'indefinite', defaultCurrency: 'AOA', createDepartments: true, skipExisting: false });
  const [fx, setFx] = useState(''), [reading, setReading] = useState(false), [checking, setChecking] = useState(false), [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null), [result, setResult] = useState<EmployeeImportResult | null>(null), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false), [page, setPage] = useState(0);
  const [reviewFilter, setReviewFilter] = useState('all');
  const revision = useRef(0), controller = useRef<AbortController | null>(null), importId = useRef(''), input = useRef<HTMLInputElement>(null);
  const busy = reading || checking || committing;
  function invalidate() { revision.current++; setPreview(null); setConfirmed(false); setResult(null); setError(''); setPage(0); importId.current = ''; }
  function remove() { controller.current?.abort(); invalidate(); setFile(null); setDocument(null); setMapping({}); setHeader(0); setSheet(0); setReading(false); setChecking(false); if (input.current) input.current.value = ''; }
  async function load(next: File, nextSheet = 0) {
    controller.current?.abort(); invalidate(); const version = revision.current;
    const abort = new AbortController(); controller.current = abort;
    setFile(next); setDocument(null); setMapping({}); setSheet(nextSheet); setReading(true); setChecking(false);
    try {
      const doc = await readEmployeeImportDocument(next, nextSheet, abort.signal); if (revision.current !== version) return;
      const at = guessEmployeeHeader(doc.grid); setDocument(doc); setHeader(at); setMapping(guessEmployeeImportMapping((doc.grid[at] ?? []).map(v => String(v ?? '')))); if (!doc.grid.some(row => row.some(v => v !== null && v !== ''))) setError('A folha seleccionada está vazia. Escolha outra folha do Excel.');
    } catch (e) { if (revision.current === version && !abort.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível ler o ficheiro.'); }
    finally { if (revision.current === version) setReading(false); }
  }
  function changeOptions(change: Partial<EmployeeImportOptions>) { invalidate(); setOptions(o => ({ ...o, ...change })); }
  function payload() {
    if (!document || !file) throw new Error('Seleccione o documento.');
    const rows = employeeImportSourceRows(document.grid, header, mapping);
    if (!rows.length) throw new Error('Não existem colaboradores depois do cabeçalho. Preencha o modelo ou escolha a folha correcta.');
    if (rows.length > EMPLOYEE_IMPORT_LIMIT) throw new Error('Importe até 5.000 colaboradores por ficheiro.');
    const rate = fx.trim() ? parseAmount(fx) : null;
    if (fx.trim() && (rate === null || rate <= 0)) throw new Error('Indique um câmbio de referência válido.');
    return { sourceName: file.name, rows, options: { ...options, dateSystem: document.dateSystem, ...(rate === null ? {} : { usdRate: rate / 100 }) } };
  }
  async function validate() {
    let data: ReturnType<typeof payload>; try { data = payload(); } catch (e) { setError((e as Error).message); return; }
    const version = ++revision.current; setError(''); setPreview(null); setConfirmed(false); setChecking(true); setPage(0); importId.current = crypto.randomUUID();
    const response = await send<EmployeeImportPreview>('/v1/employees/import/preview', 'POST', data);
    if (version !== revision.current) return;
    setChecking(false); if (!response.ok) setError(response.message ?? 'A validação falhou.'); else { setPreview(response.data!); setReviewFilter(response.data!.counts.errors ? 'error' : 'all'); }
  }
  async function commit() {
    if (!preview?.canImport || !confirmed || committing) return;
    let data: ReturnType<typeof payload>; try { data = payload(); } catch (e) { setError((e as Error).message); return; }
    setCommitting(true); setError('');
    const response = await send<EmployeeImportResult>('/v1/employees/import/commit', 'POST', { ...data, importId: importId.current, fingerprint: preview.fingerprint, confirm: true });
    setCommitting(false);
    if (!response.ok) { setError((response.message ?? 'Não foi possível confirmar a importação.') + ' Pode repetir a mesma confirmação sem duplicar o lote.'); return; }
    setResult(response.data!); setPreview(null); setDocument(null); setFile(null); if (input.current) input.current.value = '';
  }
  const headers = document?.grid[header] ?? [];
  const reviewed = preview?.rows.filter(r => reviewFilter === 'all' || (reviewFilter === 'error' ? r.status === 'error' : !!r.warnings.length)) ?? [];
  const field = (f: typeof EMPLOYEE_IMPORT_FIELDS[number]) => <label key={f.key}>{f.label}{'required' in f ? ' *' : ''}<select aria-label={'Coluna: ' + f.label} value={mapping[f.key] ?? ''} disabled={busy} onChange={e => { invalidate(); const value = e.target.value; setMapping(m => { const next = { ...m }; if (value === '') delete next[f.key]; else next[f.key] = Number(value); return next; }); }}><option value="">— Não importar —</option>{headers.map((v, i) => <option key={i} value={i}>{i + 1}. {String(v ?? '') || '(sem título)'}</option>)}</select></label>;
  const visible = (key: string) => ['department', 'type', 'currency', 'meal', 'transport', 'nif', 'inssNumber', 'iban'].includes(key);
  return <>
    <div className="card section">
      <h2>1. Escolher o documento</h2>
      <p>Excel XLSX ou CSV é o formato recomendado para bases grandes. Também pode usar uma tabela em PDF com texto seleccionável ou Word DOCX. Até 10 MB e 5.000 colaboradores por ficheiro.</p>
      <label>Ficheiro de colaboradores<input ref={input} type="file" accept={EMPLOYEE_IMPORT_ACCEPT} disabled={committing} onChange={e => { const chosen = e.target.files?.[0]; if (chosen) void load(chosen); }} /></label>
      {file && <div className="form-actions"><span>{file.name}{reading ? ' · A ler…' : ''}</span><button type="button" className="btn ghost sm" disabled={committing} onClick={remove}>Remover documento</button></div>}
      {document && <div className="form">
        {document.sheets.length > 1 && <label>Folha do Excel<select value={sheet} disabled={busy} onChange={e => { if (file) void load(file, Number(e.target.value)); }}>{document.sheets.map((s, i) => <option key={i} value={i}>{s}</option>)}</select></label>}
        <label>Linha dos cabeçalhos<select value={header} disabled={busy} onChange={e => { const at = Number(e.target.value); invalidate(); setHeader(at); setMapping(guessEmployeeImportMapping(document.grid[at]!.map(v => String(v ?? '')))); }}>{document.grid.slice(0, 100).map((row, i) => row.some(v => v !== null && v !== '') ? <option key={i} value={i}>Linha {i + 1}: {row.map(v => String(v ?? '')).filter(Boolean).slice(0, 4).join(' · ').slice(0, 110)}</option> : null)}</select></label>
      </div>}
    </div>
    {document && <>
      <div className="card section"><h2>2. Associar as colunas</h2><p>Os campos com * são obrigatórios. Escolha o salário base bruto, antes de subsídios e descontos. Identificadores e IBAN devem vir como texto no Excel, para preservar os zeros e os dígitos.</p>
        <div className="form">{EMPLOYEE_IMPORT_FIELDS.filter(f => 'required' in f || visible(f.key)).map(field)}</div>
        <details><summary>Outros dados da ficha e do contrato</summary><div className="form">{EMPLOYEE_IMPORT_FIELDS.filter(f => !('required' in f) && !visible(f.key)).map(field)}</div></details>
        <p className="muted">{employeeImportMappingProblem(mapping) ?? 'As colunas obrigatórias estão associadas. A validação seguinte verifica cada pessoa.'}</p>
      </div>
      <div className="card section"><h2>3. Confirmar as regras de entrada</h2><div className="form">
        <label>Data de efeito da remuneração<input type="date" required value={options.salaryEffectiveDate} max={today} disabled={busy} onChange={e => changeOptions({ salaryEffectiveDate: e.target.value })} /><small>Usada nas linhas sem a coluna «Remuneração desde».</small></label>
        <label>Contrato quando a coluna estiver vazia<select value={options.defaultContractType} disabled={busy} onChange={e => changeOptions({ defaultContractType: e.target.value as EmployeeImportOptions['defaultContractType'] })}><option value="indefinite">Tempo indeterminado</option><option value="fixed_term">A termo</option><option value="internship">Estágio</option></select></label>
        <label>Moeda quando a coluna estiver vazia<select value={options.defaultCurrency} disabled={busy} onChange={e => changeOptions({ defaultCurrency: e.target.value as 'AOA' | 'USD' })}><option value="AOA">Kwanza (AOA)</option><option value="USD">Dólar (USD)</option></select></label>
        <label>Câmbio de referência (Kz por USD)<input inputMode="decimal" value={fx} placeholder="Preencher se houver salários em USD" disabled={busy} onChange={e => { invalidate(); setFx(e.target.value); }} /><small>Alimentação e transporte continuam em Kz. O processamento usa o câmbio confirmado no respectivo mês.</small></label>
      </div>
      <p><label><input type="checkbox" checked={options.createDepartments} disabled={busy} onChange={e => changeOptions({ createDepartments: e.target.checked })} /> Criar departamentos que ainda não existem</label></p>
      <p><label><input type="checkbox" checked={options.skipExisting} disabled={busy} onChange={e => changeOptions({ skipExisting: e.target.checked })} /> Ignorar pessoas já existentes, sem alterar as suas fichas</label></p>
      <p className="muted">A importação cria fichas, contratos e remuneração de referência. Folhas antigas não se tornam processamentos fechados. O acolhimento e os acessos ao portal podem ser preparados depois.</p>
      <button type="button" className="btn" disabled={busy || !!employeeImportMappingProblem(mapping)} onClick={() => void validate()}>{checking ? 'A validar…' : 'Validar e pré-visualizar'}</button>
      </div>
    </>}
    {error && <div className="alert" role="alert">{error}</div>}
    {preview && <div className="card section"><h2>4. Rever e importar</h2><p><b>{preview.counts.total}</b> linhas · <b>{preview.counts.ready}</b> novas · <b>{preview.counts.skipped}</b> ignoradas · <b>{preview.counts.errors}</b> com erro · <b>{preview.counts.warnings}</b> com avisos.</p>
      {preview.issues.map((message, i) => <p key={i} className="err">{message}</p>)}
      {!!preview.newDepartments.length && <details><summary>{preview.newDepartments.length} departamento(s) a criar — ver nomes e centros de custo</summary><ul>{preview.newDepartments.map(d => <li key={d.name}>{d.name} · {d.costCenter}</li>)}</ul></details>}
      <label>Mostrar na revisão<select value={reviewFilter} disabled={committing} onChange={e => { setReviewFilter(e.target.value); setPage(0); }}><option value="all">Todas as linhas</option><option value="error">Apenas erros</option><option value="warning">Apenas avisos</option></select></label>
      <div className="table-scroll"><table><thead><tr><th>Linha</th><th>N.º</th><th>Nome / função</th><th>Departamento</th><th className="num">Salário base de referência</th><th>Revisão</th></tr></thead><tbody>{reviewed.slice(page * PAGE, (page + 1) * PAGE).map(r => <tr key={r.line}><td>{r.line}</td><td>{r.data.number}</td><td><b>{r.data.name}</b><small className="muted"> · {r.data.jobTitle}</small></td><td>{r.data.department ?? '—'}</td><td className="num">{formatKz(Math.round(r.data.contract.base * 100))}{r.data.contract.baseUsd !== undefined && <small className="muted"> · USD {r.data.contract.baseUsd.toLocaleString('pt-PT')}</small>}</td><td><b>{r.status === 'ready' ? 'A criar' : r.status === 'skipped' ? 'Já existe — ignorar' : 'Corrigir'}</b>{r.errors.map((s, i) => <div className="err" key={'e' + i}>{s}</div>)}{r.warnings.map((s, i) => <div className="muted" key={'w' + i}>{s}</div>)}</td></tr>)}</tbody></table></div>
      <div className="form-actions"><button type="button" className="btn ghost sm" disabled={!page || committing} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1} de {Math.max(1, Math.ceil(reviewed.length / PAGE))}</span><button type="button" className="btn ghost sm" disabled={(page + 1) * PAGE >= reviewed.length || committing} onClick={() => setPage(p => p + 1)}>Seguinte</button></div>
      {preview.canImport ? <><p><label><input type="checkbox" checked={confirmed} disabled={committing} onChange={e => setConfirmed(e.target.checked)} /> Revi a pré-visualização e confirmo a criação de {preview.counts.ready} colaboradores e das respectivas remunerações.</label></p><button type="button" className="btn" disabled={!confirmed || committing} onClick={() => void commit()}>{committing ? 'A importar o lote…' : 'Confirmar importação de ' + preview.counts.ready + ' colaboradores'}</button></> : <p>Corrija os pontos no ficheiro ou nas opções e valide novamente. O lote só será guardado quando não houver erros.</p>}
    </div>}
    {result && <div className="card section" role="status"><h2>Importação concluída</h2><p>{result.created} colaboradores criados · {result.skipped} existentes ignorados · {result.departmentsCreated} departamentos criados.</p><Link href="/colaboradores" className="btn">Ver colaboradores</Link></div>}
  </>;
}
