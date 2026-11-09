import Link from 'next/link';
import { headers } from 'next/headers';
import { DocView } from '@/components/doc-view';
import { PrintSheet } from '@/components/print-sheet';
import { api, currentUser } from '@/lib/api';
import { PrintBtn, RequestSignatureButton, RevokeButton, SignForm } from '../forms';

export const dynamic = 'force-dynamic';

interface Doc { id: string; number: string; title: string; body: string; employeeId: string; employeeName: string; issuedAt: string; templateVersion: string; verificationCode: string; revokedAt: string | null; revokeNote: string | null; signatureRequestedAt: string | null; signedAt: string | null; signedName: string | null; signedIp: string | null; signedHash: string | null }

const when = (iso: string) => new Date(iso).toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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
        {['owner', 'hr_admin'].includes(me.user.role) && !d.revokedAt && !d.signedAt && !d.signatureRequestedAt && <RequestSignatureButton id={d.id} />}
        {['owner', 'hr_admin'].includes(me.user.role) && !d.revokedAt && <RevokeButton id={d.id} />}
      </div>
      {d.signatureRequestedAt && !d.signedAt && !d.revokedAt && (me.user.employeeId === d.employeeId
        ? <SignForm id={d.id} employeeName={d.employeeName} />
        : <div className="warn no-print">Assinatura pedida ao colaborador em {when(d.signatureRequestedAt)} — aguarda assinatura no portal.</div>)}
      {d.signedAt && <div className="ok no-print" role="status">Assinado electronicamente por {d.signedName} em {when(d.signedAt)}.</div>}
      {d.revokedAt && <div className="alert">Documento anulado em {new Date(d.revokedAt).toLocaleDateString('pt-PT')}: {d.revokeNote}</div>}
      <PrintSheet footer={<><span>{d.number} · emitido em {new Date(d.issuedAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}</span>
          <span>Verificar: {verifyUrl}</span></>}>
        <DocView text={d.body} signature={d.signedAt ? { name: d.signedName ?? d.employeeName, at: when(d.signedAt), hash: (d.signedHash ?? '').slice(0, 12).toUpperCase() } : undefined} />
      </PrintSheet>
    </>
  );
}
