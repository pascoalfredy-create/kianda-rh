CREATE TYPE "public"."document_type" AS ENUM('bi', 'passport', 'residence_card', 'work_visa', 'driving_licence', 'professional_card', 'other');--> statement-breakpoint
CREATE TABLE "compensation_changes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"contract_id" text,
	"effective_date" date NOT NULL,
	"base_minor" bigint DEFAULT 0 NOT NULL,
	"meal_minor" bigint DEFAULT 0 NOT NULL,
	"transport_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"type" "document_type" NOT NULL,
	"number" text NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"issuer" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "compensation_changes" ADD CONSTRAINT "compensation_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_changes" ADD CONSTRAINT "compensation_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_changes" ADD CONSTRAINT "compensation_changes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_changes_employee_date" ON "compensation_changes" USING btree ("employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "employee_documents_employee" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_documents_company_type_number" ON "employee_documents" USING btree ("company_id","type","number");--> statement-breakpoint
-- Histórico inicial: uma alteração por contrato existente, com efeito na data de início.
INSERT INTO "compensation_changes" ("company_id", "employee_id", "contract_id", "effective_date", "base_minor", "meal_minor", "transport_minor", "reason")
SELECT e."company_id", c."employee_id", c."id", c."start_date", c."base_minor", c."meal_minor", c."transport_minor", 'Início de contrato'
FROM "contracts" c JOIN "employees" e ON e."id" = c."employee_id"
ON CONFLICT DO NOTHING;
