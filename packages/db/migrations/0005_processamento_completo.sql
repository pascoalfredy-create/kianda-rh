CREATE TYPE "public"."payroll_variable_kind" AS ENUM('bonus', 'other_earning', 'advance', 'other_deduction');--> statement-breakpoint
CREATE TABLE "payroll_variables" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"period" text NOT NULL,
	"kind" "payroll_variable_kind" NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"in_inss" boolean DEFAULT true NOT NULL,
	"in_irt" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "christmas_subsidy_month" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "holiday_subsidy_month" integer;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "subsidy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_variables" ADD CONSTRAINT "payroll_variables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_variables" ADD CONSTRAINT "payroll_variables_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_variables_company_period" ON "payroll_variables" USING btree ("company_id","period");