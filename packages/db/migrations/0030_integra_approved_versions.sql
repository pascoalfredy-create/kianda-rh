CREATE TABLE "financial_model_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"model_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"label" text NOT NULL,
	"source_revision" integer NOT NULL,
	"source_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"engine_version" text NOT NULL,
	"report_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_model_versions" ADD CONSTRAINT "financial_model_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_versions" ADD CONSTRAINT "financial_model_versions_model_id_financial_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."financial_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_versions_model_number" ON "financial_model_versions" USING btree ("model_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_versions_model_revision_label" ON "financial_model_versions" USING btree ("model_id","source_revision","label");--> statement-breakpoint
CREATE INDEX "financial_versions_company_model" ON "financial_model_versions" USING btree ("company_id","model_id");--> statement-breakpoint
ALTER TABLE "financial_model_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "financial_model_versions" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant() AND EXISTS (SELECT 1 FROM financial_models m WHERE m.id = model_id AND m.company_id = kianda_tenant()));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "financial_model_versions" FROM kianda_app;
--> statement-breakpoint
CREATE FUNCTION kianda_immutable_financial_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Uma versão financeira aprovada não pode ser alterada' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER financial_version_immutable BEFORE UPDATE ON financial_model_versions
FOR EACH ROW EXECUTE FUNCTION kianda_immutable_financial_version();
--> statement-breakpoint
ALTER TABLE financial_model_versions ADD CONSTRAINT financial_version_positive CHECK (version_number > 0 AND source_revision > 0);
