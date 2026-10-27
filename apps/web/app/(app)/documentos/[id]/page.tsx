import Link from 'next/link';
import { headers } from 'next/headers';
import { DocView } from '@/components/doc-view';
import { Letterhead } from '@/components/letterhead';
import { api, currentUser } from '@/lib/api';
import { PrintBtn, RevokeButton } from '../forms';

export const dynamic = 'force-dynamic';

interface Doc { id: string; number: string; title: string; body: string; employeeId: string; employeeName: string; issuedAt: string; templateVersion: string; verificationCode: string; revokedAt: string | null; revokeNote: string | null }

export default async function Documento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  const d = await api<Doc>(`/v1/documents/${id}`);
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'kianda.yelaperformance.com';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  const verifyUrl = `${proto}://${host}/verificar/${d.verificationCode}`;
  return (
    <>
      <div className="crumb no-print"><Link href="/documentos">Documentos</Link> / {d.number}</div>
      <div className="actions no-print" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
        <PrintBtn />
        {['owner', 'hr_admin'].includes(me.user.role) && !d.revokedAt && <RevokeButton id={d.id} />}
      </div>
      {d.revokedAt && <div className="alert">Documento anulado em {new Date(d.revokedAt).toLocaleDateString('pt-PT')}: {d.revokeNote}</div>}
      <div className="card doc">
        <Letterhead />
        <DocView text={d.body} />
        <div style={{ marginTop: 40, paddingTop: 10, borderTop: '1px solid #e5e7eb', fontSize: 11.5, color: '#6b7280', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{d.number} · emitido em {new Date(d.issuedAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })} · modelo {d.templateVersion}</span>
          <span>Verificar: {verifyUrl}</span>
        </div>
      </div>
    </>
  );
}
