CREATE TYPE "public"."absence_type" AS ENUM('vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training');--> statement-breakpoint
CREATE TYPE "public"."bank_line_status" AS ENUM('pending', 'suggested', 'matched', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('indefinite', 'fixed_term', 'internship');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'suspended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'closed');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'hr_admin', 'payroll', 'finance', 'manager', 'employee');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" "absence_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"working_days" integer NOT NULL,
	"reason" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_mappings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"role" text NOT NULL,
	"account" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"statement_id" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"status" "bank_line_status" DEFAULT 'pending' NOT NULL,
	"obligation_key" text,
	"category" text
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"account_iban" text,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"nif" text NOT NULL,
	"inss_number" text,
	"address" text,
	"cae_code" text,
	"micro_or_startup" boolean DEFAULT false NOT NULL,
	"bank_account_iban" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_nif_unique" UNIQUE("nif")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"employee_id" text NOT NULL,
	"type" "contract_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"term_justification" text,
	"base_minor" bigint DEFAULT 0 NOT NULL,
	"meal_minor" bigint DEFAULT 0 NOT NULL,
	"transport_minor" bigint DEFAULT 0 NOT NULL,
	"other_minor" bigint DEFAULT 0 NOT NULL,
	"other_label" text,
	"terminated_at" date,
	"termination_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"cost_center" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"birth_date" date,
	"bi_number" text,
	"nif" text,
	"inss_number" text,
	"iban" text,
	"bank" text,
	"email" text,
	"phone" text,
	"address" text,
	"job_title" text NOT NULL,
	"department_id" text,
	"province" text,
	"manager_id" text,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"vacation_carry_over" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"category" text NOT NULL,
	"date" date NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"paid_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"date" date NOT NULL,
	"journal" text NOT NULL,
	"reference" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"provisional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"entry_id" text NOT NULL,
	"account" text NOT NULL,
	"description" text NOT NULL,
	"cost_center" text,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"absence_days" integer DEFAULT 0 NOT NULL,
	"bonus_minor" bigint DEFAULT 0 NOT NULL,
	"advances_minor" bigint DEFAULT 0 NOT NULL,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"inss_employee_minor" bigint DEFAULT 0 NOT NULL,
	"irt_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"inss_employer_minor" bigint DEFAULT 0 NOT NULL,
	"irt_bracket" integer DEFAULT 1 NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculation_hash" text
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"period" text NOT NULL,
	"status" "payroll_status" DEFAULT 'draft' NOT NULL,
	"pack_version" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"paid_salaries_at" date,
	"paid_irt_at" date,
	"paid_inss_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_company_status" ON "absences" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "account_mappings_company_role" ON "account_mappings" USING btree ("company_id","role");--> statement-breakpoint
CREATE INDEX "audit_logs_entity" ON "audit_logs" USING btree ("company_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "bank_lines_statement_status" ON "bank_lines" USING btree ("statement_id","status");--> statement-breakpoint
CREATE INDEX "contracts_employee_start" ON "contracts" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name" ON "departments" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "documents_company_employee" ON "documents" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_number" ON "employees" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "employees_company_status" ON "employees" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "expenses_company_status" ON "expenses" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_reference" ON "journal_entries" USING btree ("company_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_employee" ON "payroll_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_company_period" ON "payroll_runs" USING btree ("company_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "users_company_email" ON "users" USING btree ("company_id","email");