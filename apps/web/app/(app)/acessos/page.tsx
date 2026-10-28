import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { InviteEmployee, InviteStaff, UserControls } from './forms';

export const dynamic = 'force-dynamic';

interface U { id: string; name: string; email: string | null; phone: string | null; role: string; roleLabel: string; hasPassword: boolean; hasPin: boolean; twoFactor: boolean; disabled: boolean; locked: boolean; lastLoginAt: string | null; self: boolean }
interface Data {
  employees: { id: string; name: string; number: string; email: string | null; phone: string | null; status: string; jobTitle: string; user: U | null; pendingLink: { kind: string; expiresAt: string } | null }[];
  staff: (U & { pendingLink: unknown })[]; staffInvites: { id: string; name: string; email: string; roleLabel: string; expiresAt: string }[]; roles: Record<string, string>;
}
const dt = (d: string) => new Date(d).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' });

function Status({ u, pending }: { u: U | null; pending: { expiresAt: string } | null }) {
  if (!u) return pending ? <span className="st pending">Convite enviado (até {dt(pending.expiresAt)})</span> : <span className="tag">Sem acesso</span>;
  if (u.disabled) return <span className="st rejected">Desactivado</span>;
  if (u.locked) return <span className="st rejected">Bloqueado (tentativas)</span>;
  return (
    <span>
      <span className="st approved">Activo</span>{' '}
      <span className="muted" style={{ fontSize: 12 }}>{[u.hasPassword && 'email', u.hasPin && 'PIN', u.twoFactor && '2 passos'].filter(Boolean).join(' · ')}{u.lastLoginAt ? ` · última entrada ${dt(u.lastLoginAt)}` : ' · ainda não entrou'}</span>
    </span>
  );
}

export default async function Acessos() {
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin'].includes(me.user.role)) redirect('/');
  const d = await api<Data>('/v1/access');
  const company = me.company?.name ?? '';
  const isOwner = me.user.role === 'owner';
  const canManage = (role: string) => isOwner || (role !== 'owner' && role !== 'hr_admin');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Utilizadores e acessos</h1>
          <p className="sub">{me.modules.hr.canAccess ? <>Convide cada colaborador por ligação (WhatsApp, SMS ou email). Quem não tem email entra com o código da empresa <b>{me.company?.code}</b> + n.º ou telefone + PIN.</> : <>Convide utilizadores para a conta da empresa. O proprietário atribui depois os lugares de Modelagem em <a href="/licenca#modeling">Módulos e licenças</a>.</>}</p>
        </div>
        <InviteStaff roles={d.roles} company={company} isOwner={isOwner} />
      </div>
      {me.modules.hr.canAccess && <div className="card" style={{ overflowX: 'auto' }}>
        <table className="dense">
          <thead><tr><th>Colaborador</th><th>Contacto</th><th>Acesso</th><th>Perfil</th><th /></tr></thead>
          <tbody>
            {d.employees.filter((e) => e.status !== 'terminated' || e.user).map((e) => (
              <tr key={e.id} style={{ verticalAlign: 'top' }}>
                <td><b>{e.number} · {e.name}</b><div className="muted">{e.jobTitle}</div></td>
                <td className="muted" style={{ fontSize: 12.5 }}>{e.email ?? '—'}<br />{e.phone ?? '—'}</td>
                <td><Status u={e.user} pending={e.pendingLink} /></td>
                <td>{e.user ? (e.user.self ? e.user.roleLabel : <UserControls id={e.user.id} role={e.user.role} disabled={e.user.disabled} roles={Object.fromEntries(Object.entries(d.roles).filter(([k]) => isOwner || k !== 'hr_admin'))} canChangeRole={canManage(e.user.role) && e.user.role !== 'owner'} />) : <span className="muted">—</span>}</td>
                <td>
                  {e.status === 'terminated' ? <span className="muted">Cessado</span>
                    : !e.user ? <InviteEmployee mode="invite" employeeId={e.id} name={e.name} phone={e.phone} email={e.email} company={company} />
                      : !e.user.self && canManage(e.user.role) ? <InviteEmployee mode="reset" userId={e.user.id} name={e.name} phone={e.user.phone ?? e.phone} email={e.user.email ?? e.email} company={company} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {(d.staff.length > 0 || d.staffInvites.length > 0) && (
        <div className="card section" style={{ marginTop: 16 }}>
          <h2>Utilizadores sem ficha de colaborador</h2>
          <table className="dense">
            <tbody>
              {d.staff.map((u) => (
                <tr key={u.id} style={{ verticalAlign: 'top' }}>
                  <td><b>{u.name}</b>{u.self && <span className="tag" style={{ marginLeft: 6 }}>eu</span>}<div className="muted">{u.email}</div></td>
                  <td><Status u={u} pending={null} /></td>
                  <td>{u.self || u.role === 'owner' ? u.roleLabel : <UserControls id={u.id} role={u.role} disabled={u.disabled} roles={Object.fromEntries(Object.entries(d.roles).filter(([k]) => k !== 'employee' && (isOwner || k !== 'hr_admin')))} canChangeRole={canManage(u.role)} />}</td>
                  <td>{!u.self && canManage(u.role) && <InviteEmployee mode="reset" userId={u.id} name={u.name} email={u.email} company={company} />}</td>
                </tr>
              ))}
              {d.staffInvites.map((i) => <tr key={i.id}><td><b>{i.name}</b><div className="muted">{i.email}</div></td><td><span className="st pending">Convite enviado (até {dt(i.expiresAt)})</span></td><td>{i.roleLabel}</td><td /></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
