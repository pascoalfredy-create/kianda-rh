/**
 * Acolhimento e saída: listas de tarefas por colaborador, criadas na admissão e na cessação.
 * Cada tarefa tem um responsável (RH, chefia directa, o próprio colaborador ou Finanças) e um prazo
 * contado em dias de calendário a partir da data de referência (início do contrato ou data de cessação).
 */

export const CHECKLIST_KINDS = ['onboarding', 'offboarding'] as const;
export type ChecklistKind = typeof CHECKLIST_KINDS[number];
export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = { onboarding: 'Acolhimento', offboarding: 'Saída' };

export const TASK_RESPONSIBLES = ['hr', 'manager', 'employee', 'finance'] as const;
export type TaskResponsible = typeof TASK_RESPONSIBLES[number];
export const TASK_RESPONSIBLE_LABELS: Record<TaskResponsible, string> = { hr: 'Recursos Humanos', manager: 'Chefia directa', employee: 'Colaborador', finance: 'Finanças' };

export interface ChecklistTemplateItem { title: string; description?: string; responsible: TaskResponsible; offsetDays: number }
export interface ChecklistTemplate { kind: ChecklistKind; name: string; autoStart: boolean; items: ChecklistTemplateItem[] }

export const CHECKLIST_MAX_ITEMS = 60;
export const CHECKLIST_MAX_OFFSET_DAYS = 365;

/**
 * Modelos-tipo (a empresa ajusta-os em Talento → Acolhimento e saída).
 * Prazos negativos são dias antes da data de referência (preparar a chegada ou a passagem de pasta).
 */
export const DEFAULT_CHECKLIST_TEMPLATES: Record<ChecklistKind, ChecklistTemplate> = {
  onboarding: {
    kind: 'onboarding', name: 'Acolhimento de novos colaboradores', autoStart: true,
    items: [
      { title: 'Contrato de trabalho assinado pelas duas partes', responsible: 'hr', offsetDays: 0, description: 'Arquivar o original e entregar uma cópia ao colaborador.' },
      { title: 'Ficha completa: BI, NIF, n.º da Segurança Social e dados bancários', responsible: 'hr', offsetDays: 0 },
      { title: 'Inscrição ou actualização na Segurança Social (INSS)', responsible: 'hr', offsetDays: 7 },
      { title: 'Posto de trabalho, equipamento e EPI preparados', responsible: 'manager', offsetDays: -1 },
      { title: 'Acessos criados (email, sistemas e portal do colaborador)', responsible: 'hr', offsetDays: 0 },
      { title: 'Apresentação à equipa e às regras da área', responsible: 'manager', offsetDays: 0 },
      { title: 'Ler o regulamento interno e as regras de segurança', responsible: 'employee', offsetDays: 3 },
      { title: 'Confirmar os dados pessoais e bancários no portal', responsible: 'employee', offsetDays: 3 },
      { title: 'Formação inicial de higiene e segurança no trabalho', responsible: 'manager', offsetDays: 7 },
      { title: 'Incluir no processamento salarial do mês de admissão', responsible: 'finance', offsetDays: 0 },
      { title: 'Avaliação do período experimental', responsible: 'manager', offsetDays: 55, description: 'Decidir antes do fim do período experimental (LGT, Lei n.º 12/23).' },
    ],
  },
  offboarding: {
    kind: 'offboarding', name: 'Saída de colaboradores', autoStart: true,
    items: [
      { title: 'Comunicação ou acordo de cessação assinado', responsible: 'hr', offsetDays: -15 },
      { title: 'Plano de passagem de pasta', responsible: 'manager', offsetDays: -10 },
      { title: 'Entrevista de saída', responsible: 'hr', offsetDays: -3 },
      { title: 'Devolução de equipamento, EPI, cartões e chaves', responsible: 'manager', offsetDays: 0 },
      { title: 'Desactivar acessos (email, sistemas, portal)', responsible: 'hr', offsetDays: 0 },
      { title: 'Fecho de contas: cálculo final e indemnização confirmados', responsible: 'hr', offsetDays: 0, description: 'Em Pessoas → Cessações; entra no processamento do mês da cessação.' },
      { title: 'Pagamento do fecho de contas', responsible: 'finance', offsetDays: 5 },
      { title: 'Certificado de trabalho entregue', responsible: 'hr', offsetDays: 5 },
      { title: 'Comunicação da saída à Segurança Social (INSS)', responsible: 'hr', offsetDays: 10 },
    ],
  },
};

const DAY_MS = 86_400_000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Prazo de uma tarefa: data de referência + dias (pode ser negativo). */
export function checklistDueDate(referenceDate: string, offsetDays: number): string {
  if (!isoDate.test(referenceDate) || !Number.isInteger(offsetDays)) throw new RangeError('Data ou prazo inválido');
  return new Date(Date.parse(`${referenceDate}T00:00:00Z`) + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Desloca um prazo quando a data de referência muda (por exemplo, a data de cessação). */
export function shiftDueDate(dueDate: string, fromReference: string, toReference: string): string {
  const delta = Math.round((Date.parse(`${toReference}T00:00:00Z`) - Date.parse(`${fromReference}T00:00:00Z`)) / DAY_MS);
  return checklistDueDate(dueDate, delta);
}

export type TaskState = 'done' | 'overdue' | 'due_soon' | 'pending';
/** Estado de uma tarefa face a hoje (hora de Luanda): «a vencer» = até 3 dias. */
export function taskState(task: { dueDate: string; doneAt: string | Date | null }, today: string): TaskState {
  if (task.doneAt) return 'done';
  if (task.dueDate < today) return 'overdue';
  return task.dueDate <= checklistDueDate(today, 3) ? 'due_soon' : 'pending';
}

export function checklistProgress(tasks: { dueDate: string; doneAt: string | Date | null }[], today: string) {
  const done = tasks.filter(t => t.doneAt).length, overdue = tasks.filter(t => taskState(t, today) === 'overdue').length;
  const next = tasks.filter(t => !t.doneAt).map(t => t.dueDate).sort()[0] ?? null;
  return { total: tasks.length, done, overdue, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 100, nextDue: next };
}

export interface TaskActor { role: string; employeeId: string | null }
/**
 * Quem pode marcar uma tarefa: o proprietário e o RH sempre; a chefia directa as tarefas de chefia;
 * o colaborador as suas (nunca as dos outros); Finanças/processamento as de Finanças.
 * Ninguém marca, como chefia ou Finanças, tarefas da sua própria lista (excepto o proprietário).
 */
export function canCompleteTask(actor: TaskActor, responsible: TaskResponsible, employee: { id: string; managerId: string | null }): boolean {
  if (actor.role === 'owner') return true;
  const own = !!actor.employeeId && actor.employeeId === employee.id;
  if (responsible === 'employee') return own || actor.role === 'hr_admin';
  if (own) return false;
  if (actor.role === 'hr_admin') return true;
  if (responsible === 'manager') return actor.role === 'manager' && !!actor.employeeId && employee.managerId === actor.employeeId;
  if (responsible === 'finance') return actor.role === 'finance' || actor.role === 'payroll';
  return false;
}

/** Validação de um modelo editado pela empresa (mensagens em português). */
export function checklistTemplateIssue(t: { name: string; items: ChecklistTemplateItem[] }): string | null {
  if (!t.name.trim()) return 'Indique o nome do modelo.';
  if (t.items.length > CHECKLIST_MAX_ITEMS) return `Um modelo tem no máximo ${CHECKLIST_MAX_ITEMS} tarefas.`;
  for (const [i, item] of t.items.entries()) {
    if (!item.title.trim()) return `Tarefa ${i + 1}: indique o título.`;
    if (!TASK_RESPONSIBLES.includes(item.responsible)) return `Tarefa ${i + 1}: responsável inválido.`;
    if (!Number.isInteger(item.offsetDays) || Math.abs(item.offsetDays) > CHECKLIST_MAX_OFFSET_DAYS) return `Tarefa ${i + 1}: o prazo deve estar entre −${CHECKLIST_MAX_OFFSET_DAYS} e ${CHECKLIST_MAX_OFFSET_DAYS} dias.`;
  }
  return null;
}
