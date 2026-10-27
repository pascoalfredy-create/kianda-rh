'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

export function ConfirmPayment({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  const [inv, setInv] = useState('');
  return (
    <span className="actions">
      <input value={inv} onChange={(e) => setInv(e.target.value)} placeholder="N.º da factura (software certificado)" style={{ width: 230 }} />
      <button className="btn sm" disabled={busy} onClick={() => run(`/v1/platform/payment-requests/${id}/confirm`, 'POST', { invoiceRef: inv || null })}>Confirmar recebimento</button>
      <button className="btn ghost sm" disabled={busy} onClick={() => { if (window.confirm('Cancelar este pedido?')) void run(`/v1/platform/payment-requests/${id}/cancel`, 'POST', {}); }}>Cancelar</button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}

interface Sub { id: string; status: string; tierKey: string | null; trialEndsAt: string | null; paidUntil: string | null; extraSeats: number; notes: string | null }
export function EditSubscription({ c, tiers }: { c: Sub; tiers: { key: string; label: string }[] }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Ajustar</button>;
  return (
    <form className="form" style={{ gridTemplateColumns: 'repeat(3, 1fr)', padding: 8, minWidth: 520 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const toNum = (k: string) => (f.get(k) ? Math.round(Number(String(f.get(k)).replace(/\s/g, '').replace(',', '.')) * (k === 'customMonthly' ? 100 : 1)) : null);
      const payload: Record<string, unknown> = { status: f.get('status'), tierKey: f.get('tierKey'), trialEndsAt: f.get('trialEndsAt') || null, paidUntil: f.get('paidUntil') || null, extraSeats: Number(f.get('extraSeats') || 0), notes: f.get('notes') || null };
      if (f.get('tierKey') === 'custom') { payload.customMaxEmployees = toNum('customMax'); payload.customMonthlyMinor = toNum('customMonthly'); }
      if (await run(`/v1/platform/companies/${c.id}/subscription`, 'PATCH', payload)) setOpen(false);
    }}>
      <label>Estado<select name="status" defaultValue={['trial', 'active', 'suspended', 'cancelled'].includes(c.status) ? c.status : 'active'}><option value="trial">Experimental</option><option value="active">Activa</option><option value="suspended">Suspensa</option><option value="cancelled">Cancelada</option></select></label>
      <label>Escalão<select name="tierKey" defaultValue={c.tierKey ?? 't1'}>{tiers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
      <label>Extras<input name="extraSeats" type="number" min={0} defaultValue={c.extraSeats} /></label>
      <label>Experimental até<input name="trialEndsAt" type="date" defaultValue={c.trialEndsAt ?? ''} /></label>
      <label>Pago até<input name="paidUntil" type="date" defaultValue={c.paidUntil ?? ''} /></label>
      <label>À medida: limite<input name="customMax" inputMode="numeric" /></label>
      <label>À medida: Kz/mês<input name="customMonthly" inputMode="decimal" /></label>
      <label className="span2">Notas<input name="notes" defaultValue={c.notes ?? ''} /></label>
      <div className="actions wide" style={{ justifyContent: 'flex-start' }}>{error && <span className="err">{error}</span>}<button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Fechar</button><button className="btn sm" disabled={busy}>Gravar</button></div>
    </form>
  );
}

export function SettingsForm({ s }: { s: { extraSeatMinor: number | null; bank: { holder: string; bankName: string; iban: string } | null; supportEmail: string | null; supportPhone: string | null } }) {
  const { busy, error, run } = useMutation();
  const [ok, setOk] = useState('');
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault(); setOk('');
      const f = new FormData(e.currentTarget);
      const extra = String(f.get('extra') ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
      const bank = f.get('iban') ? { holder: f.get('holder'), bankName: f.get('bankName'), iban: String(f.get('iban')).replace(/\s/g, '') } : null;
      if (await run('/v1/platform/settings', 'PUT', { extraSeatMinor: extra ? Math.round(Number(extra) * 100) : null, bank, supportEmail: f.get('supportEmail') || null, supportPhone: f.get('supportPhone') || null })) setOk('Gravado.');
    }}>
      <label>Preço por colaborador extra (Kz, pagamento único)<input name="extra" inputMode="decimal" defaultValue={s.extraSeatMinor ? String(s.extraSeatMinor / 100) : ''} placeholder="por definir" /></label>
      <label>Titular da conta<input name="holder" defaultValue={s.bank?.holder ?? ''} /></label>
      <label>Banco<input name="bankName" defaultValue={s.bank?.bankName ?? ''} /></label>
      <label className="span2">IBAN para transferências<input name="iban" defaultValue={s.bank?.iban ?? ''} /></label>
      <label>Email de suporte<input name="supportEmail" type="email" defaultValue={s.supportEmail ?? ''} placeholder="suporte@…" /></label>
      <label>Telefone / WhatsApp de suporte<input name="supportPhone" type="tel" defaultValue={s.supportPhone ?? ''} placeholder="+244 9…" /></label>
      <div className="form-actions wide">{error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}<button className="btn" disabled={busy}>Gravar</button></div>
    </form>
  );
}

interface Invoicing { autoIssue: boolean; taxId: 'NOR' | 'ISE'; exemptionCode: string | null; exemptionLaw: string | null; paymentMethodId: number | null; registerId: number | null }

export function InvoicingForm({ v, enabled }: { v: Invoicing; enabled: boolean }) {
  const { busy, error, run } = useMutation();
  const [f, setF] = useState({ ...v, paymentMethodId: v.paymentMethodId ? String(v.paymentMethodId) : '', registerId: v.registerId ? String(v.registerId) : '', exemptionCode: v.exemptionCode ?? '', exemptionLaw: v.exemptionLaw ?? '' });
  const [ok, setOk] = useState('');
  return (
    <div className="form">
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" style={{ height: 'auto' }} checked={f.autoIssue} disabled={!enabled} onChange={(e) => setF({ ...f, autoIssue: e.target.checked })} />Emitir a factura-recibo automaticamente ao receber o pagamento</label>
      <label>Imposto na linha
        <select value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value as 'NOR' | 'ISE' })}><option value="NOR">Taxa normal (IVA incluído no preço)</option><option value="ISE">Isento / não sujeito</option></select>
      </label>
      {f.taxId === 'ISE' && <>
        <label>Código de isenção<input value={f.exemptionCode} onChange={(e) => setF({ ...f, exemptionCode: e.target.value })} placeholder="Ex.: M04" /></label>
        <label>Fundamento legal<input value={f.exemptionLaw} onChange={(e) => setF({ ...f, exemptionLaw: e.target.value })} placeholder="Artigo e diploma" /></label>
      </>}
      <label>Id do meio de pagamento no Vendus<input inputMode="numeric" value={f.paymentMethodId} onChange={(e) => setF({ ...f, paymentMethodId: e.target.value })} placeholder="opcional" /></label>
      <label>Id da caixa (POS) no Vendus<input inputMode="numeric" value={f.registerId} onChange={(e) => setF({ ...f, registerId: e.target.value })} placeholder="opcional" /></label>
      <div className="form-actions">
        {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
        <button className="btn" disabled={busy} onClick={() => run('/v1/platform/invoicing', 'PUT', {
          autoIssue: f.autoIssue, taxId: f.taxId, exemptionCode: f.exemptionCode || null, exemptionLaw: f.exemptionLaw || null,
          paymentMethodId: f.paymentMethodId ? Number(f.paymentMethodId) : null, registerId: f.registerId ? Number(f.registerId) : null,
        }, () => setOk('Guardado'))}>Guardar facturação</button>
      </div>
    </div>
  );
}

export function JobButtons({ gateway }: { gateway: boolean }) {
  const { busy, error, run } = useMutation();
  const [msg, setMsg] = useState('');
  return (
    <div className="actions" style={{ justifyContent: 'flex-start', padding: '10px 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {gateway && <button className="btn ghost sm" disabled={busy} onClick={() => run<{ processed: number; applied: number; issues: number }>('/v1/platform/gateway/sync', 'POST', {}, (d) => setMsg(`${d?.processed ?? 0} pagamento(s) lido(s), ${d?.applied ?? 0} aplicado(s), ${d?.issues ?? 0} para rever`))}>Sincronizar pagamentos Multicaixa</button>}
      <button className="btn ghost sm" disabled={busy} onClick={() => run<{ checked: number; sent: number }>('/v1/platform/jobs/reminders', 'POST', {}, (d) => setMsg(`${d?.checked ?? 0} licença(s) verificada(s), ${d?.sent ?? 0} aviso(s) enviado(s)`))}>Enviar avisos de licença de hoje</button>
      {error ? <span className="err">{error}</span> : msg ? <span className="muted">{msg}</span> : null}
    </div>
  );
}

export function IssueInvoice({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  return <span><button className="btn ghost sm" disabled={busy} onClick={() => run(`/v1/platform/payment-requests/${id}/invoice`, 'POST', {})}>Emitir factura</button>{error && <span className="err" style={{ display: 'block', maxWidth: 360, whiteSpace: 'normal' }}>{error}</span>}</span>;
}

export function MockPayment({ id }: { id: string }) {
  const { busy, error, run } = useMutation();
  const [done, setDone] = useState(false);
  return <span>{done ? <span className="muted">simulado — aguarde o webhook ou sincronize</span> : <button className="btn ghost sm" disabled={busy} onClick={() => run('/v1/platform/gateway/mock', 'POST', { requestId: id }, () => setDone(true))}>Simular pagamento (testes)</button>}{error && <span className="err">{error}</span>}</span>;
}
