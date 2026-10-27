'use client';

import { describeSchedule, formatKz, scheduleStats, type ScheduleKind } from '@kianda/core';
import { useState } from 'react';
import { useMutation } from '@/lib/client';

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const h = (min: number) => String(Math.round((min / 60) * 100) / 100).replace('.', ',');
const toMin = (v: string) => Math.round(Number(v.replace(',', '.') || 0) * 60);

export function SectorPicker({ sector, sectors }: { sector: string | null; sectors: Record<string, string> }) {
  const { busy, error, run } = useMutation();
  const [v, setV] = useState(sector ?? 'other');
  return (
    <div className="actions" style={{ justifyContent: 'flex-start', padding: '10px 16px 14px', gap: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
      <select value={v} onChange={(e) => setV(e.target.value)} style={{ minWidth: 260 }}>
        {Object.entries(sectors).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <button className="btn ghost" disabled={busy || v === (sector ?? 'other')} onClick={() => run('/v1/sector', 'PUT', { sector: v })}>Mudar de sector</button>
      <span className="muted">Mudar de sector não apaga nada: passa a sugerir os regimes e subsídios do novo sector.</span>
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function ApplyPreset({ schedules, allowances }: { schedules: { key: string; name: string; applied: boolean }[]; allowances: { key: string; label: string; applied: boolean }[] }) {
  const { busy, error, run } = useMutation();
  const pending = [...schedules.filter((s) => !s.applied).map((s) => `s:${s.key}`), ...allowances.filter((a) => !a.applied).map((a) => `a:${a.key}`)];
  const [pick, setPick] = useState<string[]>(pending);
  if (!pending.length) return <p className="muted" style={{ padding: '0 16px 14px' }}>Tudo o que o sector sugere já está configurado.</p>;
  const toggle = (k: string) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <div style={{ padding: '4px 16px 14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginBottom: 10 }}>
        {schedules.filter((s) => !s.applied).map((s) => <label key={s.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ height: 'auto' }} checked={pick.includes(`s:${s.key}`)} onChange={() => toggle(`s:${s.key}`)} />Regime: {s.name}</label>)}
        {allowances.filter((a) => !a.applied).map((a) => <label key={a.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ height: 'auto' }} checked={pick.includes(`a:${a.key}`)} onChange={() => toggle(`a:${a.key}`)} />Subsídio: {a.label}</label>)}
      </div>
      <button className="btn" disabled={busy || !pick.length} onClick={() => run('/v1/sector/apply', 'POST', {
        schedules: pick.filter((k) => k.startsWith('s:')).map((k) => k.slice(2)), allowances: pick.filter((k) => k.startsWith('a:')).map((k) => k.slice(2)),
      })}>Aplicar selecção</button>
      {error && <span className="err" style={{ marginLeft: 10 }}>{error}</span>}
    </div>
  );
}

// ───────── Regime de horário ─────────

interface ScheduleRow { id: string; name: string; kind: ScheduleKind; pattern: number[]; anchorDate: string | null; note: string | null; active: boolean }
type Block = { days: number; hours: string };

const toBlocks = (pattern: number[]): Block[] => {
  const out: Block[] = [];
  for (const m of pattern) {
    const last = out[out.length - 1];
    if (last && toMin(last.hours) === m) last.days++;
    else out.push({ days: 1, hours: h(m) });
  }
  return out;
};
const fromBlocks = (b: Block[]) => b.flatMap((x) => Array.from({ length: Math.max(0, x.days) }, () => toMin(x.hours)));

export function ScheduleEditor({ row, weeklyHours, onDone }: { row?: ScheduleRow; weeklyHours: number; onDone?: () => void }) {
  const { busy, error, run } = useMutation();
  const [name, setName] = useState(row?.name ?? '');
  const [kind, setKind] = useState<ScheduleKind>(row?.kind ?? 'cycle');
  const [week, setWeek] = useState<string[]>(row?.kind === 'weekly' ? row.pattern.map(h) : ['8', '8', '8', '8', '8', '0', '0']);
  const [blocks, setBlocks] = useState<Block[]>(row?.kind === 'cycle' ? toBlocks(row.pattern) : [{ days: 2, hours: '12' }, { days: 2, hours: '0' }]);
  const [anchor, setAnchor] = useState(row?.anchorDate ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const pattern = kind === 'weekly' ? week.map(toMin) : fromBlocks(blocks);
  const stats = scheduleStats({ kind, pattern }, weeklyHours);
  const setBlock = (i: number, patch: Partial<Block>) => setBlocks((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = () => run(row ? `/v1/schedules/${row.id}` : '/v1/schedules', row ? 'PATCH' : 'POST', { name, kind, pattern, anchorDate: kind === 'cycle' && anchor ? anchor : null, note: note || null }, () => onDone?.());
  return (
    <div className="form">
      <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Turnos 12 h — equipa A" /></label>
      <label>Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
          <option value="weekly">Semanal (dias da semana)</option>
          <option value="cycle">Ciclo (turnos ou rotação)</option>
        </select>
      </label>
      {kind === 'cycle' && <label>Início do ciclo (opcional)<input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} /></label>}
      <div className="wide">
        {kind === 'weekly' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {DAYS.map((d, i) => <label key={d} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 600 }}>{d} (h)<input inputMode="decimal" value={week[i]} onChange={(e) => setWeek((w) => w.map((x, j) => (j === i ? e.target.value : x)))} /></label>)}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {blocks.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" min={1} max={90} value={b.days} onChange={(e) => setBlock(i, { days: Number(e.target.value) || 0 })} style={{ width: 80 }} />
                <span>dia(s) de</span>
                <input inputMode="decimal" value={b.hours} onChange={(e) => setBlock(i, { hours: e.target.value })} style={{ width: 80 }} />
                <span>h {toMin(b.hours) === 0 ? <span className="muted">(descanso)</span> : null}</span>
                {blocks.length > 1 && <button className="btn danger" onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))}>Remover</button>}
              </div>
            ))}
            <div><button className="btn ghost" style={{ height: 30 }} onClick={() => setBlocks((x) => [...x, { days: 1, hours: '0' }])}>+ Bloco</button></div>
          </div>
        )}
      </div>
      <div className="wide muted">{describeSchedule({ kind, pattern })} · média de <b>{h(stats.avgWeeklyMinutes)} h</b> por semana</div>
      {stats.problems.length > 0 && <div className="wide warn" style={{ margin: 0 }}>{stats.problems.join('. ')}.</div>}
      <label className="wide">Nota<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: dias de viagem por conta da empresa" /></label>
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        {row && <button className="btn ghost" disabled={busy} onClick={() => run(`/v1/schedules/${row.id}`, 'PATCH', { name, kind, pattern, anchorDate: kind === 'cycle' && anchor ? anchor : null, note: note || null, active: !row.active }, () => onDone?.())}>{row.active ? 'Desactivar' : 'Reactivar'}</button>}
        <button className="btn" disabled={busy || name.trim().length < 3} onClick={save}>{row ? 'Guardar regime' : 'Criar regime'}</button>
      </div>
    </div>
  );
}

// ───────── Subsídio ─────────

interface TypeRow { id: string; code: string; label: string; calc: 'fixed' | 'base_pct' | 'per_day'; valueMinor: number | null; bps: number | null; inInss: boolean; inIrt: boolean; note: string | null; active: boolean }

export function AllowanceEditor({ row, onDone }: { row?: TypeRow; onDone?: () => void }) {
  const { busy, error, run } = useMutation();
  const [f, setF] = useState({
    code: row?.code ?? '', label: row?.label ?? '', calc: row?.calc ?? 'fixed',
    value: row?.valueMinor ? String(row.valueMinor / 100) : '', pct: row?.bps ? String(row.bps / 100) : '',
    inInss: row?.inInss ?? true, inIrt: row?.inIrt ?? true, note: row?.note ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const payload = (active?: boolean) => ({
    code: f.code, label: f.label, calc: f.calc, value: f.calc === 'base_pct' ? null : Number(f.value.replace(/\s/g, '').replace(',', '.')) || null,
    pct: f.calc === 'base_pct' ? Number(f.pct.replace(',', '.')) || null : null, inInss: f.inInss, inIrt: f.inIrt, note: f.note || null, ...(active === undefined ? {} : { active }),
  });
  return (
    <div className="form">
      <label>Código<input value={f.code} disabled={!!row} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="SUBRISCO" /></label>
      <label>Designação<input value={f.label} onChange={(e) => set({ label: e.target.value })} /></label>
      <label>Cálculo
        <select value={f.calc} onChange={(e) => set({ calc: e.target.value as TypeRow['calc'] })}>
          <option value="fixed">Valor mensal fixo</option>
          <option value="base_pct">% do salário base</option>
          <option value="per_day">Por dia de escala</option>
        </select>
      </label>
      {f.calc === 'base_pct'
        ? <label>Percentagem (%)<input inputMode="decimal" value={f.pct} onChange={(e) => set({ pct: e.target.value })} /></label>
        : <label>{f.calc === 'per_day' ? 'Valor por dia (Kz)' : 'Valor mensal (Kz)'}<input inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} /></label>}
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" style={{ height: 'auto' }} checked={f.inInss} onChange={(e) => set({ inInss: e.target.checked })} />Incide INSS</label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" style={{ height: 'auto' }} checked={f.inIrt} onChange={(e) => set({ inIrt: e.target.checked })} />Incide IRT</label>
      <label className="wide">Nota<input value={f.note} onChange={(e) => set({ note: e.target.value })} /></label>
      <div className="form-actions">
        {error && <span className="err">{error}</span>}
        {row && <button className="btn ghost" disabled={busy} onClick={() => run(`/v1/allowance-types/${row.id}`, 'PATCH', payload(!row.active), () => onDone?.())}>{row.active ? 'Desactivar' : 'Reactivar'}</button>}
        <button className="btn" disabled={busy} onClick={() => run(row ? `/v1/allowance-types/${row.id}` : '/v1/allowance-types', row ? 'PATCH' : 'POST', payload(), () => onDone?.())}>{row ? 'Guardar subsídio' : 'Criar subsídio'}</button>
      </div>
    </div>
  );
}

const KZ = formatKz;
const CALC: Record<string, string> = { fixed: 'Mensal', base_pct: '% do base', per_day: 'Por dia de escala' };

type ScheduleView = ScheduleRow & { description: string; stats: { avgWeeklyMinutes: number; problems: string[] }; employees: number };
type TypeView = TypeRow & { employees: number };

export function ScheduleList({ rows, weeklyHours, canEdit }: { rows: ScheduleView[]; weeklyHours: number; canEdit: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {rows.length ? (
        <table className="dense">
          <thead><tr><th>Regime</th><th>Dias e horas</th><th className="num">Média semanal</th><th className="num">Colaboradores</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <FragmentRow key={s.id} open={open === s.id} colSpan={5}
                cells={[
                  <><b>{s.name}</b>{!s.active && <span className="tag" style={{ marginLeft: 6 }}>inactivo</span>}{s.note && <div className="muted" style={{ fontSize: 12 }}>{s.note}</div>}</>,
                  <>{s.description}{s.kind === 'cycle' && <div className="muted" style={{ fontSize: 12 }}>{s.anchorDate ? `início do ciclo ${s.anchorDate.split('-').reverse().join('/')}` : 'início do ciclo por colaborador'}</div>}</>,
                  <span className="num" style={{ display: 'block' }}>{h(s.stats.avgWeeklyMinutes)} h{s.stats.problems.length > 0 && <span className="pill" title={s.stats.problems.join('. ')} style={{ marginLeft: 6 }}>!</span>}</span>,
                  <span className="num" style={{ display: 'block' }}>{s.employees}</span>,
                ]}
                action={canEdit ? <button className="link" style={{ color: 'var(--brand)' }} onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Fechar' : 'Editar'}</button> : null}>
                <ScheduleEditor row={s} weeklyHours={weeklyHours} onDone={() => setOpen(null)} />
              </FragmentRow>
            ))}
          </tbody>
        </table>
      ) : <div className="empty">Ainda não há regimes de horário.</div>}
      {canEdit && (open === 'new'
        ? <div style={{ borderTop: '1px solid var(--line)' }}><ScheduleEditor weeklyHours={weeklyHours} onDone={() => setOpen(null)} /></div>
        : <div style={{ padding: '10px 16px 14px' }}><button className="btn ghost" onClick={() => setOpen('new')}>+ Novo regime</button></div>)}
    </>
  );
}

export function AllowanceList({ rows, canEdit }: { rows: TypeView[]; canEdit: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {rows.length ? (
        <table className="dense">
          <thead><tr><th>Código</th><th>Subsídio</th><th>Cálculo</th><th className="num">Valor</th><th>INSS / IRT</th><th className="num">Colaboradores</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <FragmentRow key={t.id} open={open === t.id} colSpan={7}
                cells={[
                  <span className="tag">{t.code}</span>,
                  <><b>{t.label}</b>{!t.active && <span className="tag" style={{ marginLeft: 6 }}>inactivo</span>}{t.note && <div className="muted" style={{ fontSize: 12 }}>{t.note}</div>}</>,
                  CALC[t.calc],
                  <span className="num" style={{ display: 'block' }}>{t.calc === 'base_pct' ? `${String((t.bps ?? 0) / 100).replace('.', ',')}%` : KZ(t.valueMinor ?? 0)}</span>,
                  `${t.inInss ? 'Sim' : 'Não'} / ${t.inIrt ? 'Sim' : 'Não'}`,
                  <span className="num" style={{ display: 'block' }}>{t.employees}</span>,
                ]}
                action={canEdit ? <button className="link" style={{ color: 'var(--brand)' }} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Fechar' : 'Editar'}</button> : null}>
                <AllowanceEditor row={t} onDone={() => setOpen(null)} />
              </FragmentRow>
            ))}
          </tbody>
        </table>
      ) : <div className="empty">Ainda não há subsídios recorrentes.</div>}
      {canEdit && (open === 'new'
        ? <div style={{ borderTop: '1px solid var(--line)' }}><AllowanceEditor onDone={() => setOpen(null)} /></div>
        : <div style={{ padding: '10px 16px 14px' }}><button className="btn ghost" onClick={() => setOpen('new')}>+ Novo subsídio</button></div>)}
    </>
  );
}

function FragmentRow({ cells, action, open, colSpan, children }: { cells: React.ReactNode[]; action: React.ReactNode; open: boolean; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr>{cells.map((c, i) => <td key={i}>{c}</td>)}<td className="num">{action}</td></tr>
      {open && <tr><td colSpan={colSpan} style={{ background: '#fafbfc', padding: 0 }}>{children}</td></tr>}
    </>
  );
}
