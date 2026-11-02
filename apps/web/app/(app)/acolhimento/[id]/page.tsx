import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CHECKLIST_KIND_LABELS, TASK_RESPONSIBLE_LABELS } from '@kianda/core';
import { api, ApiError, currentUser } from '@/lib/api';
import { AddTaskForm, CancelChecklist, DeleteTask, TaskToggle } from '../forms';
import { LIST_STATUS, pt, STATE_TAG, type ChecklistDetail } from '../types';

export const dynamic = 'force-dynamic';

/** Uma lista de acolhimento ou saída: tarefas por ordem, quem as fez e quando, prazos e notas. */
export default async function Lista({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await currentUser())!;
  const list = await api<ChecklistDetail>(`/v1/checklists/${id}`).catch((e: unknown) => { if (e instanceof ApiError && e.status === 404) notFound(); throw e; });
  const staff = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'].includes(me.user.role);
  const editable = list.status !== 'cancelled';
  return (
    <>
      <p className="muted"><Link href="/acolhimento">← Acolhimento e saída</Link></p>
      <div className="page-head">
        <div>
          <h1>{CHECKLIST_KIND_LABELS[list.kind]} · {list.employee.name}</h1>
          <p className="sub">{list.title} · {list.kind === 'onboarding' ? 'início do contrato' : 'data de cessação'} {pt(list.referenceDate)}{list.terminationId && staff ? <> · <Link href={`/cessacoes/${list.terminationId}`}>ver a cessação</Link></> : null}</p>
        </div>
        <span className={LIST_STATUS[list.status][1]}>{LIST_STATUS[list.status][0]}</span>
      </div>
      {list.status === 'cancelled' && <div className="warn">Lista anulada{list.cancelReason ? `: ${list.cancelReason}` : ''}. As tarefas ficam em consulta.</div>}
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="l">Feitas</div><div className="v">{list.progress.done} de {list.progress.total}</div></div>
        <div className="card kpi"><div className="l">Em atraso</div><div className="v" style={list.progress.overdue ? { color: 'var(--red)' } : undefined}>{list.progress.overdue}</div></div>
        <div className="card kpi"><div className="l">Próximo prazo</div><div className="v">{list.progress.nextDue ? pt(list.progress.nextDue) : '—'}</div></div>
      </div>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Situação</th><th aria-label="Acções" /></tr></thead>
            <tbody>{list.tasks.map(t => <tr key={t.id} style={{ verticalAlign: 'top' }}>
              <td><b style={t.doneAt ? { textDecoration: 'line-through', fontWeight: 500 } : undefined}>{t.title}</b>
                {t.description && <div className="muted">{t.description}</div>}
                {t.doneAt && <div className="muted">Feita por {t.doneByName} em {new Date(t.doneAt).toLocaleDateString('pt-PT', { timeZone: 'Africa/Luanda' })}</div>}
                {t.note && <div className="muted">Nota: {t.note}</div>}</td>
              <td>{TASK_RESPONSIBLE_LABELS[t.responsible]}</td>
              <td>{pt(t.dueDate)}</td>
              <td><span className={STATE_TAG[t.state][1]}>{STATE_TAG[t.state][0]}</span></td>
              <td className="num"><TaskToggle checklistId={list.id} taskId={t.id} done={!!t.doneAt} note={t.note} disabled={!editable || !t.canComplete} />{list.canManage && editable && !t.doneAt && <DeleteTask checklistId={list.id} taskId={t.id} />}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {!list.tasks.length && <div className="empty">Sem tarefas que lhe caibam nesta lista.</div>}
        {list.canManage && editable && <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', padding: '12px 16px' }}><AddTaskForm checklistId={list.id} />{list.status === 'open' && <CancelChecklist checklistId={list.id} />}</div>}
      </div>
    </>
  );
}
