CREATE TABLE "email_verifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_token_hash" ON "email_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_user_created" ON "email_verifications" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON email_verifications USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO kianda_app;
--> statement-breakpoint
-- Estender experiências anteriores para 30 dias, sem reduzir concessões nem alterar períodos pagos/manuais.
UPDATE subscriptions s SET trial_ends_at = greatest(s.trial_ends_at, (c.created_at AT TIME ZONE 'Africa/Luanda')::date + 29)
FROM companies c WHERE c.id=s.company_id AND s.status='trial' AND s.paid_until IS NULL;
--> statement-breakpoint
UPDATE company_modules m SET trial_ends_at = greatest(m.trial_ends_at, (c.created_at AT TIME ZONE 'Africa/Luanda')::date + 29)
FROM companies c WHERE c.id=m.company_id AND m.status='trial' AND m.paid_until IS NULL;
