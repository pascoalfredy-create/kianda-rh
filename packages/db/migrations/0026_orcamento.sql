CREATE TABLE "personnel_budget_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"budget_id" text NOT NULL,
	"company_id" text NOT NULL,
	"department_id" text,
	"period" text NOT NULL,
	"headcount" numeric(8, 1) DEFAULT '0' NOT NULL,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_budgets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel_budget_lines" ADD CONSTRAINT "personnel_budget_lines_budget_id_personnel_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."personnel_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_budget_lines" ADD CONSTRAINT "personnel_budget_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_budgets" ADD CONSTRAINT "personnel_budgets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personnel_budget_lines_budget" ON "personnel_budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_budgets_company_year" ON "personnel_budgets" USING btree ("company_id","year");--> statement-breakpoint
ALTER TABLE "personnel_budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "personnel_budgets" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE "personnel_budget_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "personnel_budget_lines" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
