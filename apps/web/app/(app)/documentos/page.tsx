import { DOCUMENT_CATEGORY, type DocumentCategory } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { IssueForm } from './forms';

export const dynamic = 'force-dynamic';

interface Tpl { key: string; title: string; category: DocumentCategory; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[]; source: string; version: string; body: string }
interface Doc { id: string; number: string; title: string; employeeName: string; employeeNumber: string; issuedAt: string; revokedAt: string | null; templateVersion: string }

export default async function Documentos({ searchParams }: { searchParams: Promise<{ v?: string; colaborador?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const staff = hr || ['payroll', 'finance'].includes(me.user.role);
  const view = hr ? (sp.v ?? (sp.colaborador ? 'emitir' : 'emitidos')) : 'emitidos';
  const docs = view === 'emitidos' ? await api<Doc[]>('/v1/documents') : [];
  const t = hr && view !== 'emitidos' ? await api<{ templates: Tpl[] }>('/v1/document-templates') : null;
  const employees = view === 'emitir' ? (await api<{ id: string; name: string; number: string }[]>('/v1/employees')) : [];
  return (
    <>
      <h1>Documentos</h1>
      <p className="sub">{hr ? 'Contratos, declarações, certificados e comunicações a partir de modelos versionados — com número e código de verificação' : 'Declarações, contratos e comunicações emitidos em seu nome'}</p>
      {hr && (
        <nav className="tabs">
          {[['emitidos', 'Emitidos'], ['emitir', 'Emitir documento'], ['modelos', 'Modelos']].map(([k, l]) => <Link key={k} href={`?v=${k}`} className={view === k ? 'on' : ''}>{l}</Link>)}
        </nav>
      )}
      {view === 'emitidos' && (
        <div className="card">
          <table>
            <thead><tr><th>N.º</th><th>Documento</th>{staff && <th>Colaborador</th>}<th>Emitido em</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/documentos/${d.id}`}><b>{d.number}</b></Link></td><td>{d.title}</td>
                  {staff && <td>{d.employeeNumber} · {d.employeeName}</td>}
                  <td>{new Date(d.issuedAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}</td>
                  <td>{d.revokedAt ? <span className="st rejected">Anulado</span> : <span className="tag">{d.templateVersion}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.length && <div className="empty">Ainda não há documentos emitidos.{hr ? ' Use "Emitir documento".' : ''}</div>}
        </div>
      )}
      {view === 'emitir' && t && <IssueForm templates={t.templates} employees={employees} initialEmployee={sp.colaborador} />}
      {view === 'modelos' && t && (
        <div className="card">
          <table>
            <thead><tr><th>Modelo</th><th>Tipo</th><th>Versão</th><th /></tr></thead>
            <tbody>
              {t.templates.map((x) => (
                <tr key={x.key}>
                  <td><b>{x.title}</b><div className="muted">{x.description}</div></td>
                  <td>{DOCUMENT_CATEGORY[x.category]}</td>
                  <td>{x.source === 'empresa' ? <span className="tag future">{x.version}</span> : <span className="tag">Kianda {x.version}</span>}</td>
                  <td className="num"><Link className="btn ghost sm" href={`/documentos/modelos/${x.key}`}>Adaptar</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ padding: '10px 16px' }}>Os modelos do Kianda acompanham o pacote de regras do ano e estão assinalados para revisão jurídica. Ao adaptar um modelo, cada gravação cria uma versão nova; os documentos já emitidos não mudam.</p>
        </div>
      )}
    </>
  );
}
