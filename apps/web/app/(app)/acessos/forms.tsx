'use client';

import { useState } from 'react';
import { send, useMutation } from '@/lib/client';

interface Link { path: string; expiresAt: string; emailed?: boolean }

/** Painel de partilha: copiar, WhatsApp, SMS, email. */
function SharePanel({ link, name, phone, email, kind, company }: { link: Link; name: string; phone?: string | null; email?: string | null; kind: 'invite' | 'reset'; company: string }) {
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}${link.path}`;
  const text = kind === 'invite'
    ? `Olá ${name.split(' ')[0]}, foi convidado(a) para a plataforma de RH da ${company} (Kianda RH). Abra esta ligação para criar o seu acesso: ${url}`
    : `Olá ${name.split(' ')[0]}, use esta ligação para recuperar o seu acesso ao Kianda RH da ${company}: ${url}`;
  const digits = (phone ?? '').replace(/\D/g, '');
  const intl = digits.length === 9 ? `244${digits}` : digits;
  const [copied, setCopied] = useState(false);
  return (
    <div className="warn" style={{ margin: '8px 0', display: 'grid', gap: 8 }}>
      {link.emailed && <div style={{ fontWeight: 600, color: 'var(--brand)' }}>✓ Enviada por email para {email}. Também pode partilhar por outro meio:</div>}
      <div style={{ wordBreak: 'break-all', fontSize: 12.5 }}>{url}</div>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn sm" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>{copied ? 'Copiado ✓' : 'Copiar mensagem'}</button>
        <a className="btn ghost sm" target="_blank" rel="noreferrer" href={`https://wa.me/${intl}?text=${encodeURIComponent(text)}`}>WhatsApp</a>
        {intl && <a className="btn ghost sm" href={`sms:+${intl}?body=${encodeURIComponent(text)}`}>SMS</a>}
        {email && <a className="btn ghost sm" href={`mailto:${email}?subject=${encodeURIComponent('Acesso ao Kianda RH')}&body=${encodeURIComponent(text)}`}>Email</a>}
      </div>
      <span className="muted" style={{ fontSize: 12 }}>Válida até {new Date(link.expiresAt).toLocaleDateString('pt-PT')} e só funciona uma vez. Uma nova ligação anula a anterior.</span>
    </div>
  );
}

export function InviteEmployee({ employeeId, name, phone, email, company, mode, userId }: { employeeId?: string; userId?: string; name: string; phone?: string | null; email?: string | null; company: string; mode: 'invite' | 'reset' }) {
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (link) return <SharePanel link={link} name={name} phone={phone} email={email} kind={mode} company={company} />;
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className={mode === 'invite' ? 'btn sm' : 'btn ghost sm'} disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        const r = mode === 'invite' ? await send<Link>('/v1/access/invites', 'POST', { employeeId }) : await send<Link>(`/v1/users/${userId}/recovery`, 'POST', {});
        setBusy(false);
        if (!r.ok) return setError(r.message ?? 'Erro');
        setLink(r.data!);
      }}>{mode === 'invite' ? 'Convidar' : 'Recuperar acesso'}</button>
      {error && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}

export function UserControls({ id, role, disabled, roles, canChangeRole }: { id: string; role: string; disabled: boolean; roles: Record<string, string>; canChangeRole: boolean }) {
  const { busy, error, run } = useMutation();
  return (
    <span className="actions" style={{ justifyContent: 'flex-start' }}>
      {canChangeRole && (
        <select value={role} disabled={busy} onChange={(e) => run(`/v1/users/${id}`, 'PATCH', { role: e.target.value })} style={{ height: 30 }}>
          {Object.entries(roles).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      <button className={disabled ? 'btn sm' : 'btn danger'} disabled={busy} onClick={() => run(`/v1/users/${id}`, 'PATCH', { disabled: !disabled })}>{disabled ? 'Reactivar' : 'Desactivar'}</button>
      {error && <span style={{ color: 'var(--red)', fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}

export function InviteStaff({ roles, company, isOwner }: { roles: Record<string, string>; company: string; isOwner: boolean }) {
  const [link, setLink] = useState<{ link: Link; name: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  if (link) return <SharePanel link={link.link} name={link.name} email={link.email} kind="invite" company={company} />;
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Convidar utilizador sem ficha</button>;
  return (
    <form className="card form" style={{ marginBottom: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await send<Link>('/v1/access/invites', 'POST', { name: f.get('name'), email: f.get('email'), role: f.get('role') });
      if (!r.ok) return setError(r.message ?? 'Erro');
      setLink({ link: r.data!, name: String(f.get('name')), email: String(f.get('email')) });
    }}>
      <label>Nome<input name="name" required /></label>
      <label>Email<input name="email" type="email" required /></label>
      <label>Perfil<select name="role" defaultValue="finance">{Object.entries(roles).filter(([k]) => k !== 'employee' && (isOwner || k !== 'hr_admin')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <p className="muted wide">Para contabilistas externos, consultores ou membros da direcção sem ficha de colaborador. Entram sempre com email e palavra-passe.</p>
      <div className="form-actions wide">{error && <span className="err">{error}</span>}<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button><button className="btn">Gerar convite</button></div>
    </form>
  );
}
