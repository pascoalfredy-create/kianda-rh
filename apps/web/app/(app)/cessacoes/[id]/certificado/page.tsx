import Link from 'next/link';
import { Letterhead } from '@/components/letterhead';
import { api } from '@/lib/api';
import type { TerminationDetail } from '../../types';
import { PrintButton } from '../../print';

export const dynamic = 'force-dynamic';
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const long = (d: string) => `${Number(d.slice(8))} de ${MONTHS[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;

export default async function Certificado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await api<TerminationDetail>(`/v1/terminations/${id}`);
  return (
    <>
      <div className="crumb no-print"><Link href={`/cessacoes/${d.id}`}>← Cessação</Link> <PrintButton /></div>
      <div className="card doc">
        <Letterhead />
        <p><b>{d.company.name}</b><br />NIF {d.company.nif}{d.company.address ? <><br />{d.company.address}</> : null}</p>
        <h2 style={{ textAlign: 'center', margin: '40px 0 30px' }}>Certificado de trabalho</h2>
        <p style={{ lineHeight: 1.9 }}>
          Para os devidos efeitos, certifica-se que <b>{d.employee.name}</b>{d.employee.biNumber ? `, portador(a) do Bilhete de Identidade n.º ${d.employee.biNumber}` : ''}{d.employee.nif ? `, NIF ${d.employee.nif}` : ''}, prestou trabalho nesta empresa de {long(d.hireDate)} a {long(d.effectiveDate)}, tendo exercido por último as funções de <b>{d.employee.jobTitle}</b>.
        </p>
        <p style={{ lineHeight: 1.9 }}>Por ser verdade e a pedido do(a) interessado(a), passa-se o presente certificado, que vai assinado e carimbado.</p>
        <p style={{ marginTop: 30 }}>Luanda, {long(d.effectiveDate)}</p>
        <div style={{ width: 300, marginTop: 70, borderTop: '1px solid #333', paddingTop: 6, textAlign: 'center' }}>A Direcção / Recursos Humanos</div>
      </div>
    </>
  );
}
