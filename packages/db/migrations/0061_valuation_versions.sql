-- Valora: versões anteriores de cada análise (V-8). Uma cópia do estado anterior por sessão de trabalho (30 min), antes de importações e de reposições.
CREATE TABLE IF NOT EXISTS "valuation_versions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id"),
  "analysis_id" text NOT NULL REFERENCES "valuation_analyses"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "name" text NOT NULL,
  "data" jsonb NOT NULL,
  "reason" text NOT NULL,
  "saved_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "valuation_versions_analysis_idx" ON "valuation_versions" ("analysis_id", "created_at");
--> statement-breakpoint
ALTER TABLE "valuation_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON "valuation_versions" USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
