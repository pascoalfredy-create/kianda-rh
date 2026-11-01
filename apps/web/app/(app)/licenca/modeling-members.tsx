'use client';

import { useState } from 'react';
import { useMutation } from '@/lib/client';

type Permission = 'editor' | 'viewer';
export interface ModelingMember { userId: string; name: string; enabled: boolean; permission: string; scope?: 'all' | 'selected'; role?: string; projects?: { modelId: string; permission: string }[] }
export interface ModelingProject { id: string; name: string; sector: string; archivedAt: string | null }

const PERMISSION: Record<string, string> = { editor: 'Edição', viewer: 'Consulta' };

/** Participantes do Integra: permissão geral e, opcionalmente, acesso só a projectos escolhidos. */
export function ModelingMembers({ users, members, projects, self }: { users: { id: string; name: string; role?: string }[]; members: ModelingMember[]; projects: ModelingProject[]; self: string }) {
  const { busy, error, setError, run } = useMutation();
  const [userId, setUserId] = useState(users.find(u => u.id !== self)?.id ?? '');
  const selected = members.find(m => m.userId === userId);
  const isOwner = (users.find(u => u.id === userId)?.role ?? selected?.role) === 'owner';
  const [enabled, setEnabled] = useState(selected?.enabled !== false);
  const [permission, setPermission] = useState<Permission>((selected?.permission as Permission) ?? 'editor');
  const [scope, setScope] = useState<'all' | 'selected'>(selected?.scope ?? 'all');
  const [assigned, setAssigned] = useState<Record<string, Permission>>(Object.fromEntries((selected?.projects ?? []).map(p => [p.modelId, p.permission as Permission])));

  function choose(id: string) {
    const m = members.find(x => x.userId === id);
    setUserId(id); setError('');
    setEnabled(m?.enabled !== false); setPermission((m?.permission as Permission) ?? 'editor'); setScope(m?.scope ?? 'all');
    setAssigned(Object.fromEntries((m?.projects ?? []).map(p => [p.modelId, p.permission as Permission])));
  }
  function changePermission(p: Permission) {
    setPermission(p);
    // Com acesso geral de consulta, nenhum projecto pode ficar em edição.
    if (p === 'viewer') setAssigned(a => Object.fromEntries(Object.keys(a).map(k => [k, 'viewer' as Permission])));
  }
  const toggle = (id: string, on: boolean) => setAssigned(a => { const n = { ...a }; if (on) n[id] = permission === 'viewer' ? 'viewer' : 'editor'; else delete n[id]; return n; });
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? 'Projecto';
  const scopeLabel = (m: ModelingMember) => m.scope === 'selected' ? (m.projects?.length ? m.projects.map(p => `${projectName(p.modelId)} (${PERMISSION[p.permission] ?? p.permission})`).join(', ') : 'Nenhum projecto atribuído') : 'Todos os projectos';
  const active = projects.filter(p => !p.archivedAt), archived = projects.filter(p => p.archivedAt);

  return <div style={{ padding: '0 16px 16px' }}>
    <table className="dense"><thead><tr><th>Utilizador</th><th>Permissão</th><th>Projectos</th><th>Estado</th></tr></thead><tbody>{members.map(m => <tr key={m.userId}><td>{m.name}{m.userId === self ? ' (eu)' : ''}</td><td>{PERMISSION[m.permission] ?? m.permission}</td><td>{scopeLabel(m)}</td><td>{m.enabled ? 'Autorizado' : 'Sem acesso'}</td></tr>)}</tbody></table>
    <p className="muted">Os lugares são atribuídos explicitamente. Para adicionar uma pessoa à conta, use <a href="/acessos">Utilizadores e acessos</a> e depois autorize-a aqui. Por omissão, um participante vê todos os projectos; pode limitá-lo aos projectos escolhidos (por exemplo, um consultor externo ou o banco).</p>
    <form className="form" onSubmit={async e => {
      e.preventDefault();
      if (scope === 'selected' && enabled && !Object.keys(assigned).length) return setError('Escolha pelo menos um projecto ou dê acesso a todos.');
      await run(`/v1/modeling/members/${userId}`, 'PUT', { enabled, permission, scope, projects: scope === 'selected' ? Object.entries(assigned).map(([modelId, p]) => ({ modelId, permission: p })) : [] });
    }}>
      <label>Utilizador<select value={userId} onChange={e => choose(e.target.value)}>{users.filter(u => u.id !== self).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>Permissão geral<select value={permission} onChange={e => changePermission(e.target.value as Permission)}><option value="editor">Edição</option><option value="viewer">Consulta</option></select></label>
      <label>Acesso<select value={String(enabled)} onChange={e => setEnabled(e.target.value === 'true')}><option value="true">Autorizar</option><option value="false">Retirar acesso</option></select></label>
      <label>Projectos<select value={scope} disabled={isOwner} onChange={e => setScope(e.target.value as 'all' | 'selected')}><option value="all">Todos os projectos</option><option value="selected">Só os projectos escolhidos</option></select></label>
      {isOwner && <p className="muted wide" style={{ margin: 0 }}>O proprietário da empresa tem sempre acesso a todos os projectos.</p>}
      {scope === 'selected' && !isOwner && <div className="wide">
        {!projects.length ? <p className="muted">Ainda não há projectos no Integra.</p> : <table className="dense"><thead><tr><th style={{ width: 40 }} /><th>Projecto</th><th>Permissão neste projecto</th></tr></thead><tbody>
          {[...active, ...archived].map(p => <tr key={p.id}>
            <td><input type="checkbox" aria-label={`Atribuir ${p.name}`} checked={p.id in assigned} onChange={e => toggle(p.id, e.target.checked)} /></td>
            <td>{p.name}{p.archivedAt ? <span className="muted"> · arquivado</span> : null}</td>
            <td><select aria-label={`Permissão em ${p.name}`} value={assigned[p.id] ?? (permission === 'viewer' ? 'viewer' : 'editor')} disabled={!(p.id in assigned) || permission === 'viewer'} onChange={e => setAssigned(a => ({ ...a, [p.id]: e.target.value as Permission }))}><option value="editor">Edição</option><option value="viewer">Consulta</option></select></td>
          </tr>)}
        </tbody></table>}
        <p className="muted" style={{ marginTop: 6 }}>Os projectos que esta pessoa criar ficam-lhe atribuídos automaticamente. A permissão num projecto nunca ultrapassa a permissão geral.</p>
      </div>}
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button className="btn" disabled={busy || !userId}>Gravar acesso à Modelagem</button></div>
    </form>
  </div>;
}
