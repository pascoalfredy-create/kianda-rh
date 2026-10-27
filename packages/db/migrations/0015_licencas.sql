CREATE TABLE "payment_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"tier_key" text,
	"cycle" text,
	"seats" integer,
	"period_start" date,
	"period_end" date,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payer_reference" text,
	"payer_note" text,
	"paid_at" timestamp with time zone,
	"confirmed_by" text,
	"invoice_ref" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"company_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"tier_key" text DEFAULT 't1' NOT NULL,
	"cycle" text DEFAULT 'monthly' NOT NULL,
	"trial_ends_at" date,
	"paid_until" date,
	"extra_seats" integer DEFAULT 0 NOT NULL,
	"custom_max_employees" integer,
	"custom_monthly_minor" bigint,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_data_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_requests_company" ON "payment_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payment_requests_status" ON "payment_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_code_unique" UNIQUE("code");--> statement-breakpoint
-- Empresas existentes antes do licenciamento: activas (sem interrupção); o código curto é gerado para todas.
INSERT INTO "subscriptions" ("company_id", "status", "tier_key", "cycle", "paid_until", "notes")
SELECT "id", 'active', 't1', 'monthly', '2099-12-31', 'Conta existente antes do licenciamento' FROM "companies"
ON CONFLICT ("company_id") DO NOTHING;--> statement-breakpoint
UPDATE "companies" SET "code" = upper(substr(md5("id"), 1, 6)) WHERE "code" IS NULL;
