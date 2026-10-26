-- As tabelas bank_lines/bank_statements do protótipo nunca foram usadas: limpa-se antes de acrescentar colunas obrigatórias.
DELETE FROM "bank_lines";--> statement-breakpoint
DELETE FROM "bank_statements";--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"bank_name" text,
	"iban" text,
	"ledger_account" text DEFAULT '43.1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_matches" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"rule" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "company_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "match_id" text;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "imported_by" text;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "from_date" date;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "to_date" date;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "line_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "new_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "opening_balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "closing_balance_minor" bigint;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "balance_ok" boolean;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD COLUMN "bank_account_id" text;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD COLUMN "match_id" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_company" ON "bank_accounts" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_match_id_bank_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."bank_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_lines_account_status" ON "bank_lines" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "bank_lines_account_fp" ON "bank_lines" USING btree ("account_id","fingerprint");