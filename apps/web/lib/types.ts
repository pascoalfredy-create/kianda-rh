/** Formas das respostas da API usadas nas páginas (espelham apps/api/src/routes/employees.ts). */

export interface Department { id: string; name: string; costCenter: string }

export interface EmployeeRow {
  id: string;
  number: string;
  name: string;
  jobTitle: string;
  status: 'active' | 'suspended' | 'terminated';
  managerId: string | null;
  department: string | null;
  contract: { type: string; startDate: string; endDate: string | null; baseMinor: number } | null;
  alerts: string[];
}

export interface Contract {
  id: string;
  type: 'indefinite' | 'fixed_term' | 'internship';
  startDate: string;
  endDate: string | null;
  termJustification: string | null;
  baseMinor: number;
  mealMinor: number;
  transportMinor: number;
  terminatedAt: string | null;
  terminationReason: string | null;
}

export interface Compensation {
  id: string;
  effectiveDate: string;
  baseMinor: number;
  mealMinor: number;
  transportMinor: number;
  reason: string;
  previousBaseMinor?: number | null;
  changeBps?: number | null;
}

export interface IdDocument {
  id: string;
  type: string;
  number: string;
  issueDate: string | null;
  expiryDate: string | null;
  issuer: string | null;
  notes: string | null;
}

export interface PersonRef { id: string; name: string; jobTitle: string; number?: string }

export interface Profile {
  id: string;
  number: string;
  name: string;
  jobTitle: string;
  status: 'active' | 'suspended' | 'terminated';
  gender: 'F' | 'M' | null;
  birthDate: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  biNumber: string | null;
  nif: string | null;
  inssNumber: string | null;
  iban: string | null;
  bank: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  province: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  vacationCarryOver: number;
  departmentId: string | null;
  managerId: string | null;
  department: Department | null;
  manager: PersonRef | null;
  reports: PersonRef[];
  account: { email: string; role: string } | null;
  contract: Contract | null;
  contracts: Contract[];
  compensation: { current: Compensation | null; upcoming: Compensation[]; history: Compensation[] };
  documents: IdDocument[];
  alerts: string[];
}

export interface HistoryEntry {
  id: string;
  action: 'create' | 'update' | 'delete';
  entity: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
  actorName: string;
}

export interface OrgNode { id: string; name: string; jobTitle: string; number: string; department: string | null; reports: OrgNode[] }

export const CONTRACT_LABEL: Record<string, string> = { indefinite: 'Indeterminado', fixed_term: 'A termo', internship: 'Estágio' };
export const STATUS_LABEL: Record<string, string> = { active: 'Activo', suspended: 'Suspenso', terminated: 'Cessado' };
export const DOC_LABEL: Record<string, string> = {
  bi: 'Bilhete de Identidade', passport: 'Passaporte', residence_card: 'Cartão de Residente', work_visa: 'Visto de Trabalho',
  driving_licence: 'Carta de Condução', professional_card: 'Carteira Profissional', other: 'Outro',
};
export const PROVINCES = [
  'Bengo', 'Benguela', 'Bié', 'Cabinda', 'Cuando', 'Cuanza Norte', 'Cuanza Sul', 'Cubango', 'Cunene', 'Huambo', 'Huíla', 'Icolo e Bengo',
  'Luanda', 'Lunda Norte', 'Lunda Sul', 'Malanje', 'Moxico', 'Moxico Leste', 'Namibe', 'Uíge', 'Zaire',
];
export const CAN_EDIT = ['owner', 'hr_admin'];
export const ROLE_LABEL: Record<string, string> = {
  owner: 'Proprietário', hr_admin: 'Administração de RH', payroll: 'Processamento salarial', finance: 'Finanças', manager: 'Chefia', employee: 'Colaborador',
};

export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface AbsenceRow {
  id: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  reason: string | null;
  status: AbsenceStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  requesterName: string | null;
  employee: { id: string; name: string; number: string; department: string | null };
  canDecide: boolean;
  canCancel: boolean;
}
export interface BalanceRow {
  employee: { id: string; name: string; number: string; department: string | null };
  hireDate: string | null;
  eligibleFrom: string | null;
  year: number;
  entitlement: number;
  carriedOver: number;
  taken: number;
  pending: number;
  available: number;
}
export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada', cancelled: 'Cancelada' };

export interface DayRow {
  date: string;
  kind: 'workday' | 'rest' | 'holiday' | 'absence' | 'inactive';
  holiday?: string;
  absence?: string;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  flags: string[];
}
export interface EntryRow { id: string; workDate: string; in: string; out: string | null; source: 'web' | 'manual'; note: string | null }
export interface MonthTotals {
  period: string;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  restOrHolidayOvertimeMinutes: number;
  openDays: number;
  noRecordDays: number;
}
export interface Approval { approvedOvertimeMinutes: number; overtimeMinutes: number; note: string | null; approvedAt: string; approvedByName: string | null }
export interface Sheet {
  employee: { id: string; name: string; number: string; jobTitle: string };
  summary: MonthTotals & { days: DayRow[] };
  entries: EntryRow[];
  approval: Approval | null;
  schedule?: { id: string; name: string; description: string; anchor: string | null } | null;
  canEdit: boolean;
  canApprove: boolean;
  canReopen: boolean;
}
export interface OverviewRow extends MonthTotals {
  employee: { id: string; name: string; number: string; department: string | null };
  approval: Approval | null;
  canApprove: boolean;
}

export interface PayrollLineRow {
  id: string;
  employeeId: string;
  overtimeHours: string;
  absenceDays: number;
  grossMinor: number;
  inssEmployeeMinor: number;
  irtMinor: number;
  netMinor: number;
  inssEmployerMinor: number;
  irtBracket: number;
  breakdown: { code: string; name: string; kind: 'earning' | 'deduction' | 'employer'; amountMinor: number }[];
  calculationHash: string;
  employee: { id: string; name: string; number: string; department: string | null; hasIban: boolean };
}
export interface PayrollRunDetail {
  id: string;
  period: string;
  status: 'draft' | 'closed';
  packVersion: string;
  preparedBy: string | null;
  preparedByName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  warnings: { employeeId?: string; message: string }[];
  subsidyOverrides: Record<string, { holiday?: boolean; christmas?: boolean }>;
  lines: PayrollLineRow[];
}
export interface PayrollVariableRow {
  id: string;
  employeeId: string;
  kind: 'bonus' | 'other_earning' | 'advance' | 'other_deduction';
  label: string;
  amountMinor: number;
  inInss: boolean;
  inIrt: boolean;
  employee: { id: string; name: string; number: string };
}
export interface JournalRow { id: string; reference: string; date: string; description: string; lines: { account: string; description: string; costCenter: string | null; debitMinor: number; creditMinor: number }[] }
export interface Payslip {
  id: string;
  period: string;
  status: 'draft' | 'closed';
  packVersion: string;
  closedAt: string | null;
  company: { name: string; nif: string; inssNumber: string | null; address: string | null };
  employee: { name: string; number: string; jobTitle: string; department: string | null; nif: string | null; inssNumber: string | null; iban: string | null; bank: string | null };
  lines: PayrollLineRow['breakdown'];
  grossMinor: number;
  inssEmployeeMinor: number;
  irtMinor: number;
  netMinor: number;
  inssEmployerMinor: number;
  irtBracket: number;
  hash: string;
}
export const VARIABLE_LABEL: Record<string, string> = { bonus: 'Prémio', other_earning: 'Outro abono', advance: 'Adiantamento', other_deduction: 'Outro desconto' };
export const PAYROLL_ROLES = ['owner', 'payroll', 'finance', 'hr_admin'];
