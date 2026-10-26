import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { TemplateEditor } from '../../forms';

export const dynamic = 'force-dynamic';

export default async function Modelo({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const me = (await currentUser())!;
  if (!['owner', 'hr_admin'].includes(me.user.role)) redirect('/documentos');
  const t = await api<{ templates: Parameters<typeof TemplateEditor>[0]['tpl'][]; fields: { key: string; label: string }[] }>('/v1/document-templates');
  const tpl = t.templates.find((x) => x.key === key);
  if (!tpl) notFound();
  const versions = await api<{ id: string; version: number; title: string; createdAt: string; active: boolean; basedOn: string | null }[]>(`/v1/document-templates/${key}/versions`);
  return (
    <>
      <div className="crumb"><Link href="/documentos?v=modelos">Modelos</Link> / {tpl.title}</div>
      <h1>{tpl.title}</h1>
      <p className="sub">{tpl.source === 'empresa' ? `Versão da empresa (${tpl.version})` : `Modelo do Kianda (${tpl.version})`} — a gravação cria uma nova versão; os documentos já emitidos não mudam.</p>
      <TemplateEditor tpl={tpl} fields={t.fields} />
      {versions.length > 0 && (
        <div className="card section">
          <h2>Histórico de versões da empresa</h2>
          <table className="dense"><tbody>{versions.map((v) => <tr key={v.id}><td>v{v.version}</td><td>{v.title}</td><td className="muted">{new Date(v.createdAt).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' })} · a partir de {v.basedOn}</td><td>{v.active ? <span className="st approved">em uso</span> : ''}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
