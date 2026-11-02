import { describe, expect, it } from 'vitest';
import { canCompleteTask, checklistDueDate, checklistProgress, checklistTemplateIssue, DEFAULT_CHECKLIST_TEMPLATES, shiftDueDate, taskState } from '../src/index.js';

describe('acolhimento e saída: prazos, estados e responsáveis', () => {
  it('prazo em dias de calendário a partir da data de referência, também negativo', () => {
    expect(checklistDueDate('2026-11-02', 0)).toBe('2026-11-02');
    expect(checklistDueDate('2026-11-02', 55)).toBe('2026-12-27');
    expect(checklistDueDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => checklistDueDate('02/11/2026', 1)).toThrow();
  });
  it('mudar a data de cessação desloca os prazos pela mesma diferença', () => {
    expect(shiftDueDate('2026-11-20', '2026-11-30', '2026-12-15')).toBe('2026-12-05');
    expect(shiftDueDate('2026-11-20', '2026-11-30', '2026-11-25')).toBe('2026-11-15');
  });
  it('estado: feita, em atraso, a vencer em 3 dias ou pendente', () => {
    const today = '2026-11-02';
    expect(taskState({ dueDate: '2026-11-01', doneAt: null }, today)).toBe('overdue');
    expect(taskState({ dueDate: '2026-11-05', doneAt: null }, today)).toBe('due_soon');
    expect(taskState({ dueDate: '2026-11-06', doneAt: null }, today)).toBe('pending');
    expect(taskState({ dueDate: '2026-10-01', doneAt: '2026-10-02T10:00:00Z' }, today)).toBe('done');
    expect(checklistProgress([{ dueDate: '2026-11-01', doneAt: null }, { dueDate: '2026-11-10', doneAt: null }, { dueDate: '2026-10-01', doneAt: new Date() }], today))
      .toEqual({ total: 3, done: 1, overdue: 1, percent: 33, nextDue: '2026-11-01' });
    expect(checklistProgress([], today).percent).toBe(100);
  });
  it('cada um marca só o que lhe cabe; ninguém fecha tarefas de chefia ou Finanças da própria lista', () => {
    const emp = { id: 'e1', managerId: 'm1' };
    expect(canCompleteTask({ role: 'owner', employeeId: 'e1' }, 'manager', emp)).toBe(true);
    expect(canCompleteTask({ role: 'hr_admin', employeeId: 'h1' }, 'finance', emp)).toBe(true);
    expect(canCompleteTask({ role: 'hr_admin', employeeId: 'e1' }, 'hr', emp)).toBe(false);
    expect(canCompleteTask({ role: 'manager', employeeId: 'm1' }, 'manager', emp)).toBe(true);
    expect(canCompleteTask({ role: 'manager', employeeId: 'm2' }, 'manager', emp)).toBe(false);
    expect(canCompleteTask({ role: 'manager', employeeId: 'm1' }, 'hr', emp)).toBe(false);
    expect(canCompleteTask({ role: 'employee', employeeId: 'e1' }, 'employee', emp)).toBe(true);
    expect(canCompleteTask({ role: 'employee', employeeId: 'e2' }, 'employee', emp)).toBe(false);
    expect(canCompleteTask({ role: 'employee', employeeId: 'e1' }, 'hr', emp)).toBe(false);
    expect(canCompleteTask({ role: 'payroll', employeeId: 'p1' }, 'finance', emp)).toBe(true);
    expect(canCompleteTask({ role: 'finance', employeeId: 'f1' }, 'manager', emp)).toBe(false);
  });
  it('os modelos-tipo são válidos; a validação recusa tarefas sem título ou prazos fora do intervalo', () => {
    for (const t of Object.values(DEFAULT_CHECKLIST_TEMPLATES)) expect(checklistTemplateIssue(t)).toBeNull();
    expect(checklistTemplateIssue({ name: 'X', items: [{ title: ' ', responsible: 'hr', offsetDays: 0 }] })).toMatch(/título/);
    expect(checklistTemplateIssue({ name: 'X', items: [{ title: 'A', responsible: 'hr', offsetDays: 400 }] })).toMatch(/prazo/);
    expect(checklistTemplateIssue({ name: '', items: [] })).toMatch(/nome/);
  });
});
