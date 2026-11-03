import type { RosterIssue } from '@kianda/core';

export interface ShiftType { id: string; code: string; name: string; startTime: string; endTime: string; breakMinutes: number; color: string; minStaff: number | null; active: boolean; workMinutes: number }
export interface Published { kind: 'shift' | 'off'; code?: string; name?: string; startTime?: string; endTime?: string; breakMinutes?: number; color?: string }
export interface RosterCell { employeeId: string; date: string; kind: 'shift' | 'off' | 'none'; shiftTypeId: string | null; published: Published | null; pending: boolean; locked: boolean }
export interface RosterEmployee {
  id: string; name: string; number: string; jobTitle: string; department: string | null; departmentId: string | null; workplace: string | null; workplaceId: string | null;
  schedule: string | null; rotation: boolean; startDate: string | null; canEdit: boolean; absences: Record<string, string>; lockedDays: string[];
}
export interface RosterData {
  from: string; to: string; days: string[]; holidays: Record<string, string>; today: string; types: ShiftType[]; minRestMinutes: number;
  weeklyHours: number; extendedWeeklyHours: number; previous: { employeeId: string; date: string; kind: 'shift' | 'off'; shiftTypeId: string | null }[];
  employees: RosterEmployee[]; cells: RosterCell[]; issues: RosterIssue[]; pendingCount: number; canManageTypes: boolean;
}
export interface TypesData { types: ShiftType[]; minRestMinutes: number; canManage: boolean }
export interface MineDay { date: string; kind: 'shift' | 'off'; code?: string; name?: string; startTime?: string; endTime?: string; breakMinutes?: number; color?: string; workMinutes: number; publishedAt: string }
export interface MineData { from: string; to: string; today: string; days: MineDay[]; holidays: Record<string, string>; absences: Record<string, string>; next: MineDay | null }

export const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
export const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const pt = (d: string) => d.split('-').reverse().join('/');
/** Cores dos turnos (fundo, texto). */
export const SHIFT_PALETTE: Record<string, [string, string]> = {
  blue: ['#dfeafc', '#1f4f9e'], green: ['#dcf1e6', '#17683f'], amber: ['#fbecd0', '#8a5a0b'], violet: ['#ebe3fb', '#5a35a6'],
  red: ['#fbe2dd', '#9c3220'], teal: ['#d8f0ef', '#0d6b6b'], slate: ['#e6e9ee', '#3d4552'],
};
export const chipStyle = (color?: string | null) => { const [bg, fg] = SHIFT_PALETTE[color ?? 'blue'] ?? SHIFT_PALETTE.blue!; return { background: bg, color: fg }; };
