import { formatKz, monthLabelPt } from './portal/format';
import Link from 'next/link';
import { ClockCard } from '@/components/clock-card';
import { api } from '@/lib/api';
import type { Profile, BalanceRow } from '@/lib/types';
import { RequestDeclaration } from './portal/forms';
import { PushSettings } from '@/components/push-settings';
import { type MineData } from './turnos/types';
import { capitalise, firstName, greeting, longDate, luandaNow, monthName, plural, relativeDay } from '@/lib/humane';

/** «de manhã», «de tarde», «de noite»; senão «no turno X». */
const shiftWord = (name?: string) => { const n = (name ?? '').toLocaleLowerCase('pt-PT'); return ['manhã', 'tarde', 'noite'].includes(n) ? `de ${n}` : `no turno ${name ?? ''}`.trim(); };

interface Portal {
  lastPayslip: { id: string; period: string; netMinor: number } | null; pendingAbsences: number;
  expenses: { open: number; toReceiveMinor: number; rejected: number }; documents: number;
  documentRequests: { id: string; templateKey: string; status: string; createdAt: string; documentId: string | null; decisionNote: string | null }[];
  profileRequests: { id: string; status: string; createdAt: string; changes: Record<string, string | null>; decisionNote: string | null }[];
  review: { id: string; status: string; cycle: string } | null;
  selfService: { templates: { key: string; title: string; description: string; inputs: { key: string; label: string; placeholder?: string; required: boolean }[] }[]; autoIssue: boolean };
}
const STATUS: Record<string, [string, string]> = { pending: ['Pendente', 'st pending'], issued: ['Emitida', 'st approved'], approved: ['Aprovado', 'st approved'], rejected: ['Recusado', 'st rejected'], cancelled: ['Retirado', 'tag'] };

/** Início do colaborador: o essencial do dia-a-dia num só ecrã. */
export async function PortalHome({ name, employeeId }: { name: string; employeeId: string }) {
  const year = new Date().getFullYear();
  const [p, balances, profile, tasks, acks, shifts] = await Promise.all([api<Portal>('/v1/portal'), api<BalanceRow[]>(`/v1/leave/balances?year=${year}`).catch(() => []), api<Profile>(`/v1/employees/${employeeId}`).catch(() => null), api<{ id: string; state: string }[]>('/v1/checklists/my-tasks').catch(() => []), api<{ id: string; status: string; state: string }[]>('/v1/acknowledgements').catch(() => []), api<MineData>('/v1/shifts/mine').catch(() => null)]);
  const firstContract = profile?.contracts.at(-1)?.startDate;
  const mine = balances.find((b) => b.employee.id === employeeId);
  const titles = Object.fromEntries(p.selfService.templates.map((t) => [t.key, t.title]));
  const now = luandaNow();
  const todayShift = shifts?.days.find(d => d.date === now.date) ?? null;
  const pendingAcks = acks.filter(a => a.status === 'pending');
  const dt = (d: string) => new Date(d).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' });
  return (
    <>
      <div className="today-meta"><span>{capitalise(longDate(now.date))} · {now.time} em Luanda</span></div>
      <h1>{greeting(now.hour)}, {firstName(name)}.</h1>
      <p className="today-summary" style={{ marginBottom: 18 }}>{todayShift?.kind === 'shift' ? <>Hoje está {shiftWord(todayShift.name)}, das <b>{todayShift.startTime}</b> às <b>{todayShift.endTime}</b>.</> : todayShift?.kind === 'off' ? 'Hoje é dia de folga. Bom descanso.' : 'Aqui tem o seu ponto, recibos, férias e pedidos.'}</p>
      <ClockCard />
      <PushSettings compact />
      {p.review && (
        <Link href={`/desempenho/${p.review.id}`} className="warn notice-link">
          {p.review.status === 'self' ? <>A sua auto-avaliação de «{p.review.cycle}» está à sua espera. <b>Começar</b></> : <>A sua avaliação de «{p.review.cycle}» está concluída. <b>Ver o resultado</b></>}
        </Link>
      )}
      {pendingAcks.length > 0 && (
        <Link href="/aceitacao" className="warn notice-link">
          A empresa pediu-lhe para ler e aceitar {plural(pendingAcks.length, 'documento', 'documentos')}.{pendingAcks.some(a => a.state === 'overdue') ? ' O prazo já passou.' : ''} <b>Ler agora</b>
        </Link>
      )}
      {tasks.length > 0 && (
        <Link href="/acolhimento" className="warn notice-link">
          Tem {plural(tasks.length, 'tarefa', 'tarefas')} por fazer.{tasks.some(t => t.state === 'overdue') ? ` ${tasks.filter(t => t.state === 'overdue').length === 1 ? 'Uma já passou' : 'Algumas já passaram'} do prazo.` : ''} <b>Ver tarefas</b>
        </Link>
      )}
      <section className="card glance">
        <Link href={p.lastPayslip ? `/recibos/${p.lastPayslip.id}` : '/recibos'}><span>{p.lastPayslip ? `Recibo de ${monthLabelPt(p.lastPayslip.period)}` : 'Recibos'}</span><b>{p.lastPayslip ? `${formatKz(p.lastPayslip.netMinor)} líquidos` : 'ainda não há recibos'}</b></Link>
        <Link href="/ausencias"><span>Férias de {year}</span><b>{mine ? `${plural(mine.available, 'dia', 'dias')} por gozar` : '—'}{p.pendingAbsences ? ` · ${plural(p.pendingAbsences, 'pedido', 'pedidos')} à espera` : ''}</b></Link>
        {shifts?.next && <Link href="/turnos"><span>Próximo turno</span><b>{shifts.next.date === shifts.today ? 'Hoje' : capitalise(relativeDay(shifts.next.date, now.date))} · {shifts.next.startTime}–{shifts.next.endTime}</b></Link>}
        <Link href="/despesas"><span>Despesas</span><b>{p.expenses.toReceiveMinor ? `${formatKz(p.expenses.toReceiveMinor)} a receber` : p.expenses.open ? plural(p.expenses.open, 'nota em curso', 'notas em curso') : 'nada em curso'}{p.expenses.rejected ? ` · ${plural(p.expenses.rejected, 'recusada', 'recusadas')}` : ''}</b></Link>
        <Link href="/documentos"><span>Documentos</span><b>{p.documents ? plural(p.documents, 'documento emitido', 'documentos emitidos') : 'nenhum ainda'}</b></Link>
        <div><span>Chefia directa</span><b>{profile?.manager?.name ?? '—'}</b></div>
        <div><span>Na empresa</span><b>{firstContract ? `desde ${monthName(firstContract.slice(0, 7))} de ${firstContract.slice(0, 4)}` : '—'}</b></div>
        <Link href="/portal/dados"><span>Os meus dados</span><b>Morada, contactos e IBAN</b></Link>
      </section>
      <div className="two" style={{ alignItems: 'start' }}>
        <div className="card section">
          <h2>Precisa de uma declaração?</h2>
          <RequestDeclaration templates={p.selfService.templates} autoIssue={p.selfService.autoIssue} />
        </div>
        <div className="card section">
          <h2>Os meus pedidos</h2>
          <table className="dense">
            <tbody>
              {p.documentRequests.map((r) => (
                <tr key={r.id}>
                  <td>{titles[r.templateKey] ?? r.templateKey}<div className="muted">{dt(r.createdAt)}{r.decisionNote && r.status === 'rejected' ? ` · ${r.decisionNote}` : ''}</div></td>
                  <td className="num"><span className={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</span> {r.documentId && <Link href={`/documentos/${r.documentId}`}>abrir</Link>}</td>
                </tr>
              ))}
              {p.profileRequests.map((r) => (
                <tr key={r.id}>
                  <td>Alteração de dados ({Object.keys(r.changes).length} campo(s))<div className="muted">{dt(r.createdAt)}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</div></td>
                  <td className="num"><span className={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!p.documentRequests.length && !p.profileRequests.length && <div className="empty">Ainda não fez nenhum pedido.</div>}
        </div>
      </div>
    </>
  );
}
