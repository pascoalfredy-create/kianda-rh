'use client';

import { DOCUMENT_ACCEPT, formatKz } from '@kianda/core';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { send, useMutation } from '@/lib/client';
import { readStatementDocument } from '@/lib/document-import';

const pt = (d: string) => d.split('-').reverse().join('/');

type Key = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'reference';
const ROLES: [Key, string][] = [['date', 'Data'], ['description', 'Descritivo'], ['amount', 'Valor (com sinal)'], ['debit', 'Débito'], ['credit', 'Crédito'], ['balance', 'Saldo'], ['reference', 'Referência']];
interface Preview {
  headers: string[]; headerRow: number; mapping: Partial<Record<Key, number>> | null; count: number; newCount: number; duplicates: number;
  from: string | null; to: string | null; inflowMinor: number; outflowMinor: number;
  balance: { openingMinor: number; closingMinor: number; ok: boolean; breaks: number[] } | null;
  problems: { line: number; message: string }[]; problemCount: number;
  sample: { line: number; date: string; description: string; reference: string | null; amountMinor: number; balanceMinor: number | null }[];
}

export function StatementImport({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Key, number>>>({});
  const [headerRow, setHeaderRow] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null), requestId = useRef(0), reading = useRef<AbortController | null>(null);
  useEffect(() => () => { requestId.current++; reading.current?.abort(); }, []);

  function clear() {
    requestId.current++; reading.current?.abort(); reading.current = null;
    if (input.current) input.current.value = '';
    setFile(null); setPv(null); setSelectedName(''); setMapping({}); setHeaderRow(undefined); setError(''); setDone(''); setBusy(false);
  }

  async function selectDocument(f: File) {
    clear(); const token = requestId.current, controller = new AbortController(); reading.current = controller;
    setSelectedName(f.name); setBusy(true);
    try {
      const text = await readStatementDocument(f, { signal: controller.signal });
      if (token !== requestId.current || controller.signal.aborted) return;
      setFile({ name: f.name, text });
      await preview(text, f.name, undefined, undefined, token);
    } catch (error) {
      if (token === requestId.current && !controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Não foi possível ler o documento.'); setBusy(false); }
    } finally { if (reading.current === controller) reading.current = null; }
  }

  async function preview(text: string, name: string, m?: Partial<Record<Key, number>>, h?: number, token = ++requestId.current) {
    setBusy(true); setError(''); setDone('');
    const full = m && m.date !== undefined && m.description !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined);
    try {
      const r = await send<Preview>('/v1/bank/statements/preview', 'POST', { accountId, fileName: name, text, mapping: full ? m : undefined, headerRow: h });
      if (token !== requestId.current) return;
      if (!r.ok) { setPv(null); return setError(r.message ?? 'Erro'); }
      setPv(r.data!); setMapping(m ?? r.data!.mapping ?? {}); setHeaderRow(r.data!.headerRow);
    } catch {
      if (token === requestId.current) { setPv(null); setError('Não foi possível conferir o extracto. Tente novamente.'); }
    } finally { if (token === requestId.current) setBusy(false); }
  }

  async function confirm() {
    if (!file || !pv || busy || saving) return;
    setBusy(true); setSaving(true); setError('');
    const full = mapping.date !== undefined && mapping.description !== undefined;
    try {
      const r = await send<{ newCount: number; duplicates: number; matched: number }>('/v1/bank/statements', 'POST', { accountId, fileName: file.name, text: file.text, mapping: full ? mapping : undefined, headerRow });
      if (!r.ok) return setError(r.message ?? 'Erro');
      clear(); setDone(`Importados ${r.data!.newCount} movimento(s)${r.data!.duplicates ? ` (${r.data!.duplicates} já existiam)` : ''}. ${r.data!.matched} pagamento(s) conciliado(s) automaticamente.`);
      router.refresh();
    } catch { setError('Não foi possível confirmar o resultado da importação. Confira a lista antes de tentar novamente.'); }
    finally { setBusy(false); setSaving(false); }
  }

  const mappingOk = mapping.date !== undefined && mapping.description !== undefined && (mapping.amount !== undefined || mapping.debit !== undefined || mapping.credit !== undefined);
  return (
    <div className="card section">
      <h2>Importar extracto</h2>
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <label className="muted" style={{ display: 'grid', gap: 6 }}>
          Extracto em CSV, TXT, PDF com texto ou Word (.docx), até 10 MB. Confira a leitura antes de importar. Movimentos já importados são ignorados.
          <input ref={input} type="file" accept={DOCUMENT_ACCEPT} disabled={saving} onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void selectDocument(f);
          }} />
        </label>
        {selectedName && <div className="actions" style={{ justifyContent: 'flex-start' }}><span>{selectedName}{busy ? ' · A processar…' : ''}</span><button type="button" className="btn ghost sm" disabled={saving} onClick={clear}>{busy && !saving ? 'Cancelar leitura' : 'Remover documento'}</button></div>}
        {error && <div className="err" style={{ color: 'var(--red)' }}>{error}</div>}
        {done && <div className="ok" style={{ color: 'var(--brand)', fontWeight: 600 }}>{done}</div>}
        {pv && file && (
          <>
            <div className="form" style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <label>Linha do cabeçalho
                <input type="number" min={1} value={(headerRow ?? 0) + 1} onChange={(e) => { const h = Math.max(0, Number(e.target.value) - 1); void preview(file.text, file.name, undefined, h); }} />
              </label>
              {ROLES.map(([k, label]) => (
                <label key={k}>{label}
                  <select value={mapping[k] ?? ''} onChange={(e) => {
                    const m = { ...mapping, [k]: e.target.value === '' ? undefined : Number(e.target.value) };
                    if (k === 'amount' && e.target.value !== '') { m.debit = undefined; m.credit = undefined; }
                    if ((k === 'debit' || k === 'credit') && e.target.value !== '') m.amount = undefined;
                    setMapping(m);
                    void preview(file.text, file.name, m, headerRow);
                  }}>
                    <option value="">—</option>
                    {pv.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {pv.count > 0 ? (
              <p>
                <b>{pv.count}</b> movimento(s) de {pt(pv.from!)} a {pt(pv.to!)} · entradas {formatKz(pv.inflowMinor)} · saídas {formatKz(pv.outflowMinor)} · <b>{pv.newCount}</b> novo(s){pv.duplicates ? `, ${pv.duplicates} já importado(s)` : ''}
                {' · '}{pv.balance ? (pv.balance.ok
                  ? <span className="st approved">Saldos conferem: {formatKz(pv.balance.openingMinor)} → {formatKz(pv.balance.closingMinor)}</span>
                  : <span className="st rejected">Saldo não confere nas linhas {pv.balance.breaks.slice(0, 5).join(', ')}{pv.balance.breaks.length > 5 ? '…' : ''}</span>)
                  : <span className="muted">sem coluna de saldo</span>}
              </p>
            ) : <div className="warn">Nenhum movimento lido. Confirme a linha do cabeçalho e as colunas.</div>}
            {pv.problemCount > 0 && <div className="warn">{pv.problemCount} linha(s) ignorada(s): {pv.problems.slice(0, 4).map((p) => `linha ${p.line} — ${p.message}`).join('; ')}</div>}
            {pv.sample.length > 0 && (
              <table className="dense">
                <thead><tr><th>Linha</th><th>Data</th><th>Descritivo</th><th>Referência</th><th className="num">Valor</th><th className="num">Saldo</th></tr></thead>
                <tbody>{pv.sample.map((r) => <tr key={r.line}><td className="muted">{r.line}</td><td>{pt(r.date)}</td><td>{r.description}</td><td>{r.reference ?? ''}</td><td className="num" style={{ color: r.amountMinor < 0 ? 'var(--red)' : undefined }}>{formatKz(r.amountMinor)}</td><td className="num">{r.balanceMinor === null ? '' : formatKz(r.balanceMinor)}</td></tr>)}</tbody>
              </table>
            )}
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button className="btn" disabled={busy || !mappingOk || !pv.newCount} onClick={confirm}>Importar {pv.newCount} movimento(s)</button>
              <button className="btn ghost" disabled={saving} onClick={clear}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function NewAccount({ first }: { first: boolean }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(first);
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Nova conta bancária</button>;
  return (
    <form className="card form" style={{ marginBottom: 14 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      await run('/v1/bank/accounts', 'POST', { name: f.get('name'), bankName: f.get('bankName') || null, iban: f.get('iban') || null, ledgerAccount: f.get('ledgerAccount') }, () => setOpen(false));
    }}>
      <h3>Conta bancária de pagamentos de pessoal</h3>
      <label>Nome<input name="name" required placeholder="Ex.: BAI — conta de salários" /></label>
      <label>Banco<input name="bankName" placeholder="BAI, BFA, BIC…" /></label>
      <label>IBAN<input name="iban" placeholder="AO06 …" /></label>
      <label>Conta PGC (classe 4)<input name="ledgerAccount" defaultValue="43.1" required /></label>
      <div className="form-actions wide">
        {error && <span className="err">{error}</span>}
        {!first && <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>}
        <button className="btn" disabled={busy}>Criar conta</button>
      </div>
    </form>
  );
}

export function Btn({ label, path, method = 'POST', payload, kind = 'ghost', confirmText }: { label: string; path: string; method?: string; payload?: object; kind?: string; confirmText?: string }) {
  const { busy, error, run } = useMutation();
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className={`btn sm ${kind}`} disabled={busy} onClick={async () => { if (confirmText && !window.confirm(confirmText)) return; await run(path, method, payload ?? {}); }}>{label}</button>
      {error && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}

interface Line { id: string; date: string; description: string; reference: string | null; amountMinor: number }

/** Conciliação manual: escolher os movimentos a débito que somam o valor do pagamento. */
export function ManualMatch({ accountId, paymentId, amountMinor, lines }: { accountId: string; paymentId: string; amountMinor: number; lines: Line[] }) {
  const { busy, error, run } = useMutation();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)} disabled={!lines.length}>Escolher movimentos</button>;
  const total = lines.filter((l) => sel.includes(l.id)).reduce((s, l) => s - l.amountMinor, 0);
  return (
    <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {lines.map((l) => (
          <label key={l.id} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13 }}>
            <input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
            <span style={{ width: 80 }}>{pt(l.date)}</span><span style={{ flex: 1 }}>{l.description}</span><b>{formatKz(-l.amountMinor)}</b>
          </label>
        ))}
      </div>
      <div className="actions" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span>Seleccionado {formatKz(total)} de {formatKz(amountMinor)} {total === amountMinor ? <span className="st approved">confere</span> : <span className="muted">(diferença {formatKz(amountMinor - total)})</span>}</span>
        <span className="actions">
          {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
          <button className="btn ghost sm" onClick={() => { setOpen(false); setSel([]); }}>Cancelar</button>
          <button className="btn sm" disabled={busy || total !== amountMinor} onClick={() => run('/v1/bank/matches', 'POST', { accountId, paymentId, lineIds: sel })}>Conciliar</button>
        </span>
      </div>
    </div>
  );
}

/** Selecção de movimentos por conciliar para os marcar como "não é de pessoal". */
export function PendingLines({ lines, canEdit }: { lines: (Line & { balanceMinor: number | null })[]; canEdit: boolean }) {
  const { busy, error, run } = useMutation();
  const [sel, setSel] = useState<string[]>([]);
  const [note, setNote] = useState('Não é de pessoal');
  return (
    <>
      {canEdit && (
        <div className="actions" style={{ justifyContent: 'flex-start', padding: '10px 16px', borderBottom: '1px solid #f0f1f4' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sel.length === lines.length && lines.length > 0} onChange={(e) => setSel(e.target.checked ? lines.map((l) => l.id) : [])} /> Todos</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 240 }} placeholder="Motivo" />
          <button className="btn ghost sm" disabled={busy || !sel.length} onClick={async () => { if (await run('/v1/bank/lines/ignore', 'POST', { lineIds: sel, note })) setSel([]); }}>Marcar {sel.length || ''} como fora do âmbito</button>
          {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
      )}
      <table className="dense">
        <thead><tr>{canEdit && <th style={{ width: 30 }} />}<th>Data</th><th>Descritivo</th><th>Referência</th><th className="num">Entrada</th><th className="num">Saída</th><th className="num">Saldo</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              {canEdit && <td><input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} /></td>}
              <td>{pt(l.date)}</td><td>{l.description}</td><td className="muted">{l.reference ?? ''}</td>
              <td className="num">{l.amountMinor > 0 ? formatKz(l.amountMinor) : ''}</td><td className="num">{l.amountMinor < 0 ? formatKz(-l.amountMinor) : ''}</td>
              <td className="num muted">{l.balanceMinor === null ? '' : formatKz(l.balanceMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
