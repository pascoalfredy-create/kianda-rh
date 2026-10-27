CREATE TABLE "company_modules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"module" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" date,
	"paid_until" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_models" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"currency" text NOT NULL,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_personnel_imports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"model_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"from_period" text NOT NULL,
	"to_period" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_models" ADD CONSTRAINT "financial_models_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_personnel_imports" ADD CONSTRAINT "financial_personnel_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_personnel_imports" ADD CONSTRAINT "financial_personnel_imports_model_id_financial_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."financial_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_modules_company_module" ON "company_modules" USING btree ("company_id","module");--> statement-breakpoint
CREATE INDEX "financial_models_company" ON "financial_models" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "financial_personnel_imports_model" ON "financial_personnel_imports" USING btree ("model_id");
--> statement-breakpoint
ALTER TABLE "company_modules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "company_modules" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());

--> statement-breakpoint
ALTER TABLE "financial_models" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "financial_models" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());

--> statement-breakpoint
ALTER TABLE "financial_personnel_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "financial_personnel_imports" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());

--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_module_check CHECK (module IN ('hr', 'modeling'));
--> statement-breakpoint
ALTER TABLE company_modules ADD CONSTRAINT company_modules_status_check CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled'));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON company_modules FROM kianda_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON financial_personnel_imports FROM kianda_app;
