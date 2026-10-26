/**
 * Kianda RH — modelo de dados (PostgreSQL, Drizzle ORM).
 * Regras: montantes em cêntimos de kwanza (bigint); todas as tabelas de negócio têm company_id (multi-empresa).
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint, boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);
const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ['owner', 'hr_admin', 'payroll', 'finance', 'manager', 'employee']);
export const contractTypeEnum = pgEnum('contract_type', ['indefinite', 'fixed_term', 'internship']);
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'suspended', 'terminated']);
export const absenceTypeEnum = pgEnum('absence_type', ['vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training']);
export const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected', 'cancelled']);
export const payrollStatusEnum = pgEnum('payroll_status', ['draft', 'closed']);
export const expenseStatusEnum = pgEnum('expense_status', ['pending', 'approved', 'rejected', 'paid']);
export const documentTypeEnum = pgEnum('document_type', ['bi', 'passport', 'residence_card', 'work_visa', 'driving_licence', 'professional_card', 'other']);
export const punchSourceEnum = pgEnum('punch_source', ['web', 'manual']);
export const payrollVariableKindEnum = pgEnum('payroll_variable_kind', ['bonus', 'other_earning', 'advance', 'other_deduction']);
export const bankLineStatusEnum = pgEnum('bank_line_status', ['pending', 'suggested', 'matched', 'out_of_scope']);

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  nif: text('nif').notNull().unique(),
  inssNumber: text('inss_number'),
  address: text('address'),
  caeCode: text('cae_code'),
  microOrStartup: boolean('micro_or_startup').notNull().default(false),
  bankAccountIban: text('bank_account_iban'),
  /** Jornada diária prevista (minutos), de segunda a sexta. */
  workdayMinutes: integer('workday_minutes').notNull().default(480),
  /** Mês de pagamento do subsídio de Natal (1–12). */
  christmasSubsidyMonth: integer('christmas_subsidy_month').notNull().default(12),
  /** Mês fixo do subsídio de férias (1–12); vazio = no mês em que começam as primeiras férias aprovadas do ano (Dezembro como último recurso). */
  holidaySubsidyMonth: integer('holiday_subsidy_month'),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  employeeId: text('employee_id'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_company_email').on(t.companyId, t.email)]);

export const departments = pgTable('departments', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  costCenter: text('cost_center').notNull(),
}, (t) => [uniqueIndex('departments_company_name').on(t.companyId, t.name)]);

export const employees = pgTable('employees', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  number: text('number').notNull(),
  name: text('name').notNull(),
  gender: text('gender'),
  birthDate: date('birth_date'),
  biNumber: text('bi_number'),
  nif: text('nif'),
  inssNumber: text('inss_number'),
  iban: text('iban'),
  bank: text('bank'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  nationality: text('nationality'),
  maritalStatus: text('marital_status'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  jobTitle: text('job_title').notNull(),
  departmentId: text('department_id').references(() => departments.id),
  province: text('province'),
  managerId: text('manager_id'),
  status: employeeStatusEnum('status').notNull().default('active'),
  vacationCarryOver: integer('vacation_carry_over').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('employees_company_number').on(t.companyId, t.number), index('employees_company_status').on(t.companyId, t.status)]);

export const contracts = pgTable('contracts', {
  id: id(),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  type: contractTypeEnum('type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  termJustification: text('term_justification'),
  baseMinor: money('base_minor'),
  mealMinor: money('meal_minor'),
  transportMinor: money('transport_minor'),
  otherMinor: money('other_minor'),
  otherLabel: text('other_label'),
  terminatedAt: date('terminated_at'),
  terminationReason: text('termination_reason'),
  createdAt: createdAt(),
}, (t) => [index('contracts_employee_start').on(t.employeeId, t.startDate)]);

/** Histórico de remuneração: cada alteração tem data de efeito; o processamento usa a que estiver em vigor no fim do mês. */
export const compensationChanges = pgTable('compensation_changes', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  contractId: text('contract_id').references(() => contracts.id),
  effectiveDate: date('effective_date').notNull(),
  baseMinor: money('base_minor'),
  mealMinor: money('meal_minor'),
  transportMinor: money('transport_minor'),
  reason: text('reason').notNull(),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('compensation_changes_employee_date').on(t.employeeId, t.effectiveDate)]);

/** Documentos de identificação e habilitação (metadados; o ficheiro digitalizado entra com o armazenamento de ficheiros). */
export const employeeDocuments = pgTable('employee_documents', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  type: documentTypeEnum('type').notNull(),
  number: text('number').notNull(),
  issueDate: date('issue_date'),
  expiryDate: date('expiry_date'),
  issuer: text('issuer'),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [index('employee_documents_employee').on(t.employeeId), uniqueIndex('employee_documents_company_type_number').on(t.companyId, t.type, t.number)]);

export const absences = pgTable('absences', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  type: absenceTypeEnum('type').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  workingDays: integer('working_days').notNull(),
  reason: text('reason'),
  status: requestStatusEnum('status').notNull().default('pending'),
  requestedBy: text('requested_by'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: createdAt(),
}, (t) => [index('absences_company_status').on(t.companyId, t.status), index('absences_employee_dates').on(t.employeeId, t.startDate)]);

/** Registos de ponto: cada linha é um intervalo entrada → saída (vários por dia, ex.: manhã e tarde). Horas do servidor. */
export const attendanceEntries = pgTable('attendance_entries', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  /** Data civil em Luanda a que o registo pertence. */
  workDate: date('work_date').notNull(),
  clockIn: timestamp('clock_in', { withTimezone: true }).notNull(),
  clockOut: timestamp('clock_out', { withTimezone: true }),
  source: punchSourceEnum('source').notNull().default('web'),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [index('attendance_entries_employee_date').on(t.employeeId, t.workDate), index('attendance_entries_company_date').on(t.companyId, t.workDate)]);

/** Folha de assiduidade mensal aprovada: fecha o mês e fixa as horas extra que seguem para o processamento. */
export const attendanceMonths = pgTable('attendance_months', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  period: text('period').notNull(),
  workedMinutes: integer('worked_minutes').notNull(),
  expectedMinutes: integer('expected_minutes').notNull(),
  overtimeMinutes: integer('overtime_minutes').notNull(),
  approvedOvertimeMinutes: integer('approved_overtime_minutes').notNull(),
  note: text('note'),
  approvedBy: text('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('attendance_months_employee_period').on(t.employeeId, t.period)]);

export const payrollRuns = pgTable('payroll_runs', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  period: text('period').notNull(),
  status: payrollStatusEnum('status').notNull().default('draft'),
  packVersion: text('pack_version').notNull(),
  preparedBy: text('prepared_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: text('closed_by'),
  paidSalariesAt: date('paid_salaries_at'),
  paidIrtAt: date('paid_irt_at'),
  paidInssAt: date('paid_inss_at'),
  /** Decisões manuais de subsídios por colaborador: { [employeeId]: { holiday?: boolean, christmas?: boolean } }. */
  subsidyOverrides: jsonb('subsidy_overrides').notNull().default({}),
  /** Avisos do último cálculo (assiduidade por aprovar, subsídios já pagos…). */
  warnings: jsonb('warnings').notNull().default([]),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payroll_runs_company_period').on(t.companyId, t.period)]);

export const obligationKindEnum = pgEnum('obligation_kind', ['salaries', 'inss', 'irt']);

/** Pagamentos das obrigações de um processamento (salários, INSS, IRT), com o lançamento PGC gerado. */
export const payrollPayments = pgTable('payroll_payments', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  runId: text('run_id').notNull().references(() => payrollRuns.id),
  kind: obligationKindEnum('kind').notNull(),
  paidOn: date('paid_on').notNull(),
  amountMinor: money('amount_minor'),
  reference: text('reference'),
  journalEntryId: text('journal_entry_id'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('payroll_payments_run_kind').on(t.runId, t.kind)]);

/** Variáveis do mês: prémios, outros abonos, adiantamentos e outros descontos. */
export const payrollVariables = pgTable('payroll_variables', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  period: text('period').notNull(),
  kind: payrollVariableKindEnum('kind').notNull(),
  label: text('label').notNull(),
  amountMinor: money('amount_minor'),
  /** Só para abonos: incide INSS / IRT. */
  inInss: boolean('in_inss').notNull().default(true),
  inIrt: boolean('in_irt').notNull().default(true),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('payroll_variables_company_period').on(t.companyId, t.period)]);

export const payrollLines = pgTable('payroll_lines', {
  id: id(),
  runId: text('run_id').notNull().references(() => payrollRuns.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  overtimeHours: numeric('overtime_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  absenceDays: integer('absence_days').notNull().default(0),
  bonusMinor: money('bonus_minor'),
  advancesMinor: money('advances_minor'),
  grossMinor: money('gross_minor'),
  /** Base de incidência do INSS e matéria colectável do IRT (para os mapas oficiais). */
  inssBaseMinor: money('inss_base_minor'),
  irtTaxableMinor: money('irt_taxable_minor'),
  inssEmployeeMinor: money('inss_employee_minor'),
  irtMinor: money('irt_minor'),
  netMinor: money('net_minor'),
  inssEmployerMinor: money('inss_employer_minor'),
  irtBracket: integer('irt_bracket').notNull().default(1),
  breakdown: jsonb('breakdown').notNull().default([]),
  calculationHash: text('calculation_hash'),
}, (t) => [uniqueIndex('payroll_lines_run_employee').on(t.runId, t.employeeId)]);

export const expenses = pgTable('expenses', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  category: text('category').notNull(),
  date: date('date').notNull(),
  amountMinor: money('amount_minor'),
  description: text('description').notNull(),
  status: expenseStatusEnum('status').notNull().default('pending'),
  paidAt: date('paid_at'),
  createdAt: createdAt(),
}, (t) => [index('expenses_company_status').on(t.companyId, t.status)]);

export const bankStatements = pgTable('bank_statements', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountIban: text('account_iban'),
  fileName: text('file_name').notNull(),
  importedAt: createdAt(),
});

export const bankLines = pgTable('bank_lines', {
  id: id(),
  statementId: text('statement_id').notNull().references(() => bankStatements.id),
  date: date('date').notNull(),
  description: text('description').notNull(),
  amountMinor: money('amount_minor'),
  status: bankLineStatusEnum('status').notNull().default('pending'),
  obligationKey: text('obligation_key'),
  category: text('category'),
}, (t) => [index('bank_lines_statement_status').on(t.statementId, t.status)]);

/** Correspondência entre eventos de RH e contas do PGC Angola (Decreto n.º 82/2001), parametrizável por empresa. */
export const accountMappings = pgTable('account_mappings', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  role: text('role').notNull(),
  account: text('account').notNull(),
  label: text('label').notNull(),
}, (t) => [uniqueIndex('account_mappings_company_role').on(t.companyId, t.role)]);

export const journalEntries = pgTable('journal_entries', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  date: date('date').notNull(),
  journal: text('journal').notNull(),
  reference: text('reference').notNull(),
  description: text('description').notNull(),
  source: text('source').notNull(),
  provisional: boolean('provisional').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('journal_entries_company_reference').on(t.companyId, t.reference)]);

export const journalLines = pgTable('journal_lines', {
  id: id(),
  entryId: text('entry_id').notNull().references(() => journalEntries.id),
  account: text('account').notNull(),
  description: text('description').notNull(),
  costCenter: text('cost_center'),
  debitMinor: money('debit_minor'),
  creditMinor: money('credit_minor'),
});

export const documents = pgTable('documents', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').references(() => employees.id),
  template: text('template').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  payload: jsonb('payload').notNull(),
  sha256: text('sha256').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('documents_company_employee').on(t.companyId, t.employeeId)]);

/** Registo de auditoria só de escrita: quem fez o quê, quando, com valores antes e depois. */
export const auditLogs = pgTable('audit_logs', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  at: createdAt(),
}, (t) => [index('audit_logs_entity').on(t.companyId, t.entity, t.entityId)]);

export const employeesRelations = relations(employees, ({ one, many }) => ({
  company: one(companies, { fields: [employees.companyId], references: [companies.id] }),
  department: one(departments, { fields: [employees.departmentId], references: [departments.id] }),
  contracts: many(contracts),
  absences: many(absences),
  compensation: many(compensationChanges),
  documents: many(employeeDocuments),
}));
export const compensationChangesRelations = relations(compensationChanges, ({ one }) => ({
  employee: one(employees, { fields: [compensationChanges.employeeId], references: [employees.id] }),
}));
export const employeeDocumentsRelations = relations(employeeDocuments, ({ one }) => ({
  employee: one(employees, { fields: [employeeDocuments.employeeId], references: [employees.id] }),
}));
export const contractsRelations = relations(contracts, ({ one }) => ({
  employee: one(employees, { fields: [contracts.employeeId], references: [employees.id] }),
}));
export const departmentsRelations = relations(departments, ({ many }) => ({ employees: many(employees) }));
export const payrollRunsRelations = relations(payrollRuns, ({ many }) => ({ lines: many(payrollLines) }));
export const payrollLinesRelations = relations(payrollLines, ({ one }) => ({
  run: one(payrollRuns, { fields: [payrollLines.runId], references: [payrollRuns.id] }),
  employee: one(employees, { fields: [payrollLines.employeeId], references: [employees.id] }),
}));
export const journalEntriesRelations = relations(journalEntries, ({ many }) => ({ lines: many(journalLines) }));
export const journalLinesRelations = relations(journalLines, ({ one }) => ({
  entry: one(journalEntries, { fields: [journalLines.entryId], references: [journalEntries.id] }),
}));
export const absencesRelations = relations(absences, ({ one }) => ({
  employee: one(employees, { fields: [absences.employeeId], references: [employees.id] }),
}));
