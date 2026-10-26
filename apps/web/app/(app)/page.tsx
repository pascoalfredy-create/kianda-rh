import { AO_2026, formatKz, payrollDeadlines } from '@kianda/core';
export const dynamic = 'force-dynamic';

export default function Home() {
  const today = new Date();
  const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const year = today.getFullYear();
  const pack = year === AO_2026.year ? AO_2026 : null;
  const deadlines = pack ? payrollDeadlines(period, pack) : null;
  const nextHolidays = pack ? pack.holidays.filter((h) => h.date >= today.toISOString().slice(0, 10)).slice(0, 3) : [];

  return (
    <>
      <h1>Início</h1>
      <p className="sub">Regras em vigor: {pack ? pack.version : `sem pacote publicado para ${year}`}</p>
      {!pack && <div className="alert">Não existe pacote de regras para {year}. Publique a tabela de IRT e os parâmetros desse ano antes de processar salários.</div>}
      {pack && (
        <div className="grid">
          <div className="card kpi"><div className="l">Salário mínimo nacional</div><div className="v">{formatKz(pack.minimumWage.generalMinor)}</div></div>
          <div className="card kpi"><div className="l">Isenção de IRT</div><div className="v">até {formatKz(pack.irt.brackets[0]![0])}</div></div>
          <div className="card kpi"><div className="l">Prazo INSS ({period})</div><div className="v">{deadlines!.inss}</div></div>
          <div className="card kpi"><div className="l">Prazo IRT ({period})</div><div className="v">{deadlines!.irt}</div></div>
        </div>
      )}
      <div className="card">
        <table>
          <thead><tr><th>Próximos feriados nacionais</th><th>Data</th></tr></thead>
          <tbody>{nextHolidays.map((h) => <tr key={h.date}><td>{h.name}</td><td>{h.date}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
