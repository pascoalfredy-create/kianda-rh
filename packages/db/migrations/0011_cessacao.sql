CREATE TYPE "public"."termination_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "terminations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"reason" text NOT NULL,
	"notice_date" date,
	"effective_date" date NOT NULL,
	"period" text NOT NULL,
	"status" "termination_status" DEFAULT 'draft' NOT NULL,
	"agreed_compensation_minor" bigint,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"cancel_note" text
);
--> statement-breakpoint
ALTER TABLE "payroll_variables" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "payroll_variables" ADD COLUMN "termination_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminations" ADD CONSTRAINT "terminations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terminations_company" ON "terminations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "terminations_employee" ON "terminations" USING btree ("employee_id");