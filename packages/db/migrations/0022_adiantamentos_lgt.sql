CREATE TABLE "salary_advances" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"number" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"installments" integer NOT NULL,
	"first_period" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"written_request_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"paid_on" date,
	"paid_by" text,
	"bank_account_id" text,
	"journal_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_months" ADD COLUMN "rest_holiday_overtime_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD COLUMN "rest_day_paid_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD COLUMN "holiday_work_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "allowances_on_vacation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_variables" ADD COLUMN "advance_id" text;--> statement-breakpoint
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_advances" ADD CONSTRAINT "salary_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_advances_company_number" ON "salary_advances" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "salary_advances_employee" ON "salary_advances" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "salary_advances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "salary_advances" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
