import { DocumentPrintButton, ExportLink } from '@/components/document-export';
import type { EffectivenessCode } from '@kianda/core';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api, currentUser } from '@/lib/api';
import { currentPeriod, monthLabel, shiftMonth } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Totals {
  worked: number;
  unjustified: number;
  justified: number;
  vacation: number;
  sick: number;
  leave: number;
  noRecord: number;
}
interface EffectivenessMap {
  period: string;
  periodLabel: string;
  companyName: string;
  provisional: boolean;
  clockInUse: boolean;
  days: { date: string; weekday: string; weekend: boolean; holiday: string | null }[];
  legend: [Exclude<EffectivenessCode, ''>, string][];
  rows: {
    employee: { id: string; name: string; number: string; department: string | null };
    codes: EffectivenessCode[];
    totals: Totals;
    overtimeMinutes: number;
    approved: boolean;
  }[];
}

/** As mesmas cores do PDF, para o ecrã, a impressão e o arquivo dizerem o mesmo. */
const TONE: Partial<Record<EffectivenessCode, [string, string]>> = {
  FI: ['#fbe3e3', '#9b1c1c'],
  FJ: ['#e3eefb', '#1d4e89'],
  Fé: ['#e3f4e8', '#1f6b3a'],
  D: ['#efe6fb', '#5b2a86'],
  L: ['#f1efe8', '#5c5446'],
  Fr: ['#fbf1dc', '#8a5a00'],
  '·': ['#f3f4f6', '#8a92a1'],
  SR: ['#fff4d6', '#8a5a00'],
};
const TOTALS: [keyof Totals | 'HE', string, string][] = [
  ['worked', 'DT', 'Dias trabalhados'],
  ['unjustified', 'FI', 'Faltas injustificadas'],
  ['justified', 'FJ', 'Faltas justificadas'],
  ['vacation', 'Fé', 'Dias de férias'],
  ['sick', 'D', 'Dias de doença'],
  ['leave', 'L', 'Dias de licença'],
  ['noRecord', 'SR', 'Dias sem registo'],
  ['HE', 'HE', 'Horas extra'],
];
const hours = (min: number) => (min ? (min / 60).toFixed(1).replace('.', ',').replace(/,0$/, '') : '0');

export default async function MapaEfectividade({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; dep?: string }>;
}) {
  const me = (await currentUser())!;
  if (me.user.role === 'employee') redirect('/');
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes! : currentPeriod();
  const qs = new URLSearchParams({ period });
  if (sp.dep) qs.set('departmentId', sp.dep);
  const [map, departments] = await Promise.all([
    api<EffectivenessMap>(`/v1/attendance/effectiveness?${qs}`),
    api<{ id: string; name: string }[]>('/v1/departments').catch(() => []),
  ]);
  const href = (p: string) => `?mes=${p}${sp.dep ? `&dep=${encodeURIComponent(sp.dep)}` : ''}`;
  const file = (format: 'xlsx' | 'pdf') => `/api/v1/attendance/effectiveness?${qs}&format=${format}`;
  const off = (d: EffectivenessMap['days'][number]) => d.weekend || !!d.holiday;
  const pending = map.rows.filter(r => !r.approved).length;

  return (
    <div className="effect-page">
      <div className="crumb no-print">
        <Link href="/relatorios">Relatórios</Link> / Mapa de efectividade
      </div>
      <div className="page-head">
        <div>
          <h1>Mapa de efectividade</h1>
          <p className="sub">Presenças e ausências de cada colaborador, dia a dia. Uma linha por pessoa.</p>
        </div>
        <form className="actions no-print" style={{ alignItems: 'center' }}>
          <input type="hidden" name="mes" value={period} />
          <div className="month-nav">
            <Link className="btn ghost sm" href={href(shiftMonth(period, -1))} aria-label="Mês anterior">
              ←
            </Link>
            <b>{monthLabel(period)}</b>
            <Link className="btn ghost sm" href={href(shiftMonth(period, 1))} aria-label="Mês seguinte">
              →
            </Link>
          </div>
          {departments.length > 0 && (
            <>
              <select name="dep" defaultValue={sp.dep ?? ''} aria-label="Departamento">
                <option value="">Todos os departamentos</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button className="btn ghost sm">Ver</button>
            </>
          )}
          <ExportLink className="btn sm" href={file('xlsx')}>
            Excel
          </ExportLink>
          <ExportLink className="btn sm" href={file('pdf')}>
            PDF
          </ExportLink>
          <DocumentPrintButton className="btn ghost sm">Imprimir (A4)</DocumentPrintButton>
        </form>
      </div>

      <div className="print-only effect-print-head">
        <b>{map.companyName}</b>
        <span>
          Mapa de efectividade · {map.periodLabel} · {map.provisional ? 'PROVISÓRIO' : 'MÊS FECHADO'}
        </span>
      </div>

      {map.provisional && (
        <div className="warn">
          <b>Provisório.</b>{' '}
          {period >= currentPeriod()
            ? 'O mês ainda está a decorrer: os dias por vir ficam em branco e os códigos podem mudar.'
            : `${pending} ${pending === 1 ? 'folha de ponto por aprovar' : 'folhas de ponto por aprovar'} neste mês.`}{' '}
          Para arquivo, use o mapa depois de aprovar as folhas em{' '}
          <Link href={`/assiduidade?s=equipa&mes=${period}`}>Assiduidade</Link>.
        </div>
      )}

      {map.rows.length === 0 ? (
        <div className="card empty">Ninguém com contrato activo em {monthLabel(period)}.</div>
      ) : (
        <div className="card effect-wrap">
          <table className="effect">
            <colgroup>
              <col className="name-col" />
              {map.days.map(d => (
                <col key={d.date} />
              ))}
              {TOTALS.map(([k]) => (
                <col key={k} className="tot-col" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="name">Colaborador</th>
                {map.days.map(d => (
                  <th key={d.date} className={off(d) ? 'off' : undefined} title={d.holiday ?? undefined}>
                    <span>{Number(d.date.slice(8))}</span>
                    <small>{d.weekday.slice(0, 1)}</small>
                  </th>
                ))}
                {TOTALS.map(([k, short, long]) => (
                  <th key={k} className="tot" title={long}>
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.rows.map(r => (
                <tr key={r.employee.id}>
                  <td className="name">
                    <Link href={`/assiduidade/${r.employee.id}?mes=${period}`}>{r.employee.name}</Link>
                    <small>
                      {r.employee.number}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                      {!r.approved && <span className="no-print"> · por aprovar</span>}
                    </small>
                  </td>
                  {r.codes.map((c, i) => {
                    const tone = TONE[c];
                    return (
                      <td
                        key={map.days[i]!.date}
                        style={tone ? { background: tone[0], color: tone[1] } : undefined}
                        className={off(map.days[i]!) && !tone ? 'off' : undefined}
                      >
                        {c}
                      </td>
                    );
                  })}
                  {TOTALS.map(([k]) => (
                    <td key={k} className="tot">
                      {k === 'HE' ? hours(r.overtimeMinutes) : r.totals[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="effect-legend">
        {map.legend.map(([code, label]) => (
          <span key={code}>
            <i style={TONE[code] ? { background: TONE[code][0], color: TONE[code][1] } : undefined}>{code}</i>
            {label}
          </span>
        ))}
        <span>
          <i>DT</i>Dias trabalhados
        </span>
        <span>
          <i>HE</i>Horas extra
        </span>
      </div>

      <div className="print-only effect-sign">
        <div>Elaborado por</div>
        <div>Visto do responsável</div>
        <div>Data</div>
      </div>
    </div>
  );
}
