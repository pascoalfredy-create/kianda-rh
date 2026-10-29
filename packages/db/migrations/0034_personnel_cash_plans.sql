CREATE TABLE personnel_cash_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  company_id text NOT NULL REFERENCES companies(id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  opening_minor bigint NOT NULL DEFAULT 0,
  receipts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(receipts) = 'object'),
  revision integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX personnel_cash_plans_company_period ON personnel_cash_plans(company_id, period);
--> statement-breakpoint
ALTER TABLE personnel_cash_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY empresa ON personnel_cash_plans USING (company_id = kianda_tenant()) WITH CHECK (company_id = kianda_tenant());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON personnel_cash_plans TO kianda_app;
