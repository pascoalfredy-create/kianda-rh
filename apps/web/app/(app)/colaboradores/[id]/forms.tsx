'use client';

import { SalaryBaseFields } from '@/components/salary-base-fields';
import { AGT_MUNICIPALITIES, compensationChangeBps, formatPercent, formatAmount, formatUsd, luandaDate, parseAmount } from '@kianda/core';
import { useState } from 'react';
import Link from 'next/link';
import { IbanField } from '@/components/iban-field';
import { formObject, useMutation } from '@/lib/client';
import { DOC_LABEL, PROVINCES, type Compensation, type Department, type PersonRef, type Profile } from '@/lib/types';

function Actions({ busy, error, ok, label, onCancel }: { busy: boolean; error: string; ok?: string; label: string; onCancel?: () => void }) {
  return (
    <div className="form-actions">
      {error ? <span className="err" role="alert">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
      {onCancel && <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancelar</button>}
      <button className="btn" disabled={busy}>{busy ? 'A gravar…' : label}</button>
    </div>
  );
}

const today = () => luandaDate(new Date());
const firstOfNextMonth = () => { const [year, month] = today().split('-').map(Number); return new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 10); };
const kzValue = (minor?: number | null) => (minor == null ? '' : formatAmount(minor));
const dateLabel = (date: string) => date.split('-').reverse().join('/');
const paySnapshot = (c: Compensation) => ({ effectiveDate: c.effectiveDate, reason: c.reason, baseMinor: c.baseMinor, mealMinor: c.mealMinor, transportMinor: c.transportMinor, salaryCurrency: c.salaryCurrency ?? 'AOA', baseForeignMinor: c.baseForeignMinor ?? null });

// ───────────────────────── Dados pessoais e profissionais ─────────────────────────

export function PersonalForm({ p, departments, people }: { p: Profile; departments: Department[]; people: PersonRef[] }) {
  const { busy, error, run } = useMutation();
  const [ok, setOk] = useState('');
  const v = (x: string | null | undefined) => x ?? '';
  return (
    <form
      className="form cols4"
      onSubmit={async (e) => {
        e.preventDefault();
        setOk('');
        if (await run(`/v1/employees/${p.id}`, 'PATCH', formObject(e.currentTarget, ['vacationCarryOver']))) setOk('Alterações gravadas.');
      }}
    >
      <h3>Profissional</h3>
      <label className="span2">Nome completo<input name="name" required defaultValue={p.name} /></label>
      <label className="span2">Função<input name="jobTitle" required defaultValue={p.jobTitle} /></label>
      <label>Departamento
        <select name="departmentId" defaultValue={v(p.departmentId)}>
          <option value="">— Sem departamento —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.costCenter})</option>)}
        </select>
      </label>
      <label>Chefia directa
        <select name="managerId" defaultValue={v(p.managerId)}>
          <option value="">— Sem chefia —</option>
          {people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.jobTitle}</option>)}
        </select>
      </label>
      <label>Província de trabalho
        <select name="province" defaultValue={v(p.province)}>
          <option value="">—</option>
          {PROVINCES.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>Município de trabalho
        <input name="municipality" list="agt-municipios" defaultValue={v(p.municipality)} placeholder="Vazio = o da sede" />
        <datalist id="agt-municipios">{Object.values(AGT_MUNICIPALITIES).flat().map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label>Dias de férias transitados
        <input name="vacationCarryOver" type="number" min={0} max={44} defaultValue={p.vacationCarryOver ?? 0} />
      </label>
      <label>Situação
        <select name="status" defaultValue={p.status} disabled={p.status === 'terminated'}>
          <option value="active">Activo</option>
          <option value="suspended">Suspenso</option>
        </select>
      </label>

      <h3>Pessoal</h3>
      <label>Sexo
        <select name="gender" defaultValue={v(p.gender)}><option value="">—</option><option value="F">Feminino</option><option value="M">Masculino</option></select>
      </label>
      <label>Data de nascimento<input type="date" name="birthDate" defaultValue={v(p.birthDate)} /></label>
      <label>Nacionalidade<input name="nationality" defaultValue={v(p.nationality)} /></label>
      <label>Estado civil
        <select name="maritalStatus" defaultValue={v(p.maritalStatus)}>
          <option value="">—</option>
          {['Solteiro(a)', 'Casado(a)', 'União de facto', 'Divorciado(a)', 'Viúvo(a)'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>

      <h3>Identificação fiscal, segurança social e pagamento</h3>
      <label>N.º do BI<input name="biNumber" defaultValue={v(p.biNumber)} placeholder="004512398LA041" /></label>
      <label>NIF<input name="nif" defaultValue={v(p.nif)} /></label>
      <label>N.º INSS<input name="inssNumber" defaultValue={v(p.inssNumber)} /></label>
      <label>Banco<input name="bank" defaultValue={v(p.bank)} /></label>
      <IbanField className="span2" defaultValue={p.iban} />

      <h3>Contactos</h3>
      <label>Email<input type="email" name="email" defaultValue={v(p.email)} /></label>
      <label>Telefone<input name="phone" defaultValue={v(p.phone)} placeholder="923 000 000" /></label>
      <label className="span2">Morada<input name="address" defaultValue={v(p.address)} /></label>
      <label className="span2">Contacto de emergência<input name="emergencyContactName" defaultValue={v(p.emergencyContactName)} /></label>
      <label>Telefone de emergência<input name="emergencyContactPhone" defaultValue={v(p.emergencyContactPhone)} /></label>

      <Actions busy={busy} error={error} ok={ok} label="Gravar alterações" />
    </form>
  );
}

// ───────────────────────── Remuneração ─────────────────────────

export function CompensationForm({ p }: { p: Profile }) {
  const { busy, error, run, setError } = useMutation();
  const [mode, setMode] = useState<'change' | 'correct' | null>(null);
  const [source, setSource] = useState<Compensation | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(firstOfNextMonth);
  const [delta, setDelta] = useState<number | null>(null);
  const [result, setResult] = useState<{ text: string; draftPeriods: string[] } | null>(null);
  const cur = p.compensation.current;
  function open(next: 'change' | 'correct') {
    setSource(cur ?? p.compensation.history[0] ?? null);
    setEffectiveDate(firstOfNextMonth()); setDelta(null); setResult(null); setError(''); setMode(next);
  }
  if (!mode) return <div>
    <div className="actions" style={{ justifyContent: 'flex-start' }}>
      <button type="button" className="btn" onClick={() => open('change')}>Registar alteração salarial</button>
      {!!p.compensation.history.length && <button type="button" className="btn ghost" onClick={() => open('correct')}>Corrigir erro de registo</button>}
    </div>
    {result && <div role="status" className="ok" style={{ marginTop: 10 }}>
      {result.text}
      {!!result.draftPeriods.length && <p>Recalcule os processamentos em rascunho para aplicar os valores: {result.draftPeriods.map((period, i) => <span key={period}>{i > 0 && ', '}<Link href={`/processamento?mes=${period}`}>{period}</Link></span>)}.</p>}
    </div>}
  </div>;
  const correcting = mode === 'correct';
  return (
    <form
      className="form card"
      aria-label={correcting ? 'Correcção de remuneração' : 'Alteração salarial'}
      style={{ marginTop: 12 }}
      onChange={(e) => {
        if (correcting || !cur) return;
        const f = new FormData(e.currentTarget);
        setDelta(compensationChangeBps(cur, { salaryCurrency: String(f.get('currency') ?? 'AOA'), baseMinor: parseAmount(String(f.get('base') ?? '')) ?? 0, baseForeignMinor: parseAmount(String(f.get('baseUsd') ?? '')) }));
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (correcting && !source) return;
        const values = formObject(e.currentTarget, ['base', 'baseUsd', 'meal', 'transport']);
        const date = correcting ? source!.effectiveDate : effectiveDate;
        const ok = await run<Compensation & { draftPeriods?: string[] }>(`/v1/employees/${p.id}/compensation${correcting ? `/${source!.id}` : ''}`, correcting ? 'PATCH' : 'POST', { ...values, ...(correcting ? { expected: paySnapshot(source!) } : {}) }, (data) => {
          setResult({ text: correcting ? `Correcção gravada no registo de ${dateLabel(date)}, mantendo a data original.` : date > today() ? `Alteração agendada para ${dateLabel(date)}. A remuneração em vigor mantém-se até essa data.` : `Remuneração actualizada com efeito em ${dateLabel(date)}.`, draftPeriods: data?.draftPeriods ?? [] });
        });
        if (ok) setMode(null);
      }}
    >
      <fieldset disabled={busy} style={{ display: 'contents' }}>
        <h3>{correcting ? 'Corrigir erro de registo' : 'Registar alteração salarial'}</h3>
        {correcting ? <>
          <label className="wide">Registo a corrigir<select aria-label="Registo a corrigir" value={source?.id ?? ''} onChange={(e) => { setSource(p.compensation.history.find((h) => h.id === e.target.value) ?? null); setDelta(null); }}>
            {p.compensation.history.map((h) => <option key={h.id} value={h.id}>{dateLabel(h.effectiveDate)} · {h.reason}{cur?.id === h.id ? ' · em vigor' : ''}</option>)}
          </select></label>
          <p className="muted wide">Corrige os valores digitados no registo de {source ? dateLabel(source.effectiveDate) : '—'}. Mantém a data e o motivo original; a justificação fica na auditoria. Não cria uma nova alteração salarial.</p>
        </> : <label>Data de efeito<input type="date" name="effectiveDate" required value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></label>}
        <SalaryBaseFields key={`${mode}:${source ? JSON.stringify(paySnapshot(source)) : ''}`} currency={source?.salaryCurrency} baseKz={kzValue(source?.baseMinor)} baseUsd={kzValue(source?.baseForeignMinor)} />
        {!correcting && delta !== null && Number.isFinite(delta) && <span className="delta" style={{ alignSelf: 'end', paddingBottom: 8 }}>{formatPercent(delta / 100, 2, true)} face ao actual, na moeda do salário</span>}
        <label>Subsídio de alimentação (Kz)<input key={`meal:${source?.id}`} name="meal" inputMode="decimal" defaultValue={kzValue(source?.mealMinor)} /></label>
        <label>Subsídio de transporte (Kz)<input key={`transport:${source?.id}`} name="transport" inputMode="decimal" defaultValue={kzValue(source?.transportMinor)} /></label>
        <label className="wide">{correcting ? 'Justificação da correcção' : 'Motivo'}<input name="reason" required minLength={3} maxLength={300} placeholder={correcting ? 'Ex.: salário digitado com zeros a mais na admissão' : 'Actualização anual, promoção, revisão de função…'} /></label>
        {!correcting && effectiveDate > today() && <p role="status" className="muted wide">Fica agendada para {dateLabel(effectiveDate)}. Para vigorar hoje, escolha {dateLabel(today())} na data de efeito.</p>}
        <p className="muted wide">O processamento usa a remuneração em vigor no último dia de cada mês. Recalcule os rascunhos após corrigir. Meses já fechados conservam os valores emitidos e não aceitam correcções.</p>
        <Actions busy={busy} error={error} label={correcting ? 'Guardar correcção' : 'Registar'} onCancel={() => setMode(null)} />
      </fieldset>
    </form>
  );
}

// ───────────────────────── Novo contrato ─────────────────────────

export function ContractForm({ p }: { p: Profile }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('indefinite');
  const cur = p.compensation.current;
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Novo contrato / renovação</button>;
  return (
    <form
      className="form card"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(`/v1/employees/${p.id}/contracts`, 'POST', formObject(e.currentTarget, ['base', 'baseUsd', 'meal', 'transport']))) setOpen(false);
      }}
    >
      <label>Tipo
        <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="indefinite">Tempo indeterminado</option>
          <option value="fixed_term">A termo (prazo certo)</option>
          <option value="internship">Estágio</option>
        </select>
      </label>
      <label>Início<input type="date" name="startDate" required defaultValue={p.contract?.endDate && p.contract.endDate >= today() ? nextDay(p.contract.endDate) : firstOfNextMonth()} /></label>
      <label>Fim{type === 'fixed_term' ? ' *' : ''}<input type="date" name="endDate" required={type === 'fixed_term'} /></label>
      <SalaryBaseFields currency={cur?.salaryCurrency} baseKz={kzValue(cur?.baseMinor)} baseUsd={kzValue(cur?.baseForeignMinor)} />
      <label>Subsídio de alimentação (Kz)<input name="meal" inputMode="decimal" defaultValue={kzValue(cur?.mealMinor)} /></label>
      <label>Subsídio de transporte (Kz)<input name="transport" inputMode="decimal" defaultValue={kzValue(cur?.transportMinor)} /></label>
      {type === 'fixed_term' && <label className="wide">Fundamento do termo *<textarea name="termJustification" required placeholder="Motivo justificativo da contratação a termo, nos termos da LGT" /></label>}
      <p className="muted wide">O contrato actual é encerrado na véspera do início do novo, e o histórico salarial é actualizado automaticamente.</p>
      <Actions busy={busy} error={error} label="Criar contrato" onCancel={() => setOpen(false)} />
    </form>
  );
}

function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

// ───────────────────────── Documentos ─────────────────────────

export function DocumentForm({ employeeId }: { employeeId: string }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Adicionar documento</button>;
  return (
    <form
      className="form card"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(`/v1/employees/${employeeId}/documents`, 'POST', formObject(e.currentTarget))) setOpen(false);
      }}
    >
      <label>Tipo
        <select name="type" defaultValue="bi">{Object.entries(DOC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label>Número<input name="number" required /></label>
      <label>Emissão<input type="date" name="issueDate" /></label>
      <label>Validade<input type="date" name="expiryDate" /></label>
      <label>Entidade emissora<input name="issuer" placeholder="Arquivo de Identificação, SME, DNVT…" /></label>
      <label className="wide">Observações<input name="notes" /></label>
      <Actions busy={busy} error={error} label="Adicionar" onCancel={() => setOpen(false)} />
    </form>
  );
}

export function DeleteDocument({ employeeId, doc }: { employeeId: string; doc: { id: string; type: string; number: string } }) {
  const { busy, error, run } = useMutation();
  const [confirm, setConfirm] = useState(false);
  if (error) return <span className="err">{error}</span>;
  if (!confirm) return <button className="btn danger" onClick={() => setConfirm(true)}>Remover</button>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className="muted">Remover {DOC_LABEL[doc.type]} {doc.number}?</span>
      <button className="btn danger" disabled={busy} onClick={() => run(`/v1/employees/${employeeId}/documents/${doc.id}`, 'DELETE')}>Sim</button>
      <button className="btn ghost" style={{ height: 30 }} onClick={() => setConfirm(false)}>Não</button>
    </span>
  );
}
