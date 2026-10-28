'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

export interface ModelingMember { userId: string; name: string; enabled: boolean; permission: string }
export function ModelingMembers({ users, members, self }: { users: { id: string; name: string }[]; members: ModelingMember[]; self: string }) {
  const { busy, error, run } = useMutation();
  const [userId, setUserId] = useState(users.find(u => u.id !== self)?.id ?? '');
  const selected = members.find(m => m.userId === userId);
  return <div style={{ padding: '0 16px 16px' }}>
    <table className="dense"><thead><tr><th>Utilizador</th><th>Permissão</th><th>Estado</th></tr></thead><tbody>{members.map(m => <tr key={m.userId}><td>{m.name}{m.userId === self ? ' (eu)' : ''}</td><td>{m.permission === 'editor' ? 'Edição' : 'Consulta'}</td><td>{m.enabled ? 'Autorizado' : 'Sem acesso'}</td></tr>)}</tbody></table>
    <p className="muted">Os lugares são atribuídos explicitamente. Para adicionar uma pessoa à conta, use <a href="/acessos">Utilizadores e acessos</a> e depois autorize-a aqui.</p>
    <form className="form" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      await run(`/v1/modeling/members/${userId}`, 'PUT', { enabled: f.get('enabled') === 'true', permission: f.get('permission') });
    }}>
      <label>Utilizador<select value={userId} onChange={e => setUserId(e.target.value)}>{users.filter(u => u.id !== self).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label key={`permission:${userId}:${selected?.permission}`}>Permissão<select name="permission" defaultValue={selected?.permission ?? 'editor'}><option value="editor">Edição</option><option value="viewer">Consulta</option></select></label>
      <label key={`enabled:${userId}:${selected?.enabled}`}>Acesso<select name="enabled" defaultValue={selected?.enabled === false ? 'false' : 'true'}><option value="true">Autorizar</option><option value="false">Retirar acesso</option></select></label>
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button className="btn" disabled={busy || !userId}>Gravar acesso à Modelagem</button></div>
    </form>
  </div>;
}
