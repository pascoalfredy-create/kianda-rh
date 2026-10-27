'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';
import { PROVINCES } from '@/lib/types';
import { AGT_MUNICIPALITIES } from '@kianda/core';

const kzField = (v: FormDataEntryValue | null) => { const t = String(v ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.'); return t ? Math.round(Number(t) * 100) : null; };
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function SettingsForm({ s }: { s: { inssNumber: string | null; address: string | null; workdayMinutes: number; christmasSubsidyMonth: number; holidaySubsidyMonth: number | null; perDiemNationalMinor: number | null; perDiemInternationalMinor: number | null; autoIssueDeclarations: boolean; allowancesOnVacation: boolean; province: string | null; municipality: string | null; bankFileProfile: string } }) {
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
          perDiemNationalMinor: kzField(f.get('perDiemNational')),
          perDiemInternationalMinor: kzField(f.get('perDiemInternational')),
          autoIssueDeclarations: f.get('autoIssueDeclarations') === 'on',
          allowancesOnVacation: f.get('allowancesOnVacation') === 'on',
          province: String(f.get('province') || '') || null,
          municipality: String(f.get('municipality') || '').trim() || null,
          bankFileProfile: String(f.get('bankFileProfile') || 'nib'),
        });
        if (done) setOk('Definições gravadas.');
      }}
    >
      <h3>Empresa</h3>
      <label>N.º de contribuinte INSS<input name="inssNumber" defaultValue={s.inssNumber ?? ''} /></label>
      <label className="span2">Morada (aparece nos recibos)<input name="address" defaultValue={s.address ?? ''} /></label>
      <label>Província da sede
        <select name="province" defaultValue={s.province ?? ''}><option value="">—</option>{PROVINCES.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label>Município da sede<input name="municipality" list="agt-municipios" defaultValue={s.municipality ?? ''} placeholder="Ex.: Belas" /><datalist id="agt-municipios">{Object.values(AGT_MUNICIPALITIES).flat().map((m) => <option key={m} value={m} />)}</datalist></label>
      <label className="span2">Banco dos salários (ficheiro de transferências)
        <select name="bankFileProfile" defaultValue={s.bankFileProfile}>
          <option value="nib">Excel NOME, NIB, VALOR (regra comum dos bancos)</option>
          <option value="generic">CSV com IBAN (IBAN; nome; valor; descritivo)</option>
          <option value="bfa">BFA — Excel para o BFA Net Empresas</option>
          <option value="bai">BAI — Excel para o Pagamento em Massa (PSX)</option>
        </select>
      </label>
      <p className="muted wide">A província e o município da sede entram no mapa de remunerações da AGT para quem não tem outro local de trabalho na ficha. O município tem de constar da lista do template da AGT.</p>
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
      <p className="muted wide">Ambos os subsídios correspondem a 50% do salário base (LGT, art. 238.º); sem um ano completo de serviço são proporcionais aos meses completos trabalhados. Nenhum subsídio é pago duas vezes no mesmo ano. A gratificação de férias deve ser paga até 15 dias antes do início das férias (art. 213.º, n.º 5).</p>
      <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="allowancesOnVacation" defaultChecked={s.allowancesOnVacation} /> Pagar subsídios de alimentação e de transporte também nos dias de férias (por acordo — a regra da LGT, art. 213.º, n.º 2, é não pagar)</label>
      <h3>Ajudas de custo</h3>
      <label className="span2">Diária — território nacional (Kz)<input name="perDiemNational" inputMode="decimal" placeholder="Sem limite" defaultValue={s.perDiemNationalMinor ? String(s.perDiemNationalMinor / 100).replace('.', ',') : ''} /></label>
      <label className="span2">Diária — estrangeiro (Kz)<input name="perDiemInternational" inputMode="decimal" placeholder="Sem limite" defaultValue={s.perDiemInternationalMinor ? String(s.perDiemInternationalMinor / 100).replace('.', ',') : ''} /></label>
      <p className="muted wide">Valor máximo por dia nas notas de despesas. As ajudas de custo dentro da diária ficam fora do IRT e do INSS (limite legal assinalado para validação).</p>
      <h3>Portal do colaborador</h3>
      <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" name="autoIssueDeclarations" defaultChecked={s.autoIssueDeclarations} /> Emitir automaticamente as declarações de serviço e de rendimentos pedidas no portal (sem passar pelo RH)</label>
      <div className="form-actions">
        {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
        <button className="btn" disabled={busy}>Gravar</button>
      </div>
    </form>
  );
}
