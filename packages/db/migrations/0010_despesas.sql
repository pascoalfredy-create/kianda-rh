CREATE TYPE "public"."expense_claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"trip_from" date,
	"trip_to" date,
	"status" "expense_claim_status" DEFAULT 'draft' NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"approval_journal_id" text,
	"paid_on" date,
	"paid_reference" text,
	"payment_journal_id" text,
	"bank_account_id" text,
	"match_id" text
);
--> statement-breakpoint
CREATE TABLE "expense_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"claim_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"document_ref" text,
	"supplier_nif" text,
	"zone" text,
	"half_days" integer,
	"rate_minor" bigint,
	"amount_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_claim_id_expense_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."expense_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_claims_company_number" ON "expense_claims" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "expense_claims_company_status" ON "expense_claims" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "expense_claims_employee" ON "expense_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "expense_lines_claim" ON "expense_lines" USING btree ("claim_id");