import { DOCUMENT_CATEGORY, type DocumentCategory } from '@kianda/core';
import Link from 'next/link';
import { api, currentUser } from '@/lib/api';
import { RhIcon } from '@/components/rh-icon';
import { IssueForm } from './forms';

export const dynamic = 'force-dynamic';

interface Tpl { key: string; title: string; category: DocumentCategory; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[]; source: string; version: string; body: string }
interface Doc { id: string; number: string; title: string; employeeName: string; employeeNumber: string; issuedAt: string; revokedAt: string | null; templateVersion: string }

export default async function Documentos({ searchParams }: { searchParams: Promise<{ v?: string; colaborador?: string; modelo?: string }> }) {
  const sp = await searchParams;
  const me = (await currentUser())!;
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const staff = hr || ['payroll', 'finance'].includes(me.user.role);
  const view = staff ? (sp.v ?? (sp.colaborador ? 'emitir' : 'gerar')) : 'emitidos';
  const docs = view === 'emitidos' ? await api<Doc[]>('/v1/documents') : [];
  const t = hr && view !== 'emitidos' ? await api<{ templates: Tpl[] }>('/v1/document-templates') : null;
  const employees = view === 'emitir' ? (await api<{ id: string; name: string; number: string }[]>('/v1/employees')) : [];
  return (
    <>
      <h1>Documentos</h1>
      <p className="sub">{hr ? 'Contratos, declarações, certificados e comunicações a partir de modelos versionados — com número e código de verificação' : 'Declarações, contratos e comunicações emitidos em seu nome'}</p>
      {staff && (
        <nav className="tabs">
          {[['gerar', 'Gerar documento'], ['emitidos', 'Arquivo'], ...(hr ? [['modelos', 'Modelos']] : [])].map(([k, l]) => <Link key={k} href={`?v=${k}`} className={view === k || view === 'emitir' && k === 'gerar' ? 'on' : ''}>{l}</Link>)}
        </nav>
      )}
      {view === 'gerar' && <>
        {hr && t && <><h2 className="gallery-group">Recursos Humanos · {t.templates.length} modelos</h2><div className="document-gallery">{t.templates.map(x => <Link key={x.key} href={`?${new URLSearchParams({ v: 'emitir', modelo: x.key, ...(sp.colaborador ? { colaborador: sp.colaborador } : {}) })}`} className="document-tile"><span className="document-tile-icon"><RhIcon name="doc" size={21} /></span><div><b>{x.title}</b><small>{x.description}</small></div></Link>)}</div></>}
        <h2 className="gallery-group">Finanças</h2><div className="document-gallery">{[['/obrigacoes', 'Mapas AGT & INSS', 'Retenções e contribuições por período'], ['/processamento', 'Folha de remunerações', 'Processamento salarial e recibos'], ['/financas?s=diario', 'Documento de lançamento', 'Diário de pessoal e exportação para o ERP'], ['/conciliacao', 'Conciliação bancária', 'Extractos e pagamentos de pessoal']].filter(([href]) => href !== '/financas?s=diario' && href !== '/conciliacao' || ['owner', 'finance', 'payroll'].includes(me.user.role)).map(([href, title, description]) => <Link href={href!} key={href} className="document-tile"><span className="document-tile-icon"><RhIcon name="doc" size={21} /></span><div><b>{title}</b><small>{description}</small></div></Link>)}</div>
        <div className="card rh-card-body" style={{ marginTop: 14 }}><p className="muted">Os documentos emitidos ficam no Arquivo. Os anexos e documentos de identificação conservam-se na ficha de cada colaborador.</p><Link href="/colaboradores" className="btn ghost sm" style={{ marginTop: 10 }}>Abrir processos individuais</Link></div>
      </>}
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
      {view === 'emitir' && t && <IssueForm templates={t.templates} employees={employees} initialEmployee={sp.colaborador} initialTemplate={sp.modelo} />}
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
