CREATE TABLE "allowance_types" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"calc" text NOT NULL,
	"value_minor" bigint,
	"bps" integer,
	"in_inss" boolean DEFAULT true NOT NULL,
	"in_irt" boolean DEFAULT true NOT NULL,
	"note" text,
	"preset_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_allowances" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type_id" text NOT NULL,
	"value_minor" bigint,
	"bps" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"pattern" jsonb NOT NULL,
	"anchor_date" date,
	"note" text,
	"preset_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "schedule_anchor" date;--> statement-breakpoint
ALTER TABLE "allowance_types" ADD CONSTRAINT "allowance_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_allowances" ADD CONSTRAINT "employee_allowances_type_id_allowance_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."allowance_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowance_types_company_code" ON "allowance_types" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "employee_allowances_employee" ON "employee_allowances" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_allowances_company" ON "employee_allowances" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_company_name" ON "work_schedules" USING btree ("company_id","name");