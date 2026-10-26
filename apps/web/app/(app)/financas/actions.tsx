'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

interface Row { role: string; account: string; label: string; expectedClass: string; group: string; isDefault: boolean }

export function ChartForm({ rows, editable }: { rows: Row[]; editable: boolean }) {
  const { busy, error, run } = useMutation();
  const [ok, setOk] = useState('');
  const [state, setState] = useState(rows);
  const set = (i: number, k: 'account' | 'label', v: string) => setState((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const groups = [...new Set(state.map((r) => r.group))];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setOk('');
        if (await run('/v1/ledger/accounts', 'PUT', { mappings: state.map(({ role, account, label }) => ({ role, account, label })) })) setOk('Plano de contas gravado. Aplica-se aos próximos lançamentos.');
      }}
    >
      {groups.map((g) => (
        <div key={g} className="card section">
          <h2>{g}</h2>
          <table>
            <thead><tr><th style={{ width: 150 }}>Conta PGC</th><th>Descrição</th><th style={{ width: 120 }}>Classe</th></tr></thead>
            <tbody>
              {state.map((r, i) => r.group !== g ? null : (
                <tr key={r.role}>
                  <td>{editable ? <input value={r.account} onChange={(e) => set(i, 'account', e.target.value)} style={{ width: 120, fontWeight: 600 }} /> : <b>{r.account}</b>}</td>
                  <td>{editable ? <input value={r.label} onChange={(e) => set(i, 'label', e.target.value)} style={{ width: '100%' }} /> : r.label}</td>
                  <td className="muted">Classe {r.expectedClass}{r.account.trim().charAt(0) !== r.expectedClass && <span className="flag red" style={{ marginLeft: 6 }}>classe errada</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editable && (
        <div className="form-actions" style={{ marginBottom: 20 }}>
          {error ? <span className="err">{error}</span> : ok ? <span className="ok">{ok}</span> : null}
          <button className="btn" disabled={busy}>Gravar plano de contas</button>
        </div>
      )}
    </form>
  );
}

export function MarkExported({ from, to, pending }: { from: string; to: string; pending: number }) {
  const { busy, error, run } = useMutation();
  const [done, setDone] = useState('');
  if (done) return <span className="ok" style={{ color: 'var(--brand)' }}>{done}</span>;
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className="btn ghost" disabled={busy || !pending} onClick={async () => { await run<{ marked: number }>('/v1/ledger/export/mark', 'POST', { from, to }, (d) => setDone(`${d?.marked ?? 0} lançamento(s) marcados como exportados.`)); }}>
        Marcar como exportados ({pending})
      </button>
      {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
