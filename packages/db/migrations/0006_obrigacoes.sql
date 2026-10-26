CREATE TYPE "public"."obligation_kind" AS ENUM('salaries', 'inss', 'irt');--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"run_id" text NOT NULL,
	"kind" "obligation_kind" NOT NULL,
	"paid_on" date NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"reference" text,
	"journal_entry_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "inss_base_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "irt_taxable_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payments_run_kind" ON "payroll_payments" USING btree ("run_id","kind");--> statement-breakpoint
-- Linhas já processadas: reconstruir as bases a partir dos descontos (INSS do trabalhador = 3% da base).
UPDATE "payroll_lines" SET "inss_base_minor" = ROUND("inss_employee_minor" / 0.03) WHERE "inss_base_minor" = 0 AND "inss_employee_minor" > 0;
