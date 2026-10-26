'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function SettingsForm({ s }: { s: { inssNumber: string | null; address: string | null; workdayMinutes: number; christmasSubsidyMonth: number; holidaySubsidyMonth: number | null } }) {
  const { busy, error, run } = useMutation();
  const [ok, setOk] = useState('');
  return (
    <form
      className="form card cols4"
      onSubmit={async (e) => {
        e.preventDefault();
        setOk('');
        const f = new FormData(e.currentTarget);
        const hol = String(f.get('holidaySubsidyMonth'));
        const done = await run('/v1/company/settings', 'PATCH', {
          inssNumber: String(f.get('inssNumber') || '') || null,
          address: String(f.get('address') || '') || null,
          workdayMinutes: Math.round(Number(String(f.get('workdayHours')).replace(',', '.')) * 60),
          christmasSubsidyMonth: Number(f.get('christmasSubsidyMonth')),
          holidaySubsidyMonth: hol === 'ferias' ? null : Number(hol),
        });
        if (done) setOk('Definições gravadas.');
      }}
    >
      <h3>Empresa</h3>
      <label>N.º de contribuinte INSS<input name="inssNumber" defaultValue={s.inssNumber ?? ''} /></label>
      <label className="span2">Morada (aparece nos recibos)<input name="address" defaultValue={s.address ?? ''} /></label>
      <label>Jornada diária (horas)<input name="workdayHours" inputMode="decimal" defaultValue={String(s.workdayMinutes / 60).replace('.', ',')} /></label>
      <h3>Subsídios</h3>
      <label className="span2">Subsídio de Natal pago em
        <select name="christmasSubsidyMonth" defaultValue={s.christmasSubsidyMonth}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
      </label>
      <label className="span2">Subsídio de férias pago
        <select name="holidaySubsidyMonth" defaultValue={s.holidaySubsidyMonth ?? 'ferias'}>
          <option value="ferias">No mês das primeiras férias aprovadas do ano (Dezembro se não gozar)</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>Em {m}, para todos</option>)}
        </select>
      </label>
      <p className="muted wide">Ambos os subsídios correspondem a 50% do salário base (pacote AO-2026); no ano de admissão são proporcionais. Nenhum subsídio é pago duas vezes no mesmo ano. Regras assinaladas para validação jurídica.</p>
      <div className="form-actions">
        {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
        <button className="btn" disabled={busy}>Gravar</button>
      </div>
    </form>
  );
}
