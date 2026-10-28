CREATE TABLE "financial_historical_inputs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"company_id" text NOT NULL,
	"model_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_historical_inputs" ADD CONSTRAINT "financial_historical_inputs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_historical_inputs" ADD CONSTRAINT "financial_historical_inputs_model_id_financial_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."financial_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_history_model" ON "financial_historical_inputs" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "financial_history_company_model" ON "financial_historical_inputs" USING btree ("company_id","model_id");
--> statement-breakpoint
ALTER TABLE "financial_historical_inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "financial_historical_inputs"
USING (company_id = kianda_tenant())
WITH CHECK (company_id = kianda_tenant() AND EXISTS (
  SELECT 1 FROM financial_models m WHERE m.id = model_id AND m.company_id = kianda_tenant()
));
