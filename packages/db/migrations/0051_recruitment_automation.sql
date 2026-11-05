CREATE TABLE "recruitment_mail" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"event_id" text,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_id" text,
	"error" text,
	CONSTRAINT "recruitment_mail_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "recruitment_offers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"base_minor" bigint DEFAULT 0 NOT NULL,
	"meal_minor" bigint DEFAULT 0 NOT NULL,
	"transport_minor" bigint DEFAULT 0 NOT NULL,
	"expected_salary_minor" bigint,
	"start_date" date,
	"valid_until" date NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"response_note" text,
	"counter_minor" bigint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "cv_text" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "cv_text_source" text;--> statement-breakpoint
ALTER TABLE "job_openings" ADD COLUMN "ats_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recruitment_mail" ADD CONSTRAINT "recruitment_mail_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mail" ADD CONSTRAINT "recruitment_mail_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recruitment_mail_due" ON "recruitment_mail" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "recruitment_mail_candidate" ON "recruitment_mail" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "recruitment_mail_company" ON "recruitment_mail" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_offers_candidate_version" ON "recruitment_offers" USING btree ("candidate_id","version");--> statement-breakpoint
CREATE INDEX "recruitment_offers_company" ON "recruitment_offers" USING btree ("company_id");
--> statement-breakpoint
ALTER TABLE recruitment_mail ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON recruitment_mail USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
ALTER TABLE recruitment_offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON recruitment_offers USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recruitment_mail, recruitment_offers TO kianda_app;
--> statement-breakpoint
CREATE FUNCTION kianda_recruitment_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = NEW.candidate_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'candidato de outra empresa' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recruitment_mail_same_company BEFORE INSERT OR UPDATE OF company_id, candidate_id ON recruitment_mail FOR EACH ROW EXECUTE FUNCTION kianda_recruitment_same_company();
--> statement-breakpoint
CREATE TRIGGER recruitment_offers_same_company BEFORE INSERT OR UPDATE OF company_id, candidate_id ON recruitment_offers FOR EACH ROW EXECUTE FUNCTION kianda_recruitment_same_company();
--> statement-breakpoint
ALTER TABLE recruitment_offers ADD CONSTRAINT recruitment_offers_amounts CHECK (base_minor > 0 AND meal_minor >= 0 AND transport_minor >= 0);
