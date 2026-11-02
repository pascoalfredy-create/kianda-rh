'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

type Permission = 'editor' | 'viewer';
export interface ValuationMember { userId: string; name: string; enabled: boolean; permission: string; role?: string }
const PERMISSION: Record<string, string> = { editor: 'Edição', viewer: 'Consulta' };

/** Utilizadores do Valora: o proprietário autoriza quem acede e com que permissão, dentro do limite da licença. */
export function ValuationMembers({ users, members, self, userLimit }: { users: { id: string; name: string; role?: string }[]; members: ValuationMember[]; self: string; userLimit: number }) {
  const { busy, error, setError, run } = useMutation();
  const others = users.filter(u => u.id !== self);
  const [userId, setUserId] = useState(others[0]?.id ?? '');
  const current = members.find(m => m.userId === userId);
  const [enabled, setEnabled] = useState(current?.enabled !== false);
  const [permission, setPermission] = useState<Permission>((current?.permission as Permission) ?? 'editor');
  const enabledCount = members.filter(m => m.enabled).length;
  function choose(id: string) {
    const m = members.find(x => x.userId === id);
    setUserId(id); setError(''); setEnabled(m?.enabled !== false); setPermission((m?.permission as Permission) ?? 'editor');
  }
  return <div style={{ padding: '0 16px 16px' }}>
    <table className="dense"><thead><tr><th>Utilizador</th><th>Permissão</th><th>Estado</th></tr></thead><tbody>
      {members.map(m => <tr key={m.userId}><td>{m.name}{m.userId === self ? ' (eu)' : ''}</td><td>{PERMISSION[m.permission] ?? m.permission}</td><td>{m.enabled ? <span className="st approved">Autorizado</span> : <span className="tag">Sem acesso</span>}</td></tr>)}
    </tbody></table>
    <p className="muted">{enabledCount} de {userLimit} lugares ocupados. Para adicionar uma pessoa à conta, use <a href="/acessos">Utilizadores e acessos</a> e depois autorize-a aqui. Com «Consulta», vê as análises e os relatórios sem os alterar.</p>
    {others.length ? <form className="form" onSubmit={async e => { e.preventDefault(); await run(`/v1/valuation/members/${userId}`, 'PUT', { enabled, permission }); }}>
      <label>Utilizador<select value={userId} onChange={e => choose(e.target.value)}>{others.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Permissão<select value={permission} onChange={e => setPermission(e.target.value as Permission)}><option value="editor">Edição</option><option value="viewer">Consulta</option></select></label>
      <label>Acesso<select value={String(enabled)} onChange={e => setEnabled(e.target.value === 'true')}><option value="true">Autorizar</option><option value="false">Retirar acesso</option></select></label>
      {error && <div className="alert wide">{error}</div>}
      <div className="actions wide"><button className="btn" disabled={busy || !userId}>{busy ? 'A guardar…' : 'Guardar acesso'}</button></div>
    </form> : <p className="muted">Ainda não há outros utilizadores na conta.</p>}
  </div>;
}
