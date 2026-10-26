import { formatKz } from '@kianda/core';
import Link from 'next/link';
import { api } from '@/lib/api';
import { monthLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Recibos() {
  const list = await api<{ id: string; period: string; netMinor: number; grossMinor: number; closedAt: string }[]>('/v1/payslips');
  return (
    <>
      <h1>Os meus recibos</h1>
      <p className="sub">Recibos de vencimento dos processamentos fechados. Pode imprimir ou guardar em PDF.</p>
      <div className="card">
        <table>
          <thead><tr><th>Mês</th><th className="num">Ilíquido</th><th className="num">Líquido</th><th>Emitido</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><b>{monthLabel(p.period)}</b></td>
                <td className="num">{formatKz(p.grossMinor)}</td>
                <td className="num"><b style={{ color: 'var(--brand)' }}>{formatKz(p.netMinor)}</b></td>
                <td className="muted">{new Date(p.closedAt).toLocaleDateString('pt-PT')}</td>
                <td className="num"><Link href={`/recibos/${p.id}`} className="btn ghost sm">Ver recibo</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">Ainda não há recibos disponíveis</div>}
      </div>
    </>
  );
}
