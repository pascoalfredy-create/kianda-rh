import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { monthLabel } from '@/lib/format';
import type { Payslip } from '@/lib/types';
import { PrintButton } from '../print-button';

export const dynamic = 'force-dynamic';

export default async function Recibo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let p: Payslip;
  try {
    p = await api<Payslip>(`/v1/payslips/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const earnings = p.lines.filter((l) => l.kind === 'earning');
  const deductions = p.lines.filter((l) => l.kind === 'deduction');
  const employer = p.lines.filter((l) => l.kind === 'employer');
  const iban = p.employee.iban ? p.employee.iban.replace(/(.{4})/g, '$1 ').trim() : '—';
  return (
    <>
      <div className="no-print page-head">
        <Link href="/recibos" className="crumb">← Recibos</Link>
        <PrintButton />
      </div>
      {p.status === 'draft' && <div className="warn no-print">Pré-visualização: o processamento de {monthLabel(p.period)} ainda está em rascunho. O recibo só é definitivo depois do fecho.</div>}
      <article className="card payslip">
        <header>
          <div>
            <h2>{p.company.name}</h2>
            <div className="muted">NIF {p.company.nif}{p.company.inssNumber ? ` · INSS ${p.company.inssNumber}` : ''}</div>
            {p.company.address && <div className="muted">{p.company.address}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2>Recibo de vencimento</h2>
            <div><b>{monthLabel(p.period)}</b></div>
            <div className="muted">{p.status === 'closed' ? 'Original' : 'RASCUNHO'}</div>
          </div>
        </header>
        <div className="meta">
          <div>Colaborador: <b>{p.employee.name}</b></div>
          <div>N.º mecanográfico: <b>{p.employee.number}</b></div>
          <div>Função: <b>{p.employee.jobTitle}</b></div>
          <div>Departamento: <b>{p.employee.department ?? '—'}</b></div>
          <div>NIF / BI: <b>{p.employee.nif ?? '—'}</b></div>
          <div>N.º INSS: <b>{p.employee.inssNumber ?? '—'}</b></div>
          <div>Banco: <b>{p.employee.bank ?? '—'}</b></div>
          <div>IBAN: <b>{iban}</b></div>
        </div>
        <table>
          <thead><tr><th>Abonos</th><th className="num">Valor</th></tr></thead>
          <tbody>{earnings.map((l, i) => <tr key={i}><td>{l.name}</td><td className="num" style={{ color: l.amountMinor < 0 ? 'var(--red)' : undefined }}>{formatKz(l.amountMinor)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total ilíquido</b></td><td className="num"><b>{formatKz(p.grossMinor)}</b></td></tr></tfoot>
        </table>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Descontos</th><th className="num">Valor</th></tr></thead>
          <tbody>{deductions.map((l, i) => <tr key={i}><td>{l.name}</td><td className="num">{formatKz(l.amountMinor)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total descontos</b></td><td className="num"><b>{formatKz(deductions.reduce((s, l) => s + l.amountMinor, 0))}</b></td></tr></tfoot>
        </table>
        <div className="net"><span>Líquido a receber</span><span>{formatKz(p.netMinor)}</span></div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Encargos da entidade empregadora (não descontados): {employer.map((l) => `${l.name} ${formatKz(l.amountMinor)}`).join(' · ')}
        </div>
        <footer>
          <span>Regras {p.packVersion} · IRT Grupo A, escalão {p.irtBracket}{p.closedAt ? ` · emitido em ${new Date(p.closedAt).toLocaleDateString('pt-PT')}` : ''}</span>
          <span>Código de verificação: <code>{p.hash.slice(0, 16).toUpperCase()}</code></span>
        </footer>
      </article>
    </>
  );
}
