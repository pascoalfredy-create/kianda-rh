/**
 * Kianda RH — modelo de dados (PostgreSQL, Drizzle ORM).
 * Regras: montantes em cêntimos de kwanza (bigint); todas as tabelas de negócio têm company_id (multi-empresa).
 */
import { relations, sql } from 'drizzle-orm';
import type { AtsCriterion, CandidateProfile } from '@kianda/core';
import {
  bigint, boolean, customType, date, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);
const id = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ['owner', 'hr_admin', 'payroll', 'finance', 'manager', 'employee']);
export const contractTypeEnum = pgEnum('contract_type', ['indefinite', 'fixed_term', 'internship']);
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'suspended', 'terminated']);
export const absenceTypeEnum = pgEnum('absence_type', ['vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training', 'unpaid_leave']);
export const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected', 'cancelled']);
export const payrollStatusEnum = pgEnum('payroll_status', ['draft', 'closed']);
export const terminationStatusEnum = pgEnum('termination_status', ['draft', 'confirmed', 'cancelled']);
export const expenseClaimStatusEnum = pgEnum('expense_claim_status', ['draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled']);
export const documentTypeEnum = pgEnum('document_type', ['bi', 'passport', 'residence_card', 'work_visa', 'driving_licence', 'professional_card', 'other']);
export const punchSourceEnum = pgEnum('punch_source', ['web', 'manual', 'offline']);
export const payrollVariableKindEnum = pgEnum('payroll_variable_kind', ['bonus', 'other_earning', 'advance', 'other_deduction']);
export const bankLineStatusEnum = pgEnum('bank_line_status', ['pending', 'suggested', 'matched', 'out_of_scope']);

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  nif: text('nif').notNull().unique(),
  inssNumber: text('inss_number'),
  address: text('address'),
  /** Sede (mapa de remunerações da AGT): usados quando a ficha do colaborador não indica outro local de trabalho. */
  province: text('province'),
  municipality: text('municipality'),
  /** Ficheiro de transferências dos salários: nib (NOME, NIB, VALOR — regra comum), generic (CSV com IBAN), bfa ou bai. */
  bankFileProfile: text('bank_file_profile').notNull().default('nib'),
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
  /** Ponto com localização: off | record | alert | block (ver core/geofence.ts). */
  punchLocationMode: text('punch_location_mode').notNull().default('record'),
  /** Planeamento de turnos: intervalo mínimo entre o fim de um turno e o início do seguinte (minutos). */
  shiftMinRestMinutes: integer('shift_min_rest_minutes').notNull().default(600),
  /** Pagar alimentação e transporte nos dias de férias (por acordo; a regra legal é não pagar — LGT, art. 213.º, n.º 2). */
  allowancesOnVacation: boolean('allowances_on_vacation').notNull().default(false),
  /** Pagar alimentação e transporte nos dias de falta injustificada (por omissão não: só dias trabalhados). */
  allowancesOnAbsence: boolean('allowances_on_absence').notNull().default(false),
  /** Atrasos e saídas antecipadas descontados como faltas em horas (como no Primavera), com tolerância diária. */
  discountLateness: boolean('discount_lateness').notNull().default(true),
  latenessToleranceMinutes: integer('lateness_tolerance_minutes').notNull().default(0),
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
  /** Novos proprietários confirmam o email antes de entrar nos módulos; acessos anteriores mantêm-se. */
  emailVerificationRequired: boolean('email_verification_required').notNull().default(false),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
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
  /** Versão das sessões: incrementa ao mudar a palavra-passe ou ao terminar todas as sessões (tokens antigos deixam de valer). */
  sessionVersion: integer('session_version').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_company_email').on(t.companyId, t.email)]);

/** Confirmações de email: só se guarda o hash do token; cada ligação é de uso único. */
export const emailVerifications = pgTable('email_verifications', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('email_verifications_company').on(t.companyId), uniqueIndex('email_verifications_token_hash').on(t.tokenHash), index('email_verifications_user_created').on(t.userId, t.createdAt)]);

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

/** Orçamento de pessoal do ano (um por empresa e ano): hipóteses usadas e estado (rascunho / aprovado). */
export const personnelBudgets = pgTable('personnel_budgets', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  year: integer('year').notNull(),
  /** draft | approved */
  status: text('status').notNull().default('draft'),
  assumptions: jsonb('assumptions').notNull().default({}),
  notes: text('notes'),
  createdBy: text('created_by').notNull(),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('personnel_budgets_company_year').on(t.companyId, t.year)]);

/** Pressupostos da tesouraria de pessoal; independentes do orçamento e do módulo Integra. */
export const personnelCashPlans = pgTable('personnel_cash_plans', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  period: text('period').notNull(),
  openingMinor: bigint('opening_minor', { mode: 'number' }).notNull().default(0),
  receipts: jsonb('receipts').$type<Record<string, number>>().notNull().default({}),
  revision: integer('revision').notNull().default(1),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('personnel_cash_plans_company_period').on(t.companyId, t.period)]);

/** Células do orçamento: custo com pessoal (ilíquido + INSS da empresa) e efectivo previstos por mês e departamento. */
export const personnelBudgetLines = pgTable('personnel_budget_lines', {
  id: id(),
  budgetId: text('budget_id').notNull().references(() => personnelBudgets.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => companies.id),
  /** Vazio = sem departamento. */
  departmentId: text('department_id'),
  period: text('period').notNull(),
  headcount: numeric('headcount', { precision: 8, scale: 1 }).notNull().default('0'),
  grossMinor: money('gross_minor'),
  costMinor: money('cost_minor'),
}, (t) => [index('personnel_budget_lines_company_period').on(t.companyId, t.period), index('personnel_budget_lines_budget').on(t.budgetId)]);

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
  /** Município do local de trabalho (mapa de remunerações da AGT). Vazio = o da sede da empresa. */
  municipality: text('municipality'),
  managerId: text('manager_id'),
  status: employeeStatusEnum('status').notNull().default('active'),
  vacationCarryOver: integer('vacation_carry_over').notNull().default(0),
  /** Regime de horário (vazio = horário normal da empresa, segunda a sexta) e início do ciclo próprio (turnos/rotação por equipa). */
  scheduleId: text('schedule_id'),
  scheduleAnchor: date('schedule_anchor'),
  /** Local de trabalho para o ponto com localização (vazio = qualquer local activo da empresa). */
  workplaceId: text('workplace_id'),
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
  /** AOA, ou USD = salário base indexado ao dólar (convertido ao câmbio do dia do processamento; base_minor = referência em Kz). */
  salaryCurrency: text('salary_currency').notNull().default('AOA'),
  baseForeignMinor: bigint('base_foreign_minor', { mode: 'number' }),
  /** Remuneração conhecida desde a migração; null para vínculos com base conhecida desde o início. */
  salaryKnownFrom: date('salary_known_from'),
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
  salaryCurrency: text('salary_currency').notNull().default('AOA'),
  baseForeignMinor: bigint('base_foreign_minor', { mode: 'number' }),
  reason: text('reason').notNull(),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, (t) => [index('compensation_changes_company_employee').on(t.companyId, t.employeeId), uniqueIndex('compensation_changes_employee_date').on(t.employeeId, t.effectiveDate)]);

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
}, (t) => [index('file_blobs_company').on(t.companyId)]);

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
/** Locais de trabalho para o ponto com localização (raio) e quiosque com código rotativo. */
export const workplaces = pgTable('workplaces', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  radiusMeters: integer('radius_meters').notNull().default(150),
  active: boolean('active').notNull().default(true),
  /** Segredo do código rotativo e token do endereço do quiosque (vazios = quiosque desligado). */
  kioskSecret: text('kiosk_secret'),
  kioskToken: text('kiosk_token').unique(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('workplaces_company').on(t.companyId)]);

/** Acolhimento e saída: um modelo por tipo e empresa; as tarefas do modelo ficam em JSON validado no core. */
export const checklistTemplates = pgTable('checklist_templates', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  /** onboarding | offboarding */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  /** Cria a lista automaticamente na admissão (acolhimento) ou ao registar a cessação (saída). */
  autoStart: boolean('auto_start').notNull().default(true),
  items: jsonb('items').$type<{ title: string; description?: string; responsible: string; offsetDays: number; link?: string }[]>().notNull().default([]),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('checklist_templates_company_kind').on(t.companyId, t.kind)]);

/** Lista de um colaborador (cópia do modelo no momento em que começa; mudar o modelo não altera listas em curso). */
export const employeeChecklists = pgTable('employee_checklists', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  /** Início do contrato (acolhimento) ou data da cessação (saída). */
  referenceDate: date('reference_date').notNull(),
  /** open | completed | cancelled */
  status: text('status').notNull().default('open'),
  terminationId: text('termination_id').references(() => terminations.id),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
}, (t) => [index('employee_checklists_company').on(t.companyId, t.status), index('employee_checklists_employee').on(t.employeeId)]);

export const checklistTasks = pgTable('checklist_tasks', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  checklistId: text('checklist_id').notNull().references(() => employeeChecklists.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  /** hr | manager | employee | finance */
  responsible: text('responsible').notNull(),
  dueDate: date('due_date').notNull(),
  /** Evento que fecha a tarefa sozinho (ex.: «regulamento» = aceitação do regulamento interno no portal). */
  linkKey: text('link_key'),
  doneAt: timestamp('done_at', { withTimezone: true }),
  doneBy: text('done_by'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [index('checklist_tasks_checklist').on(t.checklistId, t.position), index('checklist_tasks_pending').on(t.companyId, t.dueDate).where(sql`done_at is null`)]);

/** Planeamento de turnos: tipos de turno da empresa (código curto, horas, intervalo, cobertura mínima). */
export const shiftTypes = pgTable('shift_types', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  breakMinutes: integer('break_minutes').notNull().default(0),
  color: text('color').notNull().default('blue'),
  /** Pessoas mínimas por dia neste turno (null = sem mínimo). */
  minStaff: integer('min_staff'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('shift_types_company_code').on(t.companyId, t.code)]);

/**
 * Escala: um registo por colaborador e dia. O planeamento (kind/shift_type_id) é o rascunho; os campos pub_* são o que
 * foi publicado (o colaborador só vê esses e o ponto usa-os). kind «none» = retirar um dia já publicado.
 */
export const shiftAssignments = pgTable('shift_assignments', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  workDate: date('work_date').notNull(),
  /** shift | off | none */
  kind: text('kind').notNull(),
  shiftTypeId: text('shift_type_id').references(() => shiftTypes.id),
  /** Publicado: shift | off (null = nunca publicado). Horas guardadas para não mudarem com o tipo de turno. */
  pubKind: text('pub_kind'),
  pubShiftTypeId: text('pub_shift_type_id').references(() => shiftTypes.id),
  pubCode: text('pub_code'),
  pubName: text('pub_name'),
  pubStartTime: text('pub_start_time'),
  pubEndTime: text('pub_end_time'),
  pubBreakMinutes: integer('pub_break_minutes'),
  pubColor: text('pub_color'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: text('published_by'),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('shift_assignments_employee_date').on(t.employeeId, t.workDate), index('shift_assignments_company_date').on(t.companyId, t.workDate)]);

/**
 * Aceitação electrónica: documento publicado para leitura e aceitação (regulamento, políticas, avisos).
 * Depois de publicado o conteúdo fica congelado (impressão digital); uma alteração é uma nova versão.
 */
export const ackDocuments = pgTable('ack_documents', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  category: text('category').notNull(),
  version: integer('version').notNull().default(1),
  /** Versão anterior (a nova versão substitui-a e anula os pedidos ainda por aceitar). */
  previousId: text('previous_id'),
  /** draft | published | archived */
  status: text('status').notNull().default('draft'),
  audience: jsonb('audience').$type<{ all: boolean; departmentIds: string[]; employeeIds: string[] }>().notNull(),
  dueDate: date('due_date'),
  contentSha256: text('content_sha256'),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: text('published_by'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [index('ack_documents_company').on(t.companyId, t.status)]);

/** Um pedido por colaborador e documento; a aceitação guarda a prova (quem, quando, de onde, que conteúdo). */
export const ackRequests = pgTable('ack_requests', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  documentId: text('document_id').notNull().references(() => ackDocuments.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  /** pending | accepted | cancelled */
  status: text('status').notNull().default('pending'),
  createdAt: createdAt(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: text('accepted_by'),
  acceptedIp: text('accepted_ip'),
  acceptedUserAgent: text('accepted_user_agent'),
  /** Impressão digital do conteúdo que o colaborador tinha no ecrã ao aceitar (igual à do documento publicado). */
  acceptedSha256: text('accepted_sha256'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (t) => [index('ack_requests_company_status').on(t.companyId, t.status), uniqueIndex('ack_requests_document_employee').on(t.documentId, t.employeeId), index('ack_requests_employee').on(t.employeeId, t.status)]);

/** Notificações no telemóvel: uma subscrição Web Push por dispositivo e utilizador (o navegador cria as chaves). */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  failures: integer('failures').notNull().default(0),
}, (t) => [index('push_subscriptions_company_user').on(t.companyId, t.userId), index('push_subscriptions_user').on(t.userId)]);

/** Caixa de saída: o evento grava a notificação na mesma transacção; o envio acontece depois da resposta. */
export const pushOutbox = pgTable('push_outbox', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  payload: jsonb('payload').$type<{ title: string; body: string; url: string; tag?: string }>().notNull(),
  createdAt: createdAt(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
}, (t) => [index('push_outbox_company_user').on(t.companyId, t.userId), index('push_outbox_pending').on(t.createdAt).where(sql`sent_at is null`)]);

/** Localização registada numa marcação (só no instante da marcação). */
export interface PunchLocationRecord {
  status: 'ok' | 'outside' | 'unavailable' | 'no_workplace';
  method: 'gps' | 'kiosk' | 'none';
  lat?: number; lng?: number; accuracy?: number;
  workplaceId: string | null; workplaceName: string | null; distance: number | null;
  mode: 'record' | 'alert' | 'block';
  capturedAt: string;
  /** Identificador aleatório do telemóvel/navegador (não pessoal): detecta um aparelho a marcar por vários colegas. */
  device?: string;
  /** País da rede (Cloudflare), para detectar marcações a partir do estrangeiro/VPN. */
  country?: string;
  /** Sinais de fraude: shared_device (aparelho usado por outro colaborador no mesmo dia), foreign_network. */
  signals?: ('shared_device' | 'foreign_network')[];
}

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
  /** Registo feito sem rede na app: referência gerada no telemóvel (evita duplicar no reenvio). */
  clientRef: text('client_ref'),
  /** Saída registada sem rede (hora do telemóvel) — a validar pela chefia. */
  offlineOut: boolean('offline_out').notNull().default(false),
  clockInLocation: jsonb('clock_in_location').$type<PunchLocationRecord>(),
  clockOutLocation: jsonb('clock_out_location').$type<PunchLocationRecord>(),
  /** Marcação aceite com problema de localização (regras alertar/bloquear) — para a lista de excepções da chefia. */
  locationIssue: boolean('location_issue').notNull().default(false),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [index('attendance_entries_employee_date').on(t.employeeId, t.workDate), index('attendance_entries_company_date').on(t.companyId, t.workDate), uniqueIndex('attendance_entries_client_ref').on(t.employeeId, t.clientRef)]);

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
  /** Atrasos e saídas antecipadas do mês (minutos, já descontada a tolerância diária): faltas em horas. */
  shortfallMinutes: integer('shortfall_minutes').notNull().default(0),
  note: text('note'),
  approvedBy: text('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('attendance_months_company_period').on(t.companyId, t.period), uniqueIndex('attendance_months_employee_period').on(t.employeeId, t.period)]);

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
  /** Câmbio USD→Kz do dia do processamento (salários indexados): taxa, data e fonte. */
  fxRate: numeric('fx_rate', { precision: 14, scale: 6 }),
  fxDate: date('fx_date'),
  fxSource: text('fx_source'),
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
}, (t) => [index('payroll_payments_company').on(t.companyId), uniqueIndex('payroll_payments_run_kind').on(t.runId, t.kind)]);

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

export interface PayslipContext {
  company: { name: string; nif: string; inssNumber: string | null; address: string | null };
  employee: {
    name: string; number: string; jobTitle: string; department: string | null; nif: string | null;
    inssNumber: string | null; iban: string | null; bank: string | null;
  };
  leave: { type: string; label: string; startDate: string; endDate: string; workingDays: number }[];
  termination: { reasonLabel: string; hireDate: string | null; noticeDate: string | null; effectiveDate: string; seniority: string | null } | null;
}

/** Identificadores irreversíveis de sessões terminadas, só até à expiração do token. */
export const revokedSessions = pgTable('revoked_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('revoked_sessions_expiry').on(t.expiresAt)]);

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
  /** Dados apresentados no recibo, registados na transacção do fecho. */
  payslipContext: jsonb('payslip_context').$type<PayslipContext>(),
  /** Departamento e centro de custo no momento do cálculo: o histórico não muda quando a ficha muda de departamento. */
  departmentId: text('department_id'),
  costCenter: text('cost_center'),
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
}, (t) => [index('outbound_emails_company_created').on(t.companyId, t.createdAt), index('outbound_emails_created').on(t.createdAt)]);

/** Licença da empresa (uma por empresa). */
export const subscriptions = pgTable('subscriptions', {
  companyId: text('company_id').primaryKey().references(() => companies.id),
  /** trial | active | suspended | cancelled (atraso e só leitura por falta de pagamento são calculados). */
  status: text('status').notNull().default('trial'),
  tierKey: text('tier_key').notNull().default('t1'),
  cycle: text('cycle').notNull().default('monthly'),
  trialEndsAt: date('trial_ends_at'),
  paidUntil: date('paid_until'),
  /** Histórico de extras do antigo regime RH; não altera o limite das faixas fixas. */
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
  /** subscription (RH) | modeling_subscription | valuation_subscription. extra_seats só em registos históricos. */
  kind: text('kind').notNull(),
  tierKey: text('tier_key'),
  cycle: text('cycle'),
  seats: integer('seats'),
  projectLimit: integer('project_limit'),
  extraUsers: integer('extra_users'),
  primarySector: text('primary_sector'),
  modelingSectors: jsonb('modeling_sectors').$type<import('@kianda/core').FinancialSector[]>(),
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

/** Visitas ao site público, sem cookies: «visitor» é um hash diário (IP + navegador + segredo), irreversível e diferente a cada dia. */
export const siteVisits = pgTable('site_visits', {
  day: date('day').notNull(),
  path: text('path').notNull(),
  visitor: text('visitor').notNull(),
  referrer: text('referrer'),
  source: text('source'),
  country: text('country'),
  device: text('device').notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.day, t.path, t.visitor], name: 'site_visits_pk' }), index('site_visits_day_idx').on(t.day)]);

/** Parâmetros comerciais da plataforma (dados bancários e contactos de suporte). */
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
  atsCriteria: jsonb('ats_criteria').$type<AtsCriterion[]>().notNull().default([]),
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
  profile: jsonb('profile').$type<CandidateProfile>().notNull().default({}),
  cvText: text('cv_text'),
  cvTextSource: text('cv_text_source'),
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

/** Propostas versionadas: não alteram automaticamente o salário nem admitem o candidato. */
export const recruitmentOffers = pgTable('recruitment_offers', {
  id: id(), companyId: text('company_id').notNull().references(() => companies.id),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), kind: text('kind').notNull(),
  baseMinor: money('base_minor'), mealMinor: money('meal_minor'), transportMinor: money('transport_minor'),
  expectedSalaryMinor: bigint('expected_salary_minor', { mode: 'number' }),
  startDate: date('start_date'), validUntil: date('valid_until').notNull(),
  terms: text('terms').notNull().default(''),
  status: text('status').notNull().default('draft'),
  responseNote: text('response_note'), counterMinor: bigint('counter_minor', { mode: 'number' }),
  createdBy: text('created_by').notNull(), createdAt: createdAt(), sentAt: timestamp('sent_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, t => [uniqueIndex('recruitment_offers_candidate_version').on(t.candidateId, t.version), index('recruitment_offers_company').on(t.companyId)]);

/** Caixa de saída transaccional; payload privado e removido na eliminação da candidatura. */
export const recruitmentMail = pgTable('recruitment_mail', {
  id: id(), companyId: text('company_id').notNull().references(() => companies.id),
  candidateId: text('candidate_id').notNull().references(() => candidates.id, { onDelete: 'cascade' }),
  eventId: text('event_id'), kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(), payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'), attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  createdAt: createdAt(), sentAt: timestamp('sent_at', { withTimezone: true }),
  providerId: text('provider_id'), error: text('error'),
}, t => [index('recruitment_mail_due').on(t.status, t.nextAttemptAt), index('recruitment_mail_candidate').on(t.candidateId), index('recruitment_mail_company').on(t.companyId)]);

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
}, (t) => [index('reviews_company').on(t.companyId), uniqueIndex('reviews_cycle_employee').on(t.cycleId, t.employeeId), index('reviews_reviewer').on(t.reviewerEmployeeId)]);

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
  /** Assinatura electrónica simples do colaborador: pedido pelo RH, aceite no portal com nome, data, IP e hash do texto. */
  signatureRequestedAt: timestamp('signature_requested_at', { withTimezone: true }),
  signatureRequestedBy: text('signature_requested_by'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  signedBy: text('signed_by'),
  signedName: text('signed_name'),
  signedIp: text('signed_ip'),
  signedHash: text('signed_hash'),
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
}, (t) => [index('bank_statements_company').on(t.companyId)]);

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
}, (t) => [index('bank_matches_company').on(t.companyId)]);

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
}, (t) => [index('bank_lines_company_status').on(t.companyId, t.status), index('bank_lines_statement_status').on(t.statementId, t.status), index('bank_lines_account_status').on(t.accountId, t.status), index('bank_lines_account_fp').on(t.accountId, t.fingerprint)]);

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
}, (t) => [index('audit_logs_entity').on(t.companyId, t.entity, t.entityId), index('audit_logs_company_action_at').on(t.companyId, t.action, t.at)]);

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

/** Direitos por módulo. Sem linha RH, preserva-se a subscrição histórica; Modelagem exige adesão explícita. */
export const companyModules = pgTable('company_modules', {
  id: id(),
  /** Projectos activos contratados; preço é definido separadamente do RH. */
  projectLimit: integer('project_limit').default(1),
  extraUsers: integer('extra_users').notNull().default(0),
  planKey: text('plan_key'),
  cycle: text('cycle'),
  primarySector: text('primary_sector'),
  modelingSectors: jsonb('modeling_sectors').$type<import('@kianda/core').FinancialSector[]>().notNull().default(['mineracao', 'petroleo', 'agro', 'comercio', 'servicos', 'industria', 'imobiliario', 'tecnologia']),
  companyId: text('company_id').notNull().references(() => companies.id),
  module: text('module').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  status: text('status').notNull().default('trial'),
  trialEndsAt: date('trial_ends_at'),
  paidUntil: date('paid_until'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('company_modules_company_module').on(t.companyId, t.module)]);

/** Rascunho independente do RH. Moeda explícita; pressupostos no formato versionado do Integra. */
export const financialModels = pgTable('financial_models', {
  id: id(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  sector: text('sector').notNull(),
  currency: text('currency').notNull(),
  assumptions: jsonb('assumptions').notNull().default({}),
  revision: integer('revision').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('financial_models_company').on(t.companyId)]);

/** Cópia imutável dos dados agregados importados, sem nomes nem remunerações individuais. */
export const financialPersonnelImports = pgTable('financial_personnel_imports', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  modelId: text('model_id').notNull().references(() => financialModels.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  sourceId: text('source_id'),
  fromPeriod: text('from_period').notNull(),
  toPeriod: text('to_period').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  importedBy: text('imported_by').notNull(),
  importedAt: createdAt(),
}, (t) => [index('financial_personnel_imports_company_model').on(t.companyId, t.modelId), index('financial_personnel_imports_model').on(t.modelId)]);

/** Balancetes de trabalho por projecto. A aprovação congela uma cópia na versão. */
export const financialHistoricalInputs = pgTable('financial_historical_inputs', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  modelId: text('model_id').notNull().references(() => financialModels.id, { onDelete: 'cascade' }),
  input: jsonb('input').$type<import('@kianda/core').FinancialHistoricalInput>().notNull(),
  inputHash: text('input_hash').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('financial_history_model').on(t.modelId), index('financial_history_company_model').on(t.companyId, t.modelId)]);

/** Utilizadores autorizados no Integra; o proprietário da empresa ocupa um dos cinco acessos. */
export const modelingMembers = pgTable('modeling_members', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  enabled: boolean('enabled').notNull().default(true),
  permission: text('permission').notNull().default('editor'),
  /** all = todos os projectos da empresa; selected = só os indicados em modeling_project_access. */
  scope: text('scope').notNull().default('all'),
  addedBy: text('added_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('modeling_members_company_user').on(t.companyId, t.userId)]);

/** Acesso de um participante a um projecto concreto (participantes com scope = selected). */
export const modelingProjectAccess = pgTable('modeling_project_access', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  modelId: text('model_id').notNull().references(() => financialModels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  /** editor | viewer — nunca acima da permissão geral do participante. */
  permission: text('permission').notNull().default('viewer'),
  addedBy: text('added_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('modeling_project_access_model_user').on(t.modelId, t.userId), index('modeling_project_access_company_user').on(t.companyId, t.userId)]);

/** Versão aprovada: pressupostos, cálculos e relatórios congelados, sem edição posterior. */
export const financialModelVersions = pgTable('financial_model_versions', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  modelId: text('model_id').notNull().references(() => financialModels.id),
  versionNumber: integer('version_number').notNull(),
  label: text('label').notNull(),
  sourceRevision: integer('source_revision').notNull(),
  sourceHash: text('source_hash').notNull(),
  payloadHash: text('payload_hash').notNull(),
  engineVersion: text('engine_version').notNull(),
  reportVersion: text('report_version').notNull(),
  payload: jsonb('payload').$type<import('@kianda/core').FinancialReportBundle>().notNull(),
  approvedBy: text('approved_by').notNull(),
  approvedAt: createdAt(),
}, (t) => [uniqueIndex('financial_versions_model_number').on(t.modelId, t.versionNumber), uniqueIndex('financial_versions_model_revision_label').on(t.modelId, t.sourceRevision, t.label), index('financial_versions_company_model').on(t.companyId, t.modelId)]);

export type ModelingMemberRow = typeof modelingMembers.$inferSelect;

/** Kianda Valora: utilizadores autorizados; o proprietário ocupa um dos cinco acessos incluídos. */
export const valuationMembers = pgTable('valuation_members', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  enabled: boolean('enabled').notNull().default(true),
  /** editor | viewer */
  permission: text('permission').notNull().default('editor'),
  addedBy: text('added_by').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('valuation_members_company_user').on(t.companyId, t.userId)]);

/** Uma análise por entidade analisada (a própria empresa, uma participada ou um alvo de aquisição). */
export const valuationAnalyses = pgTable('valuation_analyses', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  /** Estrutura validada por valuationDataIssue (@kianda/core); valores em Mkz. */
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  /** A própria empresa subscritora: permite trazer os custos com o pessoal do processamento salarial. */
  ownCompany: boolean('own_company').notNull().default(false),
  revision: integer('revision').notNull().default(1),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /** Último restauro: arquivada de novo no mesmo mês, continua a ocupar a vaga até ao fim do mês. */
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('valuation_analyses_company').on(t.companyId, t.updatedAt)]);

/** Versões anteriores de uma análise do Valora: estado completo antes de uma sessão de alterações, de uma importação ou de uma reposição. */
export const valuationVersions = pgTable('valuation_versions', {
  id: id(),
  companyId: text('company_id').notNull().references(() => companies.id),
  analysisId: text('analysis_id').notNull().references(() => valuationAnalyses.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  name: text('name').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  /** edit | import_personnel | before_restore */
  reason: text('reason').notNull(),
  savedBy: text('saved_by').notNull(),
  createdAt: createdAt(),
}, (t) => [index('valuation_versions_analysis_idx').on(t.analysisId, t.createdAt)]);

export type ValuationMemberRow = typeof valuationMembers.$inferSelect;
export type ValuationAnalysisRow = typeof valuationAnalyses.$inferSelect;
