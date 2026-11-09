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
  const logo = (await api<{ logo: string | null } | null>('/v1/company/branding').catch(() => null))?.logo ?? null;
  // Só o que foi processado no mês: rubricas a zero não aparecem no recibo.
  const processed = p.lines.filter((l) => l.amountMinor !== 0);
  const earnings = processed.filter((l) => l.kind === 'earning');
  const deductions = processed.filter((l) => l.kind === 'deduction');
  const employer = processed.filter((l) => l.kind === 'employer');
  const d = (iso: string) => iso.split('-').reverse().join('/');
  const occurrences = [
    ...(p.leave ?? []).map((a) => `${a.label}: ${a.workingDays} dia(s) útil(eis), de ${d(a.startDate)} a ${d(a.endDate)}`),
    ...(p.absenceDays ? [`Faltas injustificadas: ${p.absenceDays} dia(s)`] : []),
    ...(p.overtimeHours ? [`Horas extraordinárias: ${String(p.overtimeHours).replace('.', ',')} h`] : []),
  ];
  const iban = p.employee.iban ? p.employee.iban.replace(/(.{4})/g, '$1 ').trim() : '—';
  const slip = (copy: 'Original' | 'Duplicado') => (
      <article className="card payslip" key={copy}>
        <header>
          <div>
            {logo && <img src={logo} alt="" style={{ maxHeight: 52, maxWidth: 160, objectFit: 'contain', marginBottom: 6, display: 'block' }} />}
            <h2>{p.company.name}</h2>
            <div className="muted">NIF {p.company.nif}{p.company.inssNumber ? ` · INSS ${p.company.inssNumber}` : ''}</div>
            {p.company.address && <div className="muted">{p.company.address}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2>Recibo de vencimento</h2>
            <div><b>{monthLabel(p.period)}</b></div>
            <div className="muted">{p.status === 'closed' ? copy : 'RASCUNHO'}</div>
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
        {p.termination && <div className="payslip-box" aria-label="Fecho de contas">
          <b>Fecho de contas</b> — {p.termination.reasonLabel}.
          {p.termination.hireDate && <> Admissão em {d(p.termination.hireDate)};</>} cessação em {d(p.termination.effectiveDate)}{p.termination.noticeDate ? `; aviso em ${d(p.termination.noticeDate)}` : ''}{p.termination.seniority ? `; antiguidade ${p.termination.seniority}` : ''}. As rubricas do fecho estão discriminadas abaixo, com a base de cálculo.
        </div>}
        {occurrences.length > 0 && <div className="payslip-box" aria-label="Ocorrências do mês"><b>Ocorrências do mês</b><ul>{occurrences.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
        <div className="payslip-tables">
        <table>
          <thead><tr><th>Abonos</th><th className="num">Valor</th></tr></thead>
          <tbody>{earnings.map((l, i) => <tr key={i}><td>{l.name}</td><td className="num" style={{ color: l.amountMinor < 0 ? 'var(--red)' : undefined }}>{formatKz(l.amountMinor)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total ilíquido</b></td><td className="num"><b>{formatKz(p.grossMinor)}</b></td></tr></tfoot>
        </table>
        <table aria-label="Descontos do trabalhador" style={{ marginTop: 10 }}>
          <thead><tr><th>Descontos</th><th className="num">Valor</th></tr></thead>
          <tbody>{deductions.map((l, i) => <tr key={i}><td>{l.name}</td><td className="num">{formatKz(l.amountMinor)}</td></tr>)}</tbody>
          <tfoot><tr><td><b>Total descontos</b></td><td className="num"><b>{formatKz(deductions.reduce((s, l) => s + l.amountMinor, 0))}</b></td></tr></tfoot>
        </table>
        </div>
        <div className="net"><span>Líquido a receber</span><span>{formatKz(p.netMinor)}</span></div>
        {employer.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Encargos da entidade empregadora (não descontados): {employer.map((l) => `${l.name} ${formatKz(l.amountMinor)}`).join(' · ')}
        </div>}
        <footer>
          <span>IRT Grupo A, escalão {p.irtBracket}{p.closedAt ? ` · emitido em ${new Date(p.closedAt).toLocaleDateString('pt-PT')}` : ''}</span>
          <span>Código de verificação: <code>{p.hash.slice(0, 16).toUpperCase()}</code></span>
        </footer>
      </article>
  );
  return (
    <>
      <div className="no-print page-head">
        <Link href="/recibos" className="crumb">← Recibos</Link>
        <PrintButton />
      </div>
      {p.status === 'draft' && <div className="warn no-print">Pré-visualização: o processamento de {monthLabel(p.period)} ainda está em rascunho. O recibo só é definitivo depois do fecho.</div>}
      {slip('Original')}
      {/* Duas vias: o duplicado só sai na impressão, em página própria. */}
      <div className="payslip-copy">{slip('Duplicado')}</div>
    </>
  );
}
