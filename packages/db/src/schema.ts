/**
 * Kianda RH — modelo de dados (PostgreSQL, Drizzle ORM).
 * Regras: montantes em cêntimos de kwanza (bigint); todas as tabelas de negócio têm company_id (multi-empresa).
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint, boolean, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex,
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
export const terminationStatusEnum = pgEnum('termination_status', ['draft', 'confirmed', 'cancelled']);
export const expenseClaimStatusEnum = pgEnum('expense_claim_status', ['draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled']);
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
  /** Diárias de ajudas de custo fixadas pela empresa (vazio = sem limite definido). */
  perDiemNationalMinor: bigint('per_diem_national_minor', { mode: 'number' }),
  perDiemInternationalMinor: bigint('per_diem_international_minor', { mode: 'number' }),
  /** Portal: declarações pedidas pelo colaborador emitidas automaticamente (sem passar pelo RH). */
  autoIssueDeclarations: boolean('auto_issue_declarations').notNull().default(false),
  /** Pagar alimentação e transporte nos dias de férias (por acordo; a regra legal é não pagar — LGT, art. 213.º, n.º 2). */
  allowancesOnVacation: boolean('allowances_on_vacation').notNull().default(false),
  /** Sector de actividade (registo) — pré-configurações por sector. */
  sector: text('sector'),
  /** Logotipo para o papel timbrado (data URL PNG/JPEG, até 300 KB). */
  logoDataUrl: text('logo_data_url'),
  /** Código curto da empresa (entrada dos colaboradores por n.º/telefone + PIN). */
  code: text('code').unique(),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  /** Opcional: colaboradores sem email entram com código da empresa + n.º/telefone + PIN. */
  email: text('email'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('employee'),
  employeeId: text('employee_id'),
  /** Acesso desactivado (ex.: colaborador cessado). */
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  phone: text('phone'),
  pinHash: text('pin_hash'),
  /** Verificação em dois passos (TOTP): segredo e data de activação (sem data = configuração por concluir). */
  totpSecret: text('totp_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_company_email').on(t.companyId, t.email)]);

/** Regimes de horário da empresa: semanal (7 dias) ou ciclo de turnos/rotação (minutos previstos por dia). */
export const workSchedules = pgTable('work_schedules', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  pattern: jsonb('pattern').$type<number[]>().notNull(),
  /** Início do ciclo por omissão (cada colaborador pode ter o seu). */
  anchorDate: date('anchor_date'),
  note: text('note'),
  /** Pré-configuração de origem (sector). */
  presetKey: text('preset_key'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('work_schedules_company_name').on(t.companyId, t.name)]);

/** Catálogo de subsídios recorrentes da empresa (turno, risco, isolamento…). */
export const allowanceTypes = pgTable('allowance_types', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  label: text('label').notNull(),
  calc: text('calc').notNull(),
  valueMinor: bigint('value_minor', { mode: 'number' }),
  bps: integer('bps'),
  inInss: boolean('in_inss').notNull().default(true),
  inIrt: boolean('in_irt').notNull().default(true),
  note: text('note'),
  presetKey: text('preset_key'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('allowance_types_company_code').on(t.companyId, t.code)]);

/** Subsídios atribuídos a cada colaborador, com vigência e valor próprio opcional. */
export const employeeAllowances = pgTable('employee_allowances', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  typeId: text('type_id').notNull().references(() => allowanceTypes.id),
  /** Vazio = valor do catálogo. */
  valueMinor: bigint('value_minor', { mode: 'number' }),
  bps: integer('bps'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('employee_allowances_employee').on(t.employeeId), index('employee_allowances_company').on(t.companyId)]);

/** Adiantamentos salariais: pedido escrito do colaborador, aprovação com plano de prestações, pagamento e reembolso (LGT, art. 248.º). */
export const salaryAdvances = pgTable('salary_advances', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  number: text('number').notNull(),
  amountMinor: money('amount_minor'),
  installments: integer('installments').notNull(),
  /** Primeiro mês de desconto (AAAA-MM). */
  firstPeriod: text('first_period').notNull(),
  reason: text('reason'),
  /** pending | approved | rejected | cancelled | paid */
  status: text('status').notNull().default('pending'),
  /** Pedido escrito do trabalhador (art. 248.º, n.º 6): quem pediu e quando confirmou. */
  requestedBy: text('requested_by').notNull(),
  writtenRequestAt: timestamp('written_request_at', { withTimezone: true }).notNull(),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  paidOn: date('paid_on'),
  paidBy: text('paid_by'),
  bankAccountId: text('bank_account_id'),
  journalEntryId: text('journal_entry_id'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('salary_advances_company_number').on(t.companyId, t.number), index('salary_advances_employee').on(t.employeeId)]);

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
  /** Regime de horário (vazio = horário normal da empresa, segunda a sexta) e início do ciclo próprio (turnos/rotação por equipa). */
  scheduleId: text('schedule_id'),
  scheduleAnchor: date('schedule_anchor'),
  /** Lei 22/11: dados pessoais não obrigatórios eliminados (ex-colaborador); ficam só os exigidos por lei. */
  dataMinimizedAt: timestamp('data_minimized_at', { withTimezone: true }),
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

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });

/**
 * Ficheiros anexados (cópias digitalizadas de documentos, justificativos de ausências, comprovativos de despesas).
 * O conteúdo fica no R2 (storage = 'r2') ou, sem R2 configurado, na própria base de dados (storage = 'db', em file_blobs).
 */
export const files = pgTable('files', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  /** employee | employee_document | absence | expense_claim */
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  /** Colaborador a quem o ficheiro diz respeito (permissões e minimização de dados). */
  employeeId: text('employee_id'),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storage: text('storage').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('files_entity').on(t.companyId, t.entity, t.entityId), index('files_employee').on(t.employeeId)]);

export const fileBlobs = pgTable('file_blobs', {
  fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => companies.id),
  data: bytea('data').notNull(),
});

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
  /** Parte do extra em dias de descanso/feriado (paga à parte), minutos de descanso a pagar (mín. 3 h/dia) e feriados trabalhados. */
  restHolidayOvertimeMinutes: integer('rest_holiday_overtime_minutes').notNull().default(0),
  restDayPaidMinutes: integer('rest_day_paid_minutes').notNull().default(0),
  holidayWorkDays: integer('holiday_work_days').notNull().default(0),
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
  /** Conciliação bancária: conta usada e correspondência com o extracto. */
  bankAccountId: text('bank_account_id'),
  matchId: text('match_id'),
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
  /** Código da rubrica no recibo (cessação: FERNG, COMP, AVISO…); vazio = BONUS/OUTABON/ADIANT/OUTDESC pelo tipo. */
  code: text('code'),
  /** Variáveis geradas por uma cessação (apagadas se a cessação for anulada). */
  terminationId: text('termination_id'),
  /** Prestação de reembolso de um adiantamento salarial. */
  advanceId: text('advance_id'),
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

/** Ligações de acesso: convite (cria o utilizador) ou recuperação (redefine palavra-passe/PIN). Só o hash do token é guardado. */
export const accessLinks = pgTable('access_links', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  /** invite | reset */
  kind: text('kind').notNull(),
  userId: text('user_id'),
  employeeId: text('employee_id'),
  name: text('name'),
  role: text('role').notNull().default('employee'),
  email: text('email'),
  phone: text('phone'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('access_links_company').on(t.companyId)]);

/** Notificações de pagamento recebidas do gateway (idempotência e auditoria). */
export const gatewayEvents = pgTable('gateway_events', {
  id: id(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  reference: text('reference'),
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  payload: jsonb('payload').notNull(),
  /** applied | duplicate | unmatched | amount_mismatch | not_pending */
  outcome: text('outcome').notNull(),
  paymentRequestId: text('payment_request_id'),
  message: text('message'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('gateway_events_provider_external').on(t.provider, t.externalId)]);

/** Emails enviados (ou não enviados por falta de configuração), com chave para não repetir avisos. */
export const outboundEmails = pgTable('outbound_emails', {
  id: id(),
  companyId: text('company_id'),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull(),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').unique(),
  /** sent | skipped | failed */
  status: text('status').notNull(),
  provider: text('provider'),
  providerId: text('provider_id'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('outbound_emails_created').on(t.createdAt)]);

/** Licença da empresa (uma por empresa). */
export const subscriptions = pgTable('subscriptions', {
  companyId: text('company_id').primaryKey().references(() => companies.id),
  /** trial | active | suspended | cancelled (atraso e só leitura por falta de pagamento são calculados). */
  status: text('status').notNull().default('trial'),
  tierKey: text('tier_key').notNull().default('t1'),
  cycle: text('cycle').notNull().default('monthly'),
  trialEndsAt: date('trial_ends_at'),
  paidUntil: date('paid_until'),
  extraSeats: integer('extra_seats').notNull().default(0),
  /** Escalão à medida: limite e preço mensal negociados. */
  customMaxEmployees: integer('custom_max_employees'),
  customMonthlyMinor: bigint('custom_monthly_minor', { mode: 'number' }),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Pedidos de pagamento (pró-forma): a factura fiscal é emitida em software certificado e o n.º fica registado. */
export const paymentRequests = pgTable('payment_requests', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  number: text('number').notNull().unique(),
  /** subscription | extra_seats */
  kind: text('kind').notNull(),
  tierKey: text('tier_key'),
  cycle: text('cycle'),
  seats: integer('seats'),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  grossMinor: money('gross_minor'),
  discountMinor: money('discount_minor'),
  amountMinor: money('amount_minor'),
  /** pending | paid | cancelled */
  status: text('status').notNull().default('pending'),
  payerReference: text('payer_reference'),
  payerNote: text('payer_note'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  confirmedBy: text('confirmed_by'),
  invoiceRef: text('invoice_ref'),
  /** Multicaixa (gateway): entidade e referência a pagar, validade e último erro do gateway. */
  gateway: text('gateway'),
  gatewayEntity: text('gateway_entity'),
  gatewayReference: text('gateway_reference'),
  gatewayExpiresAt: date('gateway_expires_at'),
  gatewayError: text('gateway_error'),
  /** Como foi confirmado: manual | gateway. */
  confirmedVia: text('confirmed_via'),
  /** Factura certificada emitida no software de facturação (ex.: Vendus): id externo, data e erro. */
  invoiceProvider: text('invoice_provider'),
  invoiceExternalId: text('invoice_external_id'),
  invoiceIssuedAt: timestamp('invoice_issued_at', { withTimezone: true }),
  invoiceError: text('invoice_error'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('payment_requests_company').on(t.companyId), index('payment_requests_status').on(t.status)]);

/** Administradores da plataforma (consola Kianda) — definidos pela variável KIANDA_PLATFORM_ADMINS na publicação. */
export const platformAdmins = pgTable('platform_admins', { email: text('email').primaryKey(), createdAt: createdAt() });

/** Parâmetros comerciais da plataforma (escalões, preço por colaborador extra, dados bancários). */
export const platformSettings = pgTable('platform_settings', { key: text('key').primaryKey(), value: jsonb('value').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });

/** Portal do colaborador: pedidos de declarações. */
export const documentRequests = pgTable('document_requests', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  templateKey: text('template_key').notNull(),
  inputs: jsonb('inputs').notNull().default({}),
  /** pending | issued | rejected | cancelled */
  status: text('status').notNull().default('pending'),
  documentId: text('document_id'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('document_requests_company_status').on(t.companyId, t.status), index('document_requests_employee').on(t.employeeId)]);

/** Portal do colaborador: pedidos de alteração de dados pessoais (aprovados pelo RH; o IBAN nunca muda sem aprovação). */
export const profileChangeRequests = pgTable('profile_change_requests', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  changes: jsonb('changes').notNull(),
  previous: jsonb('previous').notNull(),
  note: text('note'),
  /** pending | approved | rejected | cancelled */
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('profile_change_requests_company_status').on(t.companyId, t.status), index('profile_change_requests_employee').on(t.employeeId)]);

/** Vagas de recrutamento. */
export const jobOpenings = pgTable('job_openings', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  title: text('title').notNull(),
  departmentId: text('department_id'),
  /** Chefia responsável pela contratação (ficha do colaborador). */
  hiringManagerId: text('hiring_manager_id'),
  location: text('location'),
  contractType: text('contract_type').notNull().default('indefinite'),
  positions: integer('positions').notNull().default(1),
  salaryMinMinor: bigint('salary_min_minor', { mode: 'number' }),
  salaryMaxMinor: bigint('salary_max_minor', { mode: 'number' }),
  description: text('description'),
  requirements: text('requirements'),
  /** draft | open | on_hold | closed */
  status: text('status').notNull().default('draft'),
  /** Publicada na página de carreiras. */
  isPublic: boolean('is_public').notNull().default(false),
  closesOn: date('closes_on'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [index('job_openings_company_status').on(t.companyId, t.status)]);

export const candidates = pgTable('candidates', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  openingId: text('opening_id').notNull().references(() => jobOpenings.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  source: text('source').notNull().default('other'),
  stage: text('stage').notNull().default('applied'),
  rating: integer('rating'),
  cvUrl: text('cv_url'),
  coverLetter: text('cover_letter'),
  expectedSalaryMinor: bigint('expected_salary_minor', { mode: 'number' }),
  availableFrom: date('available_from'),
  rejectionReason: text('rejection_reason'),
  employeeId: text('employee_id'),
  hiredAt: timestamp('hired_at', { withTimezone: true }),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('candidates_opening_stage').on(t.openingId, t.stage), index('candidates_company').on(t.companyId)]);

/** Histórico do candidato: mudanças de etapa, comentários e entrevistas. */
export const candidateEvents = pgTable('candidate_events', {
  id: id(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  /** stage | comment | interview */
  kind: text('kind').notNull(),
  fromStage: text('from_stage'),
  toStage: text('to_stage'),
  text: text('text'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  createdAt: createdAt(),
}, (t) => [index('candidate_events_candidate').on(t.candidateId)]);

/** Ciclos de avaliação de desempenho. */
export const reviewCycles = pgTable('review_cycles', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  deadline: date('deadline'),
  /** draft | open | closed */
  status: text('status').notNull().default('draft'),
  selfReview: boolean('self_review').notNull().default(true),
  competencies: jsonb('competencies').notNull().default([]),
  /** Peso das competências na nota final (o resto é dos objectivos). */
  competencyWeight: integer('competency_weight').notNull().default(60),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  launchedAt: timestamp('launched_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [index('review_cycles_company').on(t.companyId)]);

export const reviews = pgTable('reviews', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  cycleId: text('cycle_id').notNull().references(() => reviewCycles.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  /** Avaliador (ficha da chefia); vazio = RH. */
  reviewerEmployeeId: text('reviewer_employee_id'),
  /** self | manager | acknowledgement | done */
  status: text('status').notNull().default('self'),
  objectives: jsonb('objectives').notNull().default([]),
  selfScores: jsonb('self_scores').notNull().default({}),
  selfComment: text('self_comment'),
  selfSubmittedAt: timestamp('self_submitted_at', { withTimezone: true }),
  managerScores: jsonb('manager_scores').notNull().default({}),
  managerComment: text('manager_comment'),
  recommendation: text('recommendation'),
  finalScore: numeric('final_score', { precision: 4, scale: 2 }),
  managerSubmittedAt: timestamp('manager_submitted_at', { withTimezone: true }),
  managerSubmittedBy: text('manager_submitted_by'),
  employeeComment: text('employee_comment'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('reviews_cycle_employee').on(t.cycleId, t.employeeId), index('reviews_reviewer').on(t.reviewerEmployeeId)]);

/** Modelos de documentos adaptados pela empresa: cada gravação é uma nova versão (a última activa substitui o modelo do Kianda). */
export const documentTemplates = pgTable('document_templates', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  key: text('key').notNull(),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Versão do pacote/modelo do Kianda de que partiu. */
  basedOn: text('based_on'),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('document_templates_company_key_version').on(t.companyId, t.key, t.version)]);

/** Documentos emitidos: texto final congelado, numeração anual e código de verificação público. */
export const issuedDocuments = pgTable('issued_documents', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  number: text('number').notNull(),
  templateKey: text('template_key').notNull(),
  templateVersion: text('template_version').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  inputs: jsonb('inputs').notNull().default({}),
  verificationCode: text('verification_code').notNull(),
  issuedBy: text('issued_by').notNull(),
  issuedAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
  revokeNote: text('revoke_note'),
}, (t) => [uniqueIndex('issued_documents_company_number').on(t.companyId, t.number), uniqueIndex('issued_documents_code').on(t.verificationCode), index('issued_documents_employee').on(t.employeeId)]);

/** Cessação do contrato: motivo, aviso prévio, fecho de contas proposto/ajustado e confirmação. */
export const terminations = pgTable('terminations', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  contractId: text('contract_id').notNull(),
  reason: text('reason').notNull(),
  noticeDate: date('notice_date'),
  effectiveDate: date('effective_date').notNull(),
  period: text('period').notNull(),
  status: terminationStatusEnum('status').notNull().default('draft'),
  agreedCompensationMinor: bigint('agreed_compensation_minor', { mode: 'number' }),
  /** Linhas do fecho de contas (propostas pelo motor e eventualmente ajustadas). */
  items: jsonb('items').notNull().default([]),
  /** Antiguidade, aviso prévio, notas do motor no momento da proposta. */
  proposal: jsonb('proposal').notNull().default({}),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  cancelledBy: text('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelNote: text('cancel_note'),
}, (t) => [index('terminations_company').on(t.companyId), index('terminations_employee').on(t.employeeId)]);

/** Nota de despesas: despesas documentadas e ajudas de custo de uma deslocação ou período. */
export const expenseClaims = pgTable('expense_claims', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  number: text('number').notNull(),
  title: text('title').notNull(),
  tripFrom: date('trip_from'),
  tripTo: date('trip_to'),
  status: expenseClaimStatusEnum('status').notNull().default('draft'),
  totalMinor: money('total_minor'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  approvalJournalId: text('approval_journal_id'),
  paidOn: date('paid_on'),
  paidReference: text('paid_reference'),
  paymentJournalId: text('payment_journal_id'),
  bankAccountId: text('bank_account_id'),
  matchId: text('match_id'),
}, (t) => [uniqueIndex('expense_claims_company_number').on(t.companyId, t.number), index('expense_claims_company_status').on(t.companyId, t.status), index('expense_claims_employee').on(t.employeeId)]);

export const expenseLines = pgTable('expense_lines', {
  id: id(),
  claimId: text('claim_id').notNull().references(() => expenseClaims.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  /** expense | per_diem */
  kind: text('kind').notNull(),
  date: date('date').notNull(),
  description: text('description').notNull(),
  category: text('category'),
  documentRef: text('document_ref'),
  supplierNif: text('supplier_nif'),
  zone: text('zone'),
  /** Dias × 2 (meios dias). */
  halfDays: integer('half_days'),
  rateMinor: bigint('rate_minor', { mode: 'number' }),
  amountMinor: money('amount_minor'),
}, (t) => [index('expense_lines_claim').on(t.claimId)]);

/** Contas bancárias da empresa usadas para pagar salários e obrigações (cada uma com a sua conta PGC da classe 4). */
export const bankAccounts = pgTable('bank_accounts', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  bankName: text('bank_name'),
  iban: text('iban'),
  ledgerAccount: text('ledger_account').notNull().default('43.1'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index('bank_accounts_company').on(t.companyId)]);

export const bankStatements = pgTable('bank_statements', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountId: text('account_id').references(() => bankAccounts.id),
  accountIban: text('account_iban'),
  fileName: text('file_name').notNull(),
  importedAt: createdAt(),
  importedBy: text('imported_by'),
  fromDate: date('from_date'),
  toDate: date('to_date'),
  lineCount: integer('line_count').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  openingBalanceMinor: bigint('opening_balance_minor', { mode: 'number' }),
  closingBalanceMinor: bigint('closing_balance_minor', { mode: 'number' }),
  /** null = extracto sem coluna de saldo. */
  balanceOk: boolean('balance_ok'),
});

/** Correspondência entre movimentos bancários e pagamentos registados (um pagamento pode ter vários movimentos). */
export const bankMatches = pgTable('bank_matches', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountId: text('account_id').notNull().references(() => bankAccounts.id),
  /** auto | manual */
  kind: text('kind').notNull(),
  rule: text('rule'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
});

export const bankLines = pgTable('bank_lines', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountId: text('account_id').notNull().references(() => bankAccounts.id),
  statementId: text('statement_id').notNull().references(() => bankStatements.id),
  date: date('date').notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  amountMinor: money('amount_minor'),
  balanceMinor: bigint('balance_minor', { mode: 'number' }),
  fingerprint: text('fingerprint').notNull(),
  /** pending = por conciliar; matched = conciliado; out_of_scope = não é de pessoal (ignorado com nota). */
  status: bankLineStatusEnum('status').notNull().default('pending'),
  matchId: text('match_id').references(() => bankMatches.id),
  note: text('note'),
  obligationKey: text('obligation_key'),
  category: text('category'),
  createdAt: createdAt(),
}, (t) => [index('bank_lines_statement_status').on(t.statementId, t.status), index('bank_lines_account_status').on(t.accountId, t.status), index('bank_lines_account_fp').on(t.accountId, t.fingerprint)]);

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
  /** Quando foi exportado para o ERP (evita importar duas vezes). */
  exportedAt: timestamp('exported_at', { withTimezone: true }),
  exportedBy: text('exported_by'),
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
