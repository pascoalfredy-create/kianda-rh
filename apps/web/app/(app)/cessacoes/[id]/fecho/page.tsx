import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { TerminationDetail } from '../../types';
import { PrintButton } from '../../print';

export const dynamic = 'force-dynamic';
const pt = (d: string) => d.split('-').reverse().join('/');

export default async function Fecho({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await api<TerminationDetail>(`/v1/terminations/${id}`);
  const p = d.payslip;
  return (
    <>
      <div className="crumb no-print"><Link href={`/cessacoes/${d.id}`}>← Cessação</Link> <PrintButton /></div>
      <div className="card doc">
        <h2 style={{ textAlign: 'center' }}>Fecho de contas</h2>
        <p><b>{d.company.name}</b> · NIF {d.company.nif}{d.company.address ? ` · ${d.company.address}` : ''}</p>
        <p>Trabalhador: <b>{d.employee.name}</b> (n.º {d.employee.number}){d.employee.biNumber ? `, BI ${d.employee.biNumber}` : ''}, {d.employee.jobTitle}.</p>
        <p>Admissão em {pt(d.hireDate)}; cessação em {pt(d.effectiveDate)} — {d.reasonLabel.toLowerCase()}. Antiguidade: {d.proposal.seniority.label}.</p>
        <table className="dense">
          <thead><tr><th>Rubrica</th><th className="num">Abonos</th><th className="num">Descontos</th></tr></thead>
          <tbody>
            {(p?.lines ?? []).filter((l) => l.kind !== 'employer').map((l, i) => <tr key={i}><td>{l.name}</td><td className="num">{l.kind === 'earning' ? formatKz(l.amountMinor) : ''}</td><td className="num">{l.kind === 'deduction' ? formatKz(l.amountMinor) : ''}</td></tr>)}
          </tbody>
          {p && <tfoot><tr><td><b>Líquido</b></td><td colSpan={2} className="num"><b>{formatKz(p.netMinor)}</b></td></tr></tfoot>}
        </table>
        <p className="muted">Valores do recibo de vencimento de {d.period.slice(5)}/{d.period.slice(0, 4)} (estimativa até ao fecho do processamento do mês).</p>
        <p style={{ marginTop: 24 }}>Declaro que recebi a quantia acima indicada, nada mais tendo a receber da entidade empregadora a título de créditos emergentes do contrato de trabalho e da sua cessação, sem prejuízo dos direitos que a lei considere irrenunciáveis.</p>
        <p>Luanda, ____ de ______________ de {d.effectiveDate.slice(0, 4)}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 50 }}>
          <div style={{ borderTop: '1px solid #333', paddingTop: 6, textAlign: 'center' }}>O trabalhador</div>
          <div style={{ borderTop: '1px solid #333', paddingTop: 6, textAlign: 'center' }}>Pela entidade empregadora</div>
        </div>
      </div>
    </>
  );
}
