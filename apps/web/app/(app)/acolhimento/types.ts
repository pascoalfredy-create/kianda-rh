import type { ChecklistKind, TaskResponsible, TaskState } from '@kianda/core';

export interface ChecklistProgress { total: number; done: number; overdue: number; percent: number; nextDue: string | null }
export interface ChecklistRow {
  id: string; kind: ChecklistKind; title: string; status: 'open' | 'completed' | 'cancelled'; referenceDate: string; terminationId: string | null;
  createdAt: string; completedAt: string | null; employee: { id: string; name: string; number: string }; progress: ChecklistProgress; actionable: number;
}
export interface ChecklistTask {
  id: string; position: number; title: string; description: string | null; responsible: TaskResponsible; dueDate: string; doneAt: string | null;
  doneByName: string | null; note: string | null; state: TaskState; canComplete: boolean;
}
export interface ChecklistDetail extends Omit<ChecklistRow, 'actionable'> { cancelReason: string | null; canManage: boolean; tasks: ChecklistTask[] }
export interface MyTask { id: string; checklistId: string; kind: ChecklistKind; title: string; responsible: TaskResponsible; dueDate: string; state: TaskState; employee: { id: string; name: string } }
export interface TemplateData { kind: ChecklistKind; name: string; autoStart: boolean; items: { title: string; description?: string; responsible: TaskResponsible; offsetDays: number }[]; updatedAt: string }

export const pt = (d: string) => d.split('-').reverse().join('/');
export const STATE_TAG: Record<TaskState, [string, string]> = { done: ['Feita', 'st approved'], overdue: ['Em atraso', 'st rejected'], due_soon: ['A vencer', 'st pending'], pending: ['Por fazer', 'tag'] };
export const LIST_STATUS: Record<ChecklistRow['status'], [string, string]> = { open: ['Em curso', 'st pending'], completed: ['Concluída', 'st approved'], cancelled: ['Anulada', 'tag'] };
