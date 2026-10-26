CREATE TYPE "public"."punch_source" AS ENUM('web', 'manual');--> statement-breakpoint
CREATE TABLE "attendance_entries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"source" "punch_source" DEFAULT 'web' NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_months" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"period" text NOT NULL,
	"worked_minutes" integer NOT NULL,
	"expected_minutes" integer NOT NULL,
	"overtime_minutes" integer NOT NULL,
	"approved_overtime_minutes" integer NOT NULL,
	"note" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "workday_minutes" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD CONSTRAINT "attendance_months_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD CONSTRAINT "attendance_months_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_entries_employee_date" ON "attendance_entries" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_entries_company_date" ON "attendance_entries" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_months_employee_period" ON "attendance_months" USING btree ("employee_id","period");