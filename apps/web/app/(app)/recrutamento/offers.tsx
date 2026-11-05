'use client';
import Link from 'next/link';
import { useState } from 'react';
import { formatAmount, formatKz, parseAmount } from '@kianda/core';
import { useMutation } from '@/lib/client';
import { OFFER_STATUS, type Offer } from './offer-types';
export type { Offer } from './offer-types';

const money = (value: FormDataEntryValue | null) => { const n = parseAmount(String(value ?? '').trim() || '0'); return n == null ? NaN : n / 100; };

export function CandidateOffers({ id, expectedSalaryMinor, offers, editable, stage }: { id: string; expectedSalaryMinor: number | null; offers: Offer[]; editable: boolean; stage: string }) {
  const { busy, error, run } = useMutation(), [kind, setKind] = useState('counteroffer'), [create, setCreate] = useState(false);
  const current = offers[0];
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10), valid = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return <section className="card section" aria-label="Negociação salarial" style={{ margin: '16px 0' }}><h2>Proposta e negociação salarial</h2><div style={{ padding: '0 16px 16px' }}>
    <p>Pretensão original: <b>{expectedSalaryMinor != null ? formatKz(expectedSalaryMinor) : 'Não indicada'}</b>.</p>
    <p className="muted">As propostas usam salário base bruto mensal em Kz. Se a pretensão foi indicada como líquido, confirme a base bruta no simulador antes de preparar a contraproposta. Cada proposta mantém a sua versão e a admissão exige o acordo aceite.</p>
    {!offers.length && <p className="muted">Ainda não foi preparada uma proposta.</p>}
    {offers.map(o => <div key={o.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <b>Versão {o.version} · {o.kind === 'accept_expected' ? 'Aceitação da pretensão' : 'Contraproposta'}</b> · {OFFER_STATUS[o.status] ?? o.status}
      <p>Base bruta: {formatKz(o.baseMinor)} · válida até {o.validUntil}</p>
      <Link className="btn ghost sm" href={`/recrutamento/candidatos/${id}/propostas/${o.id}`}>Ver proposta v{o.version}</Link>
      {o.counterMinor != null && <p>Nova pretensão: {formatKz(o.counterMinor)}</p>}{o.responseNote && <p className="muted">Resposta registada pelo RH: {o.responseNote}</p>}
      {editable && o.id === current?.id && stage === 'offer' && o.validUntil >= today && ['draft', 'sent'].includes(o.status) && <>
        {o.status === 'draft' && <form className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 10 }} onSubmit={e => { e.preventDefault(); void run(`/v1/candidates/${id}/offers/${o.id}/send`, 'POST', { replyTo: new FormData(e.currentTarget).get('replyTo') }); }}><label>Email do RH para resposta<input type="email" name="replyTo" required maxLength={254} /></label><button className="btn ghost" disabled={busy}>Enviar proposta por email</button></form>}
        <details style={{ marginTop: 10 }}><summary>Registar resposta recebida do candidato</summary><form className="form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(`/v1/candidates/${id}/offers/${o.id}/response`, 'POST', { status: f.get('status'), note: f.get('note'), ...(f.get('counter') ? { counter: money(f.get('counter')) } : {}) }); }}>
          <label>Resposta<select aria-label="Resposta" name="status"><option value="accepted">Aceitou a proposta</option><option value="countered">Apresentou nova pretensão</option><option value="declined">Recusou a proposta</option></select></label>
          <label>Nova pretensão base bruta (Kz)<input name="counter" inputMode="decimal" /></label>
          <label className="wide">Origem e conteúdo da resposta<textarea name="note" required minLength={5} maxLength={1500} placeholder="Ex.: email recebido em… / reunião de…" /></label>
          <div className="form-actions wide"><button className="btn" disabled={busy}>Registar resposta</button></div>
        </form></details>
      </>}
    </div>)}
    {editable && stage === 'offer' && <>
      <button type="button" className="btn" disabled={busy} onClick={() => setCreate(!create)}>{create ? 'Cancelar nova proposta' : current ? 'Preparar nova versão' : 'Preparar proposta salarial'}</button>
      {create && <form className="form" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await run(`/v1/candidates/${id}/offers`, 'POST', { kind, ...(kind === 'counteroffer' ? { base: money(f.get('base')) } : { expectedBasis: f.get('confirmGross') ? 'gross_base' : undefined }), meal: money(f.get('meal')), transport: money(f.get('transport')), validUntil: f.get('validUntil'), startDate: f.get('startDate') || null, terms: f.get('terms') || '' })) setCreate(false); }}>
        <label className="wide">Modalidade<select aria-label="Modalidade" value={kind} onChange={e => setKind(e.target.value)}><option value="counteroffer">Preparar contraproposta</option><option value="accept_expected" disabled={!expectedSalaryMinor}>Aceitar a pretensão salarial</option></select></label>
        {kind === 'accept_expected' ? <label className="wide" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><input name="confirmGross" type="checkbox" required /> Confirmei com o candidato que {formatKz(expectedSalaryMinor ?? 0)} corresponde à base bruta mensal.</label> : <label>Base bruta mensal (Kz)<input name="base" inputMode="decimal" required defaultValue={current?.counterMinor ? formatAmount(current.counterMinor) : ''} /></label>}
        <label>Alimentação mensal (Kz)<input name="meal" inputMode="decimal" defaultValue="0" /></label><label>Transporte mensal (Kz)<input name="transport" inputMode="decimal" defaultValue="0" /></label>
        <label>Início previsto<input name="startDate" type="date" /></label><label>Válida até<input name="validUntil" type="date" min={today} defaultValue={valid} required /></label>
        <label className="wide">Condições e próximos passos<textarea name="terms" maxLength={3000} rows={3} /></label>
        <p className="muted wide">Preparar cria um rascunho para revisão. O envio por email é uma acção separada. Uma nova versão substitui a proposta anterior.</p>
        <div className="form-actions wide"><button className="btn" disabled={busy}>Gerar proposta para revisão</button></div>
      </form>}
    </>}
    {error && <p className="err" role="alert">{error}</p>}
  </div></section>;
}

export interface CandidateNotification { id: string; kind: string; status: string; createdAt: string; sentAt: string | null; error: string | null }
export function CandidateNotifications({ id, items, configured, editable }: { id: string; items: CandidateNotification[]; configured: boolean; editable: boolean }) {
  const { busy, error, run } = useMutation();
  const labels: Record<string, string> = { pending: 'A aguardar envio', sending: 'A enviar', sent: 'Enviado ao serviço de email', failed: 'Falha no envio', delivery_unknown: 'Entrega por confirmar — verificar no fornecedor', no_address: 'Sem endereço de email' };
  return <details className="card section" style={{ padding: 16, marginBottom: 16 }}><summary>Ver notificações ao candidato ({items.length})</summary>
    <p className="muted">Cada mudança de etapa gera uma mensagem automática. Comentários e motivos internos não são enviados. «Enviado» confirma a aceitação pelo serviço, não a leitura ou entrega na caixa do candidato.</p>
    {!configured && <p className="warn">O envio de email ainda precisa de configuração da plataforma. As mensagens ficam guardadas para envio posterior.</p>}
    {items.map(m => <p key={m.id}>{m.kind === 'recruitment_offer' ? 'Proposta salarial' : 'Mudança de etapa'} · {new Date(m.createdAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' })} · <b>{labels[m.status] ?? m.status}</b>{m.error && <span className="muted"> · {m.error}</span>}{editable && ['pending', 'failed'].includes(m.status) && <button type="button" className="btn ghost sm" disabled={busy || !configured} onClick={() => run(`/v1/candidates/${id}/notifications/${m.id}/retry`, 'POST')}>Voltar a tentar</button>}</p>)}
    {error && <p className="err" role="alert">{error}</p>}
  </details>;
}
