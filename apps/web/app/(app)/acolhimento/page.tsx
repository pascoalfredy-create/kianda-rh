import Link from 'next/link';
import { CHECKLIST_KIND_LABELS, TASK_RESPONSIBLE_LABELS } from '@kianda/core';
import { api, currentUser } from '@/lib/api';
import { StartChecklistForm, TemplateEditor } from './forms';
import { LIST_STATUS, pt, STATE_TAG, type ChecklistRow, type MyTask, type TemplateData } from './types';

export const dynamic = 'force-dynamic';

const VIEWS = [['open', 'Em curso'], ['completed', 'Concluídas'], ['cancelled', 'Anuladas']] as const;

/** Talento → Acolhimento e saída: as tarefas de cada um, as listas por colaborador e os modelos da empresa. */
export default async function Acolhimento({ searchParams }: { searchParams: Promise<{ v?: string; tipo?: string }> }) {
  const me = (await currentUser())!;
  const q = await searchParams;
  const hr = ['owner', 'hr_admin'].includes(me.user.role);
  const staff = hr || ['payroll', 'finance', 'manager'].includes(me.user.role);
  const view = q.v === 'modelos' && hr ? 'modelos' : VIEWS.some(([k]) => k === q.v) ? q.v! : 'open';
  const kind = q.tipo === 'onboarding' || q.tipo === 'offboarding' ? q.tipo : undefined;
  const [mine, lists, templates, people] = await Promise.all([
    api<MyTask[]>('/v1/checklists/my-tasks'),
    staff && view !== 'modelos' ? api<ChecklistRow[]>(`/v1/checklists?status=${view}${kind ? `&kind=${kind}` : ''}`) : Promise.resolve([] as ChecklistRow[]),
    hr && view === 'modelos' ? api<TemplateData[]>('/v1/checklist-templates') : Promise.resolve([] as TemplateData[]),
    hr && view === 'open' ? api<{ id: string; name: string; number: string; status?: string }[]>('/v1/employees') : Promise.resolve([]),
  ]);
  const tab = (v: string, label: string) => <Link key={v} href={`?v=${v}${kind && v !== 'modelos' ? `&tipo=${kind}` : ''}`} className={view === v ? 'on' : ''}>{label}</Link>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{staff ? 'Acolhimento e saída' : 'As minhas tarefas'}</h1>
          <p className="sub">{staff ? 'Listas de tarefas na admissão e na saída de cada colaborador, com responsáveis e prazos' : 'Tarefas do seu acolhimento ou da sua saída que lhe cabem a si'}</p>
        </div>
      </div>

      <div className="card section">
        <h2>As minhas tarefas</h2>
        {mine.length ? <table className="dense">
          <thead><tr><th>Tarefa</th>{staff && <th>Colaborador</th>}<th>Prazo</th><th>Situação</th></tr></thead>
          <tbody>{mine.map(t => <tr key={t.id}>
            <td><Link href={`/acolhimento/${t.checklistId}`}><b>{t.title}</b></Link><div className="muted">{CHECKLIST_KIND_LABELS[t.kind]} · {TASK_RESPONSIBLE_LABELS[t.responsible]}</div></td>
            {staff && <td>{t.employee.name}</td>}
            <td>{pt(t.dueDate)}</td><td><span className={STATE_TAG[t.state][1]}>{STATE_TAG[t.state][0]}</span></td>
          </tr>)}</tbody>
        </table> : <div className="empty">Não tem tarefas por fazer.</div>}
      </div>

      {staff && <>
        <nav className="tabs">{VIEWS.map(([v, l]) => tab(v, l))}{hr && tab('modelos', 'Modelos')}</nav>
        {view === 'modelos' ? <>
          <p className="sub">Cada lista é uma cópia do modelo no momento em que começa: alterar o modelo não muda as listas em curso. Prazos em dias de calendário a contar do início do contrato (acolhimento) ou da data de cessação (saída); negativos são dias antes.</p>
          {templates.map(t => <TemplateEditor key={t.kind} template={t} />)}
        </> : <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['', 'Todas'], ['onboarding', 'Acolhimento'], ['offboarding', 'Saída']].map(([k, l]) => <Link key={k} className={`btn sm ${(kind ?? '') === k ? '' : 'ghost'}`} href={`?v=${view}${k ? `&tipo=${k}` : ''}`}>{l}</Link>)}
          </div>
          <div className="card">
            <table>
              <thead><tr><th>Colaborador</th><th>Lista</th><th>Data de referência</th><th>Progresso</th><th>Próximo prazo</th><th>Situação</th></tr></thead>
              <tbody>{lists.map(l => <tr key={l.id}>
                <td><Link href={`/acolhimento/${l.id}`}><b>{l.employee.number} · {l.employee.name}</b></Link></td>
                <td>{CHECKLIST_KIND_LABELS[l.kind]}<div className="muted">{l.title}</div></td>
                <td>{pt(l.referenceDate)}<div className="muted">{l.kind === 'onboarding' ? 'Início do contrato' : 'Data de cessação'}</div></td>
                <td style={{ minWidth: 140 }}><b>{l.progress.done}/{l.progress.total}</b> <span className="muted">({l.progress.percent}%)</span>
                  <div aria-hidden="true" style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 4 }}><div style={{ width: `${l.progress.percent}%`, height: 6, borderRadius: 4, background: l.progress.overdue ? 'var(--amber, #c98a00)' : 'var(--brand)' }} /></div>
                  {l.progress.overdue > 0 && <div style={{ color: 'var(--red)', fontSize: 12 }}>{l.progress.overdue} em atraso</div>}</td>
                <td>{l.progress.nextDue ? pt(l.progress.nextDue) : '—'}</td>
                <td><span className={LIST_STATUS[l.status][1]}>{LIST_STATUS[l.status][0]}</span></td>
              </tr>)}</tbody>
            </table>
            {!lists.length && <div className="empty">{view === 'open' ? 'Nenhuma lista em curso. As listas começam na admissão de um colaborador e ao registar uma cessação.' : 'Sem listas nesta situação.'}</div>}
          </div>
          {hr && view === 'open' && <StartChecklistForm employees={people.filter(p => p.status !== 'terminated')} />}
        </>}
      </>}
    </>
  );
}
