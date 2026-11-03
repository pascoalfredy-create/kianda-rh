'use client';

import { useMemo, useRef, useState } from 'react';
import {
  OFF_CODE, SHIFT_COLOR_LABEL, SHIFT_COLORS, applyPattern, formatShiftHours, isNightShift, parsePattern, rosterChecks, shiftTypeIssue, shiftWorkMinutes,
  type RosterEntry, type RosterIssue,
} from '@kianda/core';
import { send, useMutation } from '@/lib/client';
import { DocumentPrintButton, ExportLink } from '@/components/document-export';
import { chipStyle, dm, weekday, type RosterData, type RosterEmployee, type ShiftType, type TypesData } from './types';

type Value = string | null; // id do tipo de turno, «off» ou null (vazio)
const key = (e: string, d: string) => `${e}|${d}`;
const SEVERITY: Record<RosterIssue['severity'], [string, string]> = { error: ['Erro', 'st rejected'], warning: ['Aviso', 'st pending'], info: ['Nota', 'tag'] };

/** Escala editável: pincel (turno, folga ou limpar), arrastar para pintar, padrões, cópia, gravação e publicação. */
export function RosterBoard({ data, canPlan, copySource }: { data: RosterData; canPlan: boolean; copySource: { from: string; to: string } | null }) {
  const { busy, error, setError, run } = useMutation();
  const active = data.types.filter(t => t.active);
  const typeById = useMemo(() => new Map(data.types.map(t => [t.id, t])), [data.types]);
  const saved = useMemo(() => new Map(data.cells.map(c => [key(c.employeeId, c.date), c])), [data.cells]);
  const [drafts, setDrafts] = useState<Record<string, Value>>({});
  const [brush, setBrush] = useState<string>(active[0]?.id ?? 'off');
  const [dept, setDept] = useState('');
  const [query, setQuery] = useState('');
  const [patternOpen, setPatternOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const painting = useRef(false);
  const editable = canPlan && data.employees.some(e => e.canEdit);

  const savedValue = (e: string, d: string): Value => { const c = saved.get(key(e, d)); return !c || c.kind === 'none' ? null : c.kind === 'off' ? 'off' : c.shiftTypeId; };
  const value = (e: string, d: string): Value => key(e, d) in drafts ? drafts[key(e, d)]! : savedValue(e, d);
  const canEditCell = (e: RosterEmployee, d: string) => canPlan && e.canEdit && !e.lockedDays.includes(d) && !(e.startDate && d < e.startDate);
  const setCells = (cells: { employeeId: string; date: string; value: Value }[]) => {
    setNotice('');
    setDrafts(prev => {
      const next = { ...prev };
      for (const c of cells) {
        const k = key(c.employeeId, c.date);
        if (savedValue(c.employeeId, c.date) === c.value) delete next[k]; else next[k] = c.value;
      }
      return next;
    });
  };
  const paint = (e: RosterEmployee, d: string) => { if (canEditCell(e, d)) setCells([{ employeeId: e.id, date: d, value: brush === 'clear' ? null : brush }]); };

  const departments = [...new Map(data.employees.map(e => [e.departmentId ?? '', e.department ?? 'Sem departamento'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
  const term = query.trim().toLocaleLowerCase('pt-PT');
  const shown = data.employees.filter(e => (!dept || (e.departmentId ?? '') === dept) && (!term || `${e.name} ${e.number} ${e.jobTitle}`.toLocaleLowerCase('pt-PT').includes(term)));
  const draftCount = Object.keys(drafts).length;

  // Verificações em directo sobre o planeado (com o que ainda não foi gravado).
  const issues = useMemo(() => {
    const entries: RosterEntry[] = [];
    for (const e of data.employees) for (const d of data.days) {
      const v = value(e.id, d);
      if (v === null) continue;
      entries.push({ employeeId: e.id, date: d, shift: v === 'off' ? null : typeById.get(v) ?? null });
    }
    return rosterChecks({
      from: data.from, to: data.to, entries, minRestMinutes: data.minRestMinutes, weeklyHours: data.weeklyHours, extendedWeeklyHours: data.extendedWeeklyHours,
      employees: data.employees.map(e => ({ id: e.id, name: e.name, rotation: e.rotation })), types: active,
      holidays: new Map(Object.entries(data.holidays)), absences: new Map(data.employees.map(e => [e.id, new Map(Object.entries(e.absences))])),
      before: data.previous.map(p => ({ employeeId: p.employeeId, date: p.date, shift: p.kind === 'off' ? null : typeById.get(p.shiftTypeId ?? '') ?? null })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, data]);
  const issueKeys = new Set(issues.filter(i => i.employeeId && i.severity !== 'info').map(i => key(i.employeeId!, i.date)));

  async function save() {
    const changes = Object.entries(drafts).map(([k, v]) => { const [employeeId, date] = k.split('|') as [string, string]; return { employeeId, date, value: v }; });
    if (await run('/v1/shifts/roster', 'PUT', { changes })) { setDrafts({}); setNotice(`${changes.length} dia(s) gravados. Publique para a equipa ver.`); }
  }
  async function publish() {
    if (!window.confirm(`Publicar ${data.pendingCount} dia(s) da escala? Os colaboradores passam a ver os turnos e recebem um aviso no telemóvel.`)) return;
    await run<{ published: number; employees: number }>('/v1/shifts/publish', 'POST', { from: data.from, to: data.to }, r => setNotice(`Publicados ${r?.published ?? 0} dia(s) de ${r?.employees ?? 0} colaborador(es).`));
  }
  async function copy() {
    if (!copySource || !window.confirm(`Copiar a escala de ${dm(copySource.from)} a ${dm(copySource.to)} para estes dias? Os dias já planeados são substituídos.`)) return;
    await run<{ saved: number }>('/v1/shifts/copy', 'POST', { from: copySource.from, to: copySource.to, target: data.from }, r => setNotice(`${r?.saved ?? 0} dia(s) copiados (por publicar).`));
  }

  const exportUrl = `/api/v1/shifts/export?from=${data.from}&to=${data.to}`;
  const plannedMinutes = (e: RosterEmployee) => data.days.reduce((s, d) => { const v = value(e.id, d); return s + (v && v !== 'off' ? shiftWorkMinutes(typeById.get(v)!) : 0); }, 0);
  const coverage = (t: ShiftType, d: string) => data.employees.filter(e => value(e.id, d) === t.id).length;

  if (!data.types.length) return <div className="card section"><div className="empty">
    Ainda não há tipos de turno. {data.canManageTypes ? <>Crie-os no separador <a href="?v=tipos"><b>Tipos de turno</b></a> (por exemplo Manhã 06:00–14:00, Tarde 14:00–22:00 e Noite 22:00–06:00).</> : 'Peça ao RH para os criar.'}
  </div></div>;

  return <>
    {editable && <div className="card section no-print roster-tools" onMouseUp={() => { painting.current = false; }}>
      <div className="roster-brush" role="radiogroup" aria-label="Pincel">
        <span className="muted">Pincel</span>
        {active.map(t => <button key={t.id} type="button" role="radio" aria-checked={brush === t.id} className={`brush ${brush === t.id ? 'on' : ''}`} onClick={() => setBrush(t.id)} title={`${t.name} ${t.startTime}–${t.endTime}`}>
          <span className="shift-chip" style={chipStyle(t.color)}>{t.code}</span><small>{t.startTime}–{t.endTime}</small></button>)}
        <button type="button" role="radio" aria-checked={brush === 'off'} className={`brush ${brush === 'off' ? 'on' : ''}`} onClick={() => setBrush('off')}><span className="shift-chip off">{OFF_CODE}</span><small>Folga</small></button>
        <button type="button" role="radio" aria-checked={brush === 'clear'} className={`brush ${brush === 'clear' ? 'on' : ''}`} onClick={() => setBrush('clear')}><span className="shift-chip clear">×</span><small>Limpar</small></button>
      </div>
      <div className="roster-actions">
        <button type="button" className="btn ghost sm" onClick={() => setPatternOpen(!patternOpen)}>Aplicar padrão</button>
        {copySource && <button type="button" className="btn ghost sm" disabled={busy || draftCount > 0} onClick={copy}>Copiar período anterior</button>}
        <span className="grow" />
        {draftCount > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setDrafts({})}>Descartar</button>}
        <button type="button" className="btn sm" disabled={busy || !draftCount} onClick={save}>Gravar{draftCount ? ` (${draftCount})` : ''}</button>
        <button type="button" className="btn sm" disabled={busy || draftCount > 0 || !data.pendingCount} onClick={publish} title={draftCount ? 'Grave primeiro as alterações' : undefined}>Publicar{data.pendingCount ? ` (${data.pendingCount})` : ''}</button>
      </div>
      {(error || notice) && <p className={error ? 'err' : 'ok'} style={{ padding: '0 14px 12px' }}>{error || notice}</p>}
      {patternOpen && <PatternPanel data={data} employees={shown.filter(e => e.canEdit)} onClose={() => setPatternOpen(false)} onApply={(cells) => {
        const ok = cells.filter(c => { const e = data.employees.find(x => x.id === c.employeeId)!; return canEditCell(e, c.date); });
        setCells(ok); setPatternOpen(false); setError(''); setNotice(`Padrão aplicado a ${ok.length} dia(s). Reveja e grave.`);
      }} valueOf={value} />}
    </div>}

    <div className="page-head no-print" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
      <div className="month-nav" style={{ gap: 8 }}>
        <input aria-label="Procurar colaborador" placeholder="Procurar colaborador…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: 220 }} />
        {departments.length > 1 && <select aria-label="Departamento" value={dept} onChange={e => setDept(e.target.value)}>
          <option value="">Todos os departamentos</option>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>}
      </div>
      <div className="month-nav"><ExportLink className="btn ghost sm" href={exportUrl}>Excel</ExportLink><DocumentPrintButton className="btn ghost sm" /></div>
    </div>

    <div className="card" onMouseLeave={() => { painting.current = false; }} onMouseUp={() => { painting.current = false; }}>
      <div className="map-wrap">
        <table className="map roster">
          <thead><tr>
            <th className="name">Colaborador</th>
            {data.days.map(d => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th key={d} className={`day ${wd === 0 || wd === 6 ? 'we' : ''} ${data.holidays[d] ? 'hol' : ''} ${d === data.today ? 'today' : ''}`} title={data.holidays[d]}>{Number(d.slice(8))}<small>{weekday(d)}</small></th>; })}
            <th className="num">Horas</th>
          </tr></thead>
          <tbody>
            {shown.map(e => <tr key={e.id}>
              <td className="name"><b>{e.name}</b><div className="muted">{[e.number, e.department, e.schedule].filter(Boolean).join(' · ')}</div></td>
              {data.days.map(d => {
                const v = value(e.id, d), c = saved.get(key(e.id, d)), k = key(e.id, d);
                const t = v && v !== 'off' ? typeById.get(v) : undefined;
                const abs = e.absences[d], locked = e.lockedDays.includes(d), before = !!e.startDate && d < e.startDate;
                const can = canEditCell(e, d);
                const draft = k in drafts, removed = v === null && !!c?.published;
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                const label = `${e.name}, ${weekday(d)} ${dm(d)}: ${t ? `${t.code} ${t.name} ${t.startTime}–${t.endTime}` : v === 'off' ? 'folga' : 'sem turno'}${abs ? ` · ${abs}` : ''}${locked ? ' · bloqueado' : ''}`;
                return <td key={d} className={`cell ${wd === 0 || wd === 6 ? 'we' : ''} ${data.holidays[d] ? 'hol' : ''} ${d === data.today ? 'today' : ''} ${abs ? 'abs' : ''} ${issueKeys.has(k) ? 'issue' : ''}`}>
                  <button type="button" className={`roster-cell ${draft ? 'draft' : ''} ${!draft && c?.pending ? 'pending' : ''}`} disabled={!can} aria-label={label} title={label}
                    onMouseDown={ev => { if (ev.button !== 0) return; painting.current = true; paint(e, d); }} onMouseEnter={() => { if (painting.current) paint(e, d); }}
                    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); paint(e, d); } }}>
                    {t ? <span className="shift-chip" style={chipStyle(t.color)}>{t.code}</span>
                      : v === 'off' ? <span className="shift-chip off">{OFF_CODE}</span>
                      : removed ? <span className="shift-chip removed">{c!.published!.kind === 'off' ? OFF_CODE : c!.published!.code}</span>
                      : locked || before ? <span className="muted" aria-hidden="true">·</span> : null}
                  </button>
                </td>;
              })}
              <td className="num">{formatShiftHours(plannedMinutes(e))}</td>
            </tr>)}
          </tbody>
          <tfoot>{active.map(t => <tr key={t.id} className="coverage">
            <td className="name"><span className="shift-chip" style={chipStyle(t.color)}>{t.code}</span> {t.name}{t.minStaff ? <span className="muted"> · mín. {t.minStaff}</span> : null}</td>
            {data.days.map(d => { const n = coverage(t, d); return <td key={d} className={`cell ${t.minStaff && n < t.minStaff ? 'short' : ''}`}>{n || ''}</td>; })}
            <td />
          </tr>)}</tfoot>
        </table>
      </div>
      {!shown.length && <div className="empty">Nenhum colaborador neste filtro.</div>}
      <div className="legend">
        {active.map(t => <span key={t.id}><span className="shift-chip" style={chipStyle(t.color)}>{t.code}</span> {t.name} {t.startTime}–{t.endTime}</span>)}
        <span><span className="shift-chip off">{OFF_CODE}</span> Folga</span>
        <span className="no-print"><span className="legend-mark draft" /> Por gravar</span>
        <span className="no-print"><span className="legend-mark pending" /> Gravado, por publicar</span>
        <span className="no-print"><span className="shift-chip removed">M</span> A retirar ao publicar</span>
        <span className="muted no-print">Dias sem turno seguem o horário habitual do colaborador.</span>
      </div>
    </div>

    <div className="card section no-print" style={{ marginTop: 16 }}>
      <h2>Verificações {issues.length ? `(${issues.length})` : ''}</h2>
      {issues.length ? <table className="dense"><tbody>{issues.slice(0, 80).map((i, n) => <tr key={n}><td style={{ width: 90 }}><span className={SEVERITY[i.severity][1]}>{SEVERITY[i.severity][0]}</span></td><td>{i.message}</td></tr>)}</tbody></table>
        : <div className="empty">Sem avisos: descansos, horas semanais e cobertura dentro dos limites.</div>}
      {issues.length > 80 && <p className="muted" style={{ padding: '0 16px 12px' }}>E mais {issues.length - 80} aviso(s).</p>}
    </div>
    {!editable && canPlan && <p className="muted">Só pode planear os turnos da sua equipa directa.</p>}
  </>;
}

function PatternPanel({ data, employees, onApply, onClose, valueOf }: {
  data: RosterData; employees: RosterEmployee[]; onClose: () => void; valueOf: (e: string, d: string) => Value;
  onApply: (cells: { employeeId: string; date: string; value: Value }[]) => void;
}) {
  const active = data.types.filter(t => t.active);
  const byCode = new Map(active.map(t => [t.code, t]));
  const [selected, setSelected] = useState<string[]>(employees.map(e => e.id));
  const [text, setText] = useState(active.length >= 3 ? `${active[0]!.code}×2 ${active[1]!.code}×2 ${active[2]!.code}×2 F×2` : `${active[0]?.code ?? 'M'}×5 F×2`);
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  const [stagger, setStagger] = useState(0);
  const [offset, setOffset] = useState(0);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const parsed = parsePattern(text, active.map(t => t.code));
  const cells = parsed.error || from > to ? [] : applyPattern({
    employeeIds: employees.filter(e => selected.includes(e.id)).map(e => e.id), from, to, sequence: parsed.sequence, stagger, startOffset: offset,
    skip: onlyEmpty ? (e, d) => valueOf(e, d) !== null : undefined,
  });
  const preview = employees.filter(e => selected.includes(e.id)).slice(0, 4);
  return <div className="pattern-panel">
    <div className="form">
      <label className="span2">Padrão<input value={text} onChange={e => setText(e.target.value)} placeholder="M M T T N N F F" /></label>
      <label>De<input type="date" value={from} min={data.from} max={data.to} onChange={e => setFrom(e.target.value)} /></label>
      <label>Até<input type="date" value={to} min={data.from} max={data.to} onChange={e => setTo(e.target.value)} /></label>
      <label>Começar no dia do padrão<input type="number" min={1} max={120} value={offset + 1} onChange={e => setOffset(Math.max(0, Number(e.target.value) - 1))} /></label>
      <label>Desfasar cada colaborador (dias)<input type="number" min={0} max={60} value={stagger} onChange={e => setStagger(Math.max(0, Number(e.target.value)))} /></label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={onlyEmpty} onChange={e => setOnlyEmpty(e.target.checked)} style={{ height: 'auto' }} />Só dias vazios</label>
      <p className="muted wide">Códigos separados por espaços, {OFF_CODE} = folga, repetição com ×: «{active.map(t => t.code).slice(0, 3).join('×2 ')}×2 {OFF_CODE}×2». O padrão repete-se até ao fim do intervalo; com desfasamento, cada colaborador seguinte começa mais tarde no ciclo (equipas em rotação).</p>
      <fieldset className="wide pattern-people"><legend>Colaboradores ({selected.length} de {employees.length}) <button type="button" className="link" onClick={() => setSelected(selected.length === employees.length ? [] : employees.map(e => e.id))}>{selected.length === employees.length ? 'nenhum' : 'todos'}</button></legend>
        {employees.map(e => <label key={e.id}><input type="checkbox" checked={selected.includes(e.id)} onChange={ev => setSelected(ev.target.checked ? [...selected, e.id] : selected.filter(x => x !== e.id))} style={{ height: 'auto' }} />{e.name}</label>)}
      </fieldset>
      {parsed.error ? <div className="preview bad">{parsed.error}</div> : <div className="preview">
        {preview.map(e => <div key={e.id} className="pattern-row"><b>{e.name.split(' ')[0]}</b>{cells.filter(c => c.employeeId === e.id).slice(0, 14).map(c => { const t = c.code ? byCode.get(c.code) : undefined; return <span key={c.date} className="shift-chip" style={t ? chipStyle(t.color) : undefined} title={dm(c.date)}>{t ? t.code : OFF_CODE}</span>; })}</div>)}
        {!preview.length && 'Escolha pelo menos um colaborador.'}
      </div>}
      <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn" disabled={!!parsed.error || !cells.length} onClick={() => onApply(cells.map(c => ({ employeeId: c.employeeId, date: c.date, value: c.code ? byCode.get(c.code)!.id : 'off' })))}>Aplicar a {cells.length} dia(s)</button></div>
    </div>
  </div>;
}

/** Tipos de turno da empresa e intervalo mínimo entre turnos. */
export function ShiftTypesEditor({ data }: { data: TypesData }) {
  const [editing, setEditing] = useState<string | null>(null);
  return <>
    <div className="card section">
      <table>
        <thead><tr><th>Código</th><th>Turno</th><th>Horas</th><th className="num">Trabalho</th><th className="num">Mínimo de pessoas</th><th>Situação</th>{data.canManage && <th />}</tr></thead>
        <tbody>{data.types.map(t => editing === t.id
          ? <tr key={t.id}><td colSpan={7} style={{ padding: 0 }}><TypeForm type={t} onDone={() => setEditing(null)} /></td></tr>
          : <tr key={t.id}>
            <td><span className="shift-chip" style={chipStyle(t.color)}>{t.code}</span></td>
            <td><b>{t.name}</b>{isNightShift(t) && <span className="tag" style={{ marginLeft: 6 }}>Nocturno</span>}</td>
            <td>{t.startTime}–{t.endTime}{t.breakMinutes ? <span className="muted"> · intervalo {t.breakMinutes} min</span> : null}</td>
            <td className="num">{formatShiftHours(t.workMinutes)}</td>
            <td className="num">{t.minStaff ?? '—'}</td>
            <td>{t.active ? <span className="st approved">Activo</span> : <span className="st cancelled">Desactivado</span>}</td>
            {data.canManage && <td className="num"><button type="button" className="btn ghost sm" onClick={() => setEditing(t.id)}>Editar</button></td>}
          </tr>)}</tbody>
      </table>
      {!data.types.length && <div className="empty">Ainda não há tipos de turno.</div>}
    </div>
    {data.canManage && (editing === 'new' ? <div className="card section"><h2>Novo tipo de turno</h2><TypeForm onDone={() => setEditing(null)} /></div>
      : <p style={{ marginBottom: 16 }}><button type="button" className="btn ghost sm" onClick={() => setEditing('new')}>Novo tipo de turno</button></p>)}
    <RestSetting minutes={data.minRestMinutes} canManage={data.canManage} />
  </>;
}

function TypeForm({ type, onDone }: { type?: ShiftType; onDone: () => void }) {
  const { busy, error, setError, run } = useMutation();
  const [f, setF] = useState({ code: type?.code ?? '', name: type?.name ?? '', startTime: type?.startTime ?? '06:00', endTime: type?.endTime ?? '14:00', breakMinutes: type?.breakMinutes ?? 30, color: type?.color ?? 'blue', minStaff: type?.minStaff ?? null as number | null, active: type?.active ?? true });
  const set = (patch: Partial<typeof f>) => { setError(''); setF({ ...f, ...patch }); };
  const issue = shiftTypeIssue({ ...f, code: f.code.toUpperCase() });
  const work = /^\d\d:\d\d$/.test(f.startTime) && /^\d\d:\d\d$/.test(f.endTime) && f.startTime !== f.endTime ? shiftWorkMinutes(f) : 0;
  return <form className="form" onSubmit={async e => {
    e.preventDefault();
    const payload = { ...f, code: f.code.toUpperCase(), minStaff: f.minStaff || null };
    if (await run(type ? `/v1/shifts/types/${type.id}` : '/v1/shifts/types', type ? 'PATCH' : 'POST', type ? payload : { ...payload, active: undefined })) onDone();
  }}>
    <label>Código<input value={f.code} maxLength={3} required onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="M" /></label>
    <label className="span2">Nome<input value={f.name} maxLength={40} required onChange={e => set({ name: e.target.value })} placeholder="Manhã" /></label>
    <label>Entrada<input type="time" value={f.startTime} required onChange={e => set({ startTime: e.target.value })} /></label>
    <label>Saída<input type="time" value={f.endTime} required onChange={e => set({ endTime: e.target.value })} /></label>
    <label>Intervalo (min)<input type="number" min={0} max={240} value={f.breakMinutes} onChange={e => set({ breakMinutes: Number(e.target.value) })} /></label>
    <label>Mínimo de pessoas por dia<input type="number" min={0} max={500} value={f.minStaff ?? ''} placeholder="sem mínimo" onChange={e => set({ minStaff: e.target.value === '' ? null : Number(e.target.value) })} /></label>
    <label>Cor<select value={f.color} onChange={e => set({ color: e.target.value })}>{SHIFT_COLORS.map(c => <option key={c} value={c}>{SHIFT_COLOR_LABEL[c]}</option>)}</select></label>
    {type && <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.active} onChange={e => set({ active: e.target.checked })} style={{ height: 'auto' }} />Activo</label>}
    <div className={`preview ${issue && f.code ? 'bad' : ''}`}>{issue && f.code ? issue : <>Trabalho previsto: <b>{formatShiftHours(work)}</b>{work && f.endTime <= f.startTime ? ' · termina no dia seguinte' : ''}{work && isNightShift(f) ? ' · turno nocturno' : ''}{type ? ' · alterar as horas deixa por publicar os dias já publicados com este turno' : ''}</>}</div>
    <div className="form-actions">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={onDone}>Cancelar</button><button className="btn" disabled={busy || !!issue}>{type ? 'Gravar' : 'Criar turno'}</button></div>
  </form>;
}

function RestSetting({ minutes, canManage }: { minutes: number; canManage: boolean }) {
  const [hours, setHours] = useState(String(minutes / 60).replace('.', ','));
  const [ok, setOk] = useState('');
  const [error, setError] = useState('');
  return <div className="card section">
    <h2>Descanso entre turnos</h2>
    <form className="form" onSubmit={async e => {
      e.preventDefault(); setOk(''); setError('');
      const n = Math.round(Number(hours.replace(',', '.')) * 60);
      if (!Number.isFinite(n) || n < 0 || n > 1440) return setError('Indique entre 0 e 24 horas');
      const r = await send('/v1/shifts/settings', 'PATCH', { minRestMinutes: n });
      if (r.ok) setOk('Gravado.'); else setError(r.message ?? 'Erro');
    }}>
      <label>Intervalo mínimo (horas)<input value={hours} disabled={!canManage} inputMode="decimal" onChange={e => setHours(e.target.value)} /></label>
      <p className="muted wide">A escala assinala os turnos que começam antes deste intervalo depois do fim do turno anterior. Ajuste à política da empresa e ao contrato colectivo do sector.</p>
      {canManage && <div className="form-actions">{error && <span className="err">{error}</span>}{ok && <span className="ok">{ok}</span>}<button className="btn">Gravar</button></div>}
    </form>
  </div>;
}
