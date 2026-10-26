import { DAY_FLAG_LABEL, formatMinutes, type DayFlag } from '@kianda/core';
import type { Sheet } from '@/lib/types';
import { AddEntry, ApproveMonth, EntryChip, ReopenMonth } from './actions';

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const RED: DayFlag[] = ['open', 'no_record'];

/** Folha mensal (servidor): totais, tabela diária com registos e, conforme o perfil, correcção e aprovação. */
export function SheetView({ sheet, period }: { sheet: Sheet; period: string }) {
  const s = sheet.summary;
  const byDate = new Map<string, Sheet['entries']>();
  for (const e of sheet.entries) byDate.set(e.workDate, [...(byDate.get(e.workDate) ?? []), e]);
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const days = s.days.filter((d) => d.date <= today || byDate.has(d.date));
  return (
    <>
      <div className="grid">
        <div className="card kpi"><div className="l">Horas trabalhadas</div><div className="v">{formatMinutes(s.workedMinutes)}</div></div>
        <div className="card kpi"><div className="l">Horas previstas</div><div className="v">{formatMinutes(s.expectedMinutes)}</div></div>
        <div className="card kpi"><div className="l">Horas extra</div><div className="v" style={{ color: s.overtimeMinutes ? 'var(--brand)' : undefined }}>{formatMinutes(s.overtimeMinutes)}</div>
          {s.restOrHolidayOvertimeMinutes > 0 && <div className="muted" style={{ fontSize: 12 }}>{formatMinutes(s.restOrHolidayOvertimeMinutes)} em descanso/feriado</div>}</div>
        <div className="card kpi"><div className="l">Pendências</div><div className="v" style={{ color: s.openDays + s.noRecordDays ? 'var(--red)' : undefined }}>{s.openDays + s.noRecordDays}</div>
          <div className="muted" style={{ fontSize: 12 }}>{s.openDays} sem saída · {s.noRecordDays} sem registo</div></div>
      </div>

      {sheet.approval && (
        <div className="preview good" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>
            Mês aprovado por {sheet.approval.approvedByName ?? '—'} em {new Date(sheet.approval.approvedAt).toLocaleDateString('pt-PT')} ·
            horas extra a pagar: <b>{formatMinutes(sheet.approval.approvedOvertimeMinutes)}</b>
            {sheet.approval.approvedOvertimeMinutes < sheet.approval.overtimeMinutes && ` (de ${formatMinutes(sheet.approval.overtimeMinutes)} registadas)`}
            {sheet.approval.note && ` — ${sheet.approval.note}`}
          </span>
          {sheet.canReopen && <ReopenMonth employeeId={sheet.employee.id} period={period} />}
        </div>
      )}

      <div className="card">
        <table>
          <thead><tr><th>Dia</th><th>Registos</th><th className="num">Trabalhado</th><th className="num">Extra</th><th>Observações</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const entries = byDate.get(d.date) ?? [];
              return (
                <tr key={d.date} className={d.kind === 'rest' || d.kind === 'inactive' ? 'rest' : d.kind === 'holiday' ? 'holiday' : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{d.date.slice(8)}</b> <span className="muted">{WD[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}</span></td>
                  <td>
                    {entries.map((e) => <EntryChip key={e.id} e={e} editable={sheet.canEdit} />)}
                    {sheet.canEdit && d.date <= today && <AddEntry employeeId={sheet.employee.id} date={d.date} />}
                  </td>
                  <td className="num">{d.workedMinutes ? formatMinutes(d.workedMinutes) : '—'}</td>
                  <td className="num">{d.overtimeMinutes ? <b style={{ color: 'var(--brand)' }}>{formatMinutes(d.overtimeMinutes)}</b> : '—'}</td>
                  <td>
                    {d.kind === 'inactive' && <span className="muted">Fora do período de contrato </span>}
                    {d.holiday && <span className="muted">{d.holiday} </span>}
                    {d.absence && <span className="tag">{d.absence}</span>}
                    {d.flags.map((f) => <span key={f} className={`flag ${RED.includes(f as DayFlag) ? 'red' : ''}`}>{DAY_FLAG_LABEL[f as DayFlag]}</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!days.length && <div className="empty">Sem dias para mostrar</div>}
      </div>

      {sheet.canApprove && <ApproveMonth employeeId={sheet.employee.id} period={period} overtimeMinutes={s.overtimeMinutes} openDays={s.openDays} />}
      {!sheet.approval && !sheet.canApprove && sheet.canEdit && <p className="muted" style={{ marginTop: 10 }}>A aprovação do mês fica disponível depois de o mês terminar.</p>}
    </>
  );
}
