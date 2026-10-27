'use client';

import { Attachments } from '@/components/attachments';
import { ABSENCE_POLICIES, checkAbsenceLimit, labourRules, workingDaysByYear, type AbsenceType } from '@kianda/core';
import { useMemo, useState } from 'react';
import { formObject, useMutation } from '@/lib/client';
import type { BalanceRow } from '@/lib/types';

const pt = (d: string) => d.split('-').reverse().join('/');

/** Novo pedido / registo de ausência. A pré-visualização usa o mesmo motor da API (dias úteis, feriados, limites, saldo). */
export function NewAbsenceForm({ me, people, canRegisterOthers, canApprove }: {
  me: { employeeId: string | null; isHr: boolean };
  people: BalanceRow[];
  canRegisterOthers: boolean;
  canApprove: boolean;
}) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(me.employeeId ?? people[0]?.employee.id ?? '');
  const [type, setType] = useState<AbsenceType>('vacation');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [done, setDone] = useState('');

  const isSelf = employeeId === me.employeeId;
  const types = (Object.keys(ABSENCE_POLICIES) as AbsenceType[]).filter((t) => !isSelf || me.isHr || ABSENCE_POLICIES[t].selfService);
  const balance = people.find((p) => p.employee.id === employeeId);

  const preview = useMemo(() => {
    if (!start || !end) return null;
    if (end < start) return { bad: true, text: 'A data de fim é anterior à de início.' };
    try {
      const byYear = workingDaysByYear(start, end, (y) => labourRules('AO', y));
      const days = Object.values(byYear).reduce((s, d) => s + d, 0);
      const limit = checkAbsenceLimit(type, start, end, days, labourRules('AO', Number(start.slice(0, 4))));
      if (limit) return { bad: true, text: limit };
      if (!days) return { bad: true, text: 'O período não contém dias úteis (fins-de-semana ou feriados).' };
      let text = `${days} dia(s) úteis${Object.keys(byYear).length > 1 ? ` (${Object.entries(byYear).map(([y, d]) => `${d} em ${y}`).join(', ')})` : ''}.`;
      if (type === 'vacation' && balance) {
        if (balance.eligibleFrom && start < balance.eligibleFrom) return { bad: true, text: `Só pode gozar férias a partir de ${pt(balance.eligibleFrom)} (6 meses de serviço).` };
        const thisYear = byYear[balance.year] ?? 0;
        if (thisYear > balance.available) return { bad: true, text: `${text} Saldo de ${balance.year} insuficiente: disponíveis ${balance.available}.` };
        text += ` Saldo de ${balance.year} após o pedido: ${balance.available - thisYear} dia(s).`;
      }
      const policy = ABSENCE_POLICIES[type];
      if (policy.needsProof) text += ' Entregue o comprovativo aos Recursos Humanos.';
      if (policy.paid === false) text += ' Não remunerada.';
      if (policy.paid === 'social_security') text += ' Subsídio pago pela Segurança Social (INSS).';
      return { bad: false, text };
    } catch (e) {
      return { bad: true, text: (e as Error).message };
    }
  }, [start, end, type, balance]);

  if (!open) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn" onClick={() => { setOpen(true); setDone(''); }}>{canRegisterOthers ? 'Registar ausência' : 'Pedir férias ou ausência'}</button>
        {done && <span className="ok" style={{ color: 'var(--brand)' }}>{done}</span>}
      </div>
    );
  }
  return (
    <form
      className="form card cols4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = formObject(e.currentTarget);
        const ok = await run('/v1/absences', 'POST', { ...f, approve: f.approve === 'on' });
        if (ok) { setOpen(false); setStart(''); setEnd(''); setDone(f.approve === 'on' ? 'Ausência registada e aprovada.' : 'Pedido enviado para aprovação.'); }
      }}
    >
      <h3>{canRegisterOthers ? 'Registar ausência' : 'Novo pedido'}</h3>
      <label className="span2">Colaborador
        <select name="employeeId" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!canRegisterOthers}>
          {people.map((p) => <option key={p.employee.id} value={p.employee.id}>{p.employee.name}{p.employee.id === me.employeeId ? ' (eu)' : ''}</option>)}
        </select>
        {!canRegisterOthers && <input type="hidden" name="employeeId" value={employeeId} />}
      </label>
      <label className="span2">Tipo
        <select name="type" value={type} onChange={(e) => setType(e.target.value as AbsenceType)}>
          {types.map((t) => <option key={t} value={t}>{ABSENCE_POLICIES[t].label}</option>)}
        </select>
      </label>
      <label>Início<input type="date" name="startDate" required value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} /></label>
      <label>Fim<input type="date" name="endDate" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="span2">Observações<input name="reason" placeholder={type === 'vacation' ? 'Opcional' : 'Motivo / referência do comprovativo'} /></label>
      {preview && <div className={`preview ${preview.bad ? 'bad' : 'good'}`}>{preview.text}</div>}
      {canApprove && !isSelf && (
        <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 500 }}>
          <input type="checkbox" name="approve" style={{ height: 16 }} /> Registar já aprovada (ex.: baixa médica entregue em papel)
        </label>
      )}
      <div className="form-actions">
        {error && <span className="err" role="alert">{error}</span>}
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
        <button className="btn" disabled={busy || preview?.bad}>{busy ? 'A enviar…' : 'Enviar'}</button>
      </div>
    </form>
  );
}

/** Aprovar / recusar (com motivo obrigatório) / cancelar. */
export function AbsenceActions({ id, canDecide, canCancel }: { id: string; canDecide: boolean; canCancel: boolean }) {
  const { busy, error, run } = useMutation();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  if (error) return <span className="err" style={{ color: 'var(--red)' }}>{error}</span>;
  if (rejecting) {
    return (
      <span className="inline-note">
        <input autoFocus placeholder="Motivo da recusa" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn danger" disabled={busy || !note.trim()} onClick={() => run(`/v1/absences/${id}/reject`, 'POST', { note })}>Recusar</button>
        <button className="btn ghost sm" onClick={() => setRejecting(false)}>Voltar</button>
      </span>
    );
  }
  return (
    <span className="actions">
      {canDecide && <button className="btn sm ok" disabled={busy} onClick={() => run(`/v1/absences/${id}/approve`, 'POST')}>Aprovar</button>}
      {canDecide && <button className="btn danger" disabled={busy} onClick={() => setRejecting(true)}>Recusar</button>}
      {canCancel && !canDecide && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/absences/${id}/cancel`, 'POST')}>Cancelar</button>}
    </span>
  );
}

/** Justificativo da ausência (atestado, convocatória…): abre a lista e o envio só quando se clica. */
export function AbsenceFiles({ id, count, canAttach }: { id: string; count: number; canAttach: boolean }) {
  const [open, setOpen] = useState(false);
  if (open) return <div style={{ marginTop: 4 }}><Attachments entity="absence" entityId={id} compact /></div>;
  if (!count && !canAttach) return null;
  return <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setOpen(true)}>{count ? `📎 ${count} ficheiro(s)` : '📎 Anexar justificativo'}</button>;
}
