'use client';

import { useState } from 'react';
import { IbanField } from '@/components/iban-field';
import { formObject, send } from '@/lib/client';
import { PROVINCES, type Department, type PersonRef } from '@/lib/types';

export interface Prefill { candidateId: string; name: string; email: string | null; phone: string | null; jobTitle: string; departmentId: string | null; managerId: string | null; contractType: string; expectedSalary: number | null }

export function NewEmployeeForm({ departments, people, nextNumber, prefill }: { departments: Department[]; people: PersonRef[]; nextNumber: string; prefill?: Prefill }) {
  const [type, setType] = useState(prefill?.contractType ?? 'indefinite');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formObject(e.currentTarget, ['base', 'meal', 'transport']);
    const { type: ctype, startDate, endDate, termJustification, base, meal, transport, ...personal } = f;
    setBusy(true);
    setError('');
    const r = await send<{ id: string }>('/v1/employees', 'POST', { ...personal, candidateId: prefill?.candidateId, contract: { type: ctype, startDate, endDate, termJustification, base, meal, transport } });
    setBusy(false);
    if (!r.ok) return setError(r.message ?? 'Erro');
    window.location.assign(`/colaboradores/${r.data!.id}`);
  }

  return (
    <form onSubmit={submit}>
      <div className="card section">
        <h2>Identificação e função</h2>
        <div className="form">
          <label>N.º mecanográfico<input name="number" required defaultValue={nextNumber} /></label>
          <label className="wide">Nome completo<input name="name" required defaultValue={prefill?.name} /></label>
          <label>Função<input name="jobTitle" required defaultValue={prefill?.jobTitle} /></label>
          <label>Departamento
            <select name="departmentId" defaultValue={prefill?.departmentId ?? ""}><option value="">— Sem departamento —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Chefia directa
            <select name="managerId" defaultValue={prefill?.managerId ?? ""}><option value="">— Sem chefia —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.jobTitle}</option>)}</select>
          </label>
          <label>Província de trabalho
            <select name="province" defaultValue="Luanda">{PROVINCES.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label>N.º do BI<input name="biNumber" placeholder="004512398LA041" /></label>
          <label>N.º INSS<input name="inssNumber" /></label>
          <label>Email<input type="email" name="email" defaultValue={prefill?.email ?? undefined} /></label>
          <label>Telefone<input name="phone" defaultValue={prefill?.phone ?? undefined} /></label>
          <label>Banco<input name="bank" /></label>
          <IbanField className="wide" />
        </div>
      </div>

      <div className="card section">
        <h2>Contrato e remuneração inicial</h2>
        <div className="form">
          <label>Tipo de contrato
            <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="indefinite">Tempo indeterminado</option>
              <option value="fixed_term">A termo (prazo certo)</option>
              <option value="internship">Estágio</option>
            </select>
          </label>
          <label>Data de início<input type="date" name="startDate" required /></label>
          <label>Data de fim{type === 'fixed_term' ? ' *' : ''}<input type="date" name="endDate" required={type === 'fixed_term'} /></label>
          <label>Salário base (Kz)<input name="base" inputMode="decimal" required defaultValue={prefill?.expectedSalary ? String(prefill.expectedSalary / 100).replace(".", ",") : undefined} /></label>
          <label>Subsídio de alimentação (Kz)<input name="meal" inputMode="decimal" placeholder="0" /></label>
          <label>Subsídio de transporte (Kz)<input name="transport" inputMode="decimal" placeholder="0" /></label>
          {type === 'fixed_term' && <label className="wide">Fundamento do termo *<textarea name="termJustification" required /></label>}
          <p className="muted wide">O salário base é validado contra o salário mínimo nacional do ano de início. Os subsídios de alimentação e transporte estão isentos até ao limite legal.</p>
        </div>
      </div>

      <div className="form-actions" style={{ marginBottom: 30 }}>
        {error && <span className="err" role="alert">{error}</span>}
        <a href="/colaboradores" className="btn ghost">Cancelar</a>
        <button className="btn" disabled={busy}>{busy ? 'A criar…' : 'Criar colaborador'}</button>
      </div>
    </form>
  );
}
